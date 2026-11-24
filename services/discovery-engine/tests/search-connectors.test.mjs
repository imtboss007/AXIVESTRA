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

test("search results are unverified candidates and exclude non-HTTPS or unsafe addresses", () => {
  const rows = normalizeSearxngResults([
    { title: "Official institution", url: "https://finance.example.in/product", content: "Product page", engine: "example" },
    { title: "Unsafe HTTP", url: "http://finance.example.in/" },
    { title: "Local", url: "https://127.0.0.1/internal" },
    { title: "Credentialed", url: "https://user:pass@finance.example.in/" },
    { title: "Duplicate", url: "https://finance.example.in/product" }
  ], 10, "2026-11-24T00:00:00.000Z");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "unverified_candidate");
  assert.equal(rows[0].verified, false);
  assert.equal(rows[0].evidenceId, null);
  assert.equal(rows[0].domain, "finance.example.in");
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
