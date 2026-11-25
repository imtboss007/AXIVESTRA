import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DATA_GOV_IN_REQUEST_POLICY,
  prepareProviderRequestUrl
} from "./api-provider-requests.mjs";
import { redactUrl } from "./worker-policy.mjs";

const approvedDataGovSource = {
  status: "approved",
  source_type: "official_api",
  connector_key: "official_api",
  domain: "api.data.gov.in"
};

test("data.gov.in resource requests receive a server-only key and bounded JSON paging", () => {
  const prepared = new URL(prepareProviderRequestUrl(
    "https://api.data.gov.in/resource/abc12345-1234-1234-1234-123456789012?limit=250&offset=500",
    { source: approvedDataGovSource, env: { DATA_GOV_IN_API_KEY: "server-key-value" } }
  ));
  assert.equal(prepared.hostname, "api.data.gov.in");
  assert.equal(prepared.searchParams.get("api-key"), "server-key-value");
  assert.equal(prepared.searchParams.get("format"), "json");
  assert.equal(prepared.searchParams.get("limit"), "250");
  assert.equal(prepared.searchParams.get("offset"), "500");
  assert.equal(DATA_GOV_IN_REQUEST_POLICY.maxPageSize, 10_000);
});

test("data.gov.in defaults are bounded and the API key is redacted before audit/evidence URLs", () => {
  const prepared = prepareProviderRequestUrl(
    "https://api.data.gov.in/resource/abc12345-1234-1234-1234-123456789012",
    { source: approvedDataGovSource, env: { DATA_GOV_IN_API_KEY: "must-not-leak" } }
  );
  const parsed = new URL(prepared);
  assert.equal(parsed.searchParams.get("format"), "json");
  assert.equal(parsed.searchParams.get("limit"), "1000");
  assert.equal(parsed.searchParams.get("offset"), "0");
  const safe = redactUrl(prepared);
  assert.equal(safe.includes("must-not-leak"), false);
  assert.match(safe, /api-key=%5Bredacted%5D/);
});

test("data.gov.in access fails closed without an approved exact-host official API source", () => {
  assert.throws(() => prepareProviderRequestUrl(
    "https://api.data.gov.in/resource/abc12345-1234-1234-1234-123456789012",
    { source: { ...approvedDataGovSource, status: "pending" }, env: { DATA_GOV_IN_API_KEY: "key" } }
  ), /approved official_api source/);
  assert.throws(() => prepareProviderRequestUrl(
    "https://api.data.gov.in/resource/abc12345-1234-1234-1234-123456789012",
    { source: { ...approvedDataGovSource, domain: "other.example" }, env: { DATA_GOV_IN_API_KEY: "key" } }
  ), /approved official_api source/);
  assert.throws(() => prepareProviderRequestUrl(
    "https://api.data.gov.in/resource/abc12345-1234-1234-1234-123456789012",
    { source: { ...approvedDataGovSource, source_type: "permitted_public_page" }, env: { DATA_GOV_IN_API_KEY: "key" } }
  ), /approved official_api source/);
});

test("the resource ID is explicit and caller-supplied API keys are rejected", () => {
  assert.throws(() => prepareProviderRequestUrl(
    "https://api.data.gov.in/resource/",
    { source: approvedDataGovSource, env: { DATA_GOV_IN_API_KEY: "key" } }
  ), /exact registered resource ID/);
  assert.throws(() => prepareProviderRequestUrl(
    "https://api.data.gov.in/resource/abc12345-1234-1234-1234-123456789012?api-key=leaked",
    { source: approvedDataGovSource, env: { DATA_GOV_IN_API_KEY: "key" } }
  ), /Do not place a data.gov.in API key/);
});

test("data.gov.in query contract rejects unknown parameters, repeated parameters and non-JSON responses", () => {
  const env = { DATA_GOV_IN_API_KEY: "key" };
  const root = "https://api.data.gov.in/resource/abc12345-1234-1234-1234-123456789012";
  assert.throws(() => prepareProviderRequestUrl(root + "?q=company", { source: approvedDataGovSource, env }), /outside the approved/);
  assert.throws(() => prepareProviderRequestUrl(root + "?limit=10&limit=20", { source: approvedDataGovSource, env }), /repeated limit/);
  assert.throws(() => prepareProviderRequestUrl(root + "?format=xml", { source: approvedDataGovSource, env }), /JSON responses only/);
});

test("data.gov.in paging limits are validated before credentials are attached", () => {
  const env = { DATA_GOV_IN_API_KEY: "key" };
  const root = "https://api.data.gov.in/resource/abc12345-1234-1234-1234-123456789012";
  assert.throws(() => prepareProviderRequestUrl(root + "?limit=10001", { source: approvedDataGovSource, env }), /page limit/);
  assert.throws(() => prepareProviderRequestUrl(root + "?limit=-1", { source: approvedDataGovSource, env }), /whole number/);
  assert.throws(() => prepareProviderRequestUrl(root + "?offset=1000001", { source: approvedDataGovSource, env }), /offset/);
  assert.throws(() => prepareProviderRequestUrl(root, { source: approvedDataGovSource, env: {} }), /missing a valid server-side DATA_GOV_IN_API_KEY/);
});

test("other approved HTTPS providers pass through, but candidate URLs cannot smuggle credentials", () => {
  const normal = "https://registry.example.in/api/v1/company/123";
  assert.equal(prepareProviderRequestUrl(normal, { source: { status: "approved" } }), normal);
  assert.throws(() => prepareProviderRequestUrl(
    "https://registry.example.in/api/v1/company?token=secret",
    { source: { status: "approved" } }
  ), /must not be supplied in candidate URLs/);
});

test("E04 injects the provider key only at the controlled outbound request boundary", async () => {
  const worker = await readFile(new URL("./worker.mjs", import.meta.url), "utf8");
  const controlled = worker.slice(worker.indexOf("async function controlledGet"), worker.indexOf("function readContentType"));
  assert.match(worker, /import \{ prepareProviderRequestUrl \} from "\.\/api-provider-requests\.mjs"/);
  assert.match(controlled, /purpose === "robots"\s*\? current\.toString\(\)\s*:\s*prepareProviderRequestUrl/);
  assert.ok(controlled.indexOf("prepareProviderRequestUrl(") < controlled.indexOf("rawHttpsGet("));
});
