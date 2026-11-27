import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSearxngQueries,
  normalizeSearxngResults,
  searchSearxng
} from "../../../supabase/functions/_shared/discovery-search-connectors.mjs";

test("workspace criteria build bounded company and institution search queries", () => {
  const queries = buildSearxngQueries({
    targetClasses: ["bank", "nbfc", "housing_finance_company", "private_credit_fund", "another_target"],
    requiredFields: ["institution_name"],
    disabledByPolicy: false
  }, { location: "Karnataka", product: "loan against property", sector: "finance" });
  assert.equal(queries.length, 4);
  assert.equal(queries[0], "bank Karnataka finance loan against property");
  assert.ok(queries.every(query => query.length <= 500));
});

test("sensitive or disabled workspace modes cannot use internet search", () => {
  assert.throws(() => buildSearxngQueries({
    targetClasses: ["borrower"], disabledByPolicy: true
  }), /disabled by discovery policy/);
});

test("workspace search filters reject personal contact data and never send it to search providers", () => {
  const criteria = { targetClasses: ["bank", "nbfc"], disabledByPolicy: false };
  assert.throws(() => buildSearxngQueries(criteria, { location: "person@example.in" }), /must not contain personal email/);
  assert.throws(() => buildSearxngQueries(criteria, { product: "+91 98765 43210" }), /must not contain personal email/);
  assert.throws(() => buildSearxngQueries({ targetClasses: ["contact person@example.in"] }), /target classes must not contain personal contact/);
});

test("search results are unverified candidates and exclude non-HTTPS or unsafe addresses", () => {
  const rows = normalizeSearxngResults([
    { title: "Official institution", url: "https://finance.example.in/product", content: "Product page", engine: "example" },
    { title: "Unsafe HTTP", url: "http://finance.example.in/" },
    { title: "Local", url: "https://127.0.0.1/internal" },
    { title: "Private network", url: "https://10.2.3.4/internal" },
    { title: "Social profile", url: "https://www.linkedin.com/in/person" },
    { title: "Query token", url: "https://finance.example.in/search?email=person%40example.in" },
    { title: "Credentialed", url: "https://user:pass@finance.example.in/" },
    { title: "Duplicate", url: "https://finance.example.in/product" }
  ], 10, "2026-11-24T00:00:00.000Z");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "unverified_candidate");
  assert.equal(rows[0].verified, false);
  assert.equal(rows[0].evidenceId, null);
  assert.equal(rows[0].domain, "finance.example.in");
});

test("search snippets redact email and phone text before candidate results are returned", () => {
  const rows = normalizeSearxngResults([{
    title: "Company directory",
    url: "https://directory.example.in/company",
    content: "Contact team@example.in or call +91 98765 43210 for details."
  }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].snippet.includes("team@example.in"), false);
  assert.equal(rows[0].snippet.includes("98765"), false);
  assert.match(rows[0].snippet, /email redacted/);
  assert.match(rows[0].snippet, /phone redacted/);
});

test("SearXNG connector only calls a fixed configured HTTPS endpoint and requests JSON results", async () => {
  let capturedUrl = "";
  let capturedHeaders = {};
  const rows = await searchSearxng({
    baseUrl: "https://search.example.net/",
    query: "bank Karnataka",
    bearerToken: "server-only-token",
    fetcher: async (url, options) => {
      capturedUrl = url;
      capturedHeaders = options.headers;
      return {
        ok: true,
        json: async () => ({ results: [{ title: "Bank", url: "https://bank.example.in/", content: "Official source" }] })
      };
    }
  });
  const parsed = new URL(capturedUrl);
  assert.equal(parsed.pathname, "/search");
  assert.equal(parsed.searchParams.get("format"), "json");
  assert.equal(parsed.searchParams.get("q"), "bank Karnataka");
  assert.equal(capturedHeaders.Authorization, "Bearer server-only-token");
  assert.equal(rows[0].status, "unverified_candidate");
});

test("SearXNG connector fails closed when not configured or endpoint attempts HTTP", async () => {
  await assert.rejects(() => searchSearxng({ baseUrl: "", query: "bank" }), /not been configured/);
  await assert.rejects(() => searchSearxng({ baseUrl: "http://search.example.net", query: "bank" }), /HTTPS/);
});


test("long but valid module filter sets retain a bounded search query instead of dropping the target", () => {
  const queries = buildSearxngQueries({
    targetClasses: ["housing_finance_company"],
    disabledByPolicy: false
  }, {
    location: "Karnataka, India",
    searchTerms: "Published product criteria: " + "residential property housing loan ".repeat(30)
  });
  assert.equal(queries.length, 1);
  assert.ok(queries[0].startsWith("housing finance company"));
  assert.ok(queries[0].includes("Karnataka, India"));
  assert.ok(queries[0].length <= 500);
});
