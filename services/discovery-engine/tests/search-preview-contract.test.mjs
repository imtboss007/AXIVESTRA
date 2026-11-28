import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const handler = await readFile(new URL("../../../supabase/functions/discovery-control/index.ts", import.meta.url), "utf8");
const queueUi = await readFile(new URL("../../../src/DiscoveryJobQueue.tsx", import.meta.url), "utf8");
const connector = await readFile(new URL("../../../supabase/functions/_shared/discovery-search-connectors.mjs", import.meta.url), "utf8");
const auditMigration = await readFile(new URL("../../../supabase/migrations/20261124002000_discovery_search_preview_audit.sql", import.meta.url), "utf8");
const candidateMigration = await readFile(new URL("../../../supabase/migrations/20261128001000_discovery_search_candidate_persistence.sql", import.meta.url), "utf8");

test("E03 search preview is disabled unless the server-side SearXNG feature flag and endpoint are configured", () => {
  const actionStart = handler.indexOf('if (action === "search.preview")');
  const actionEnd = handler.indexOf('if (action === "workers.status")', actionStart);
  const action = handler.slice(actionStart, actionEnd);
  assert.match(action, /DISCOVERY_SEARXNG_ENABLED/);
  assert.match(action, /DISCOVERY_SEARXNG_URL/);
  assert.match(action, /DISCOVERY_SEARXNG_BEARER_TOKEN/);
  assert.match(action, /if \(profile\.enabled !== true\)/);
  assert.match(action, /discovery_profile_sources/);
  assert.match(action, /\.eq\("company_id", companyId\)/);
  assert.match(action, /\.eq\("status", "approved"\)/);
  assert.match(action, /assertSourceCanBeAttached/);
  assert.match(action, /source\.connector_key === "manual_research"/);
  const auditIndex = action.indexOf('action: "discovery_search_previewed"');
  const searchIndex = action.indexOf("searchSearxng(");
  assert.ok(auditIndex >= 0 && searchIndex > auditIndex, "audit receipt must be written before the provider call");
  assert.match(auditMigration, /'discovery_search_previewed'/);
  assert.match(auditMigration, /Raw search terms, snippets and result contents/);
});

test("E03 can discover candidate domains before any target source is attached, but keeps every result unfetchable", () => {
  const actionStart = handler.indexOf('if (action === "search.preview")');
  const actionEnd = handler.indexOf('if (action === "workers.status")', actionStart);
  const action = handler.slice(actionStart, actionEnd);
  assert.match(action, /sourceIds\.length[\s\S]*?data: \[\]/);
  assert.doesNotMatch(action, /if \(!sourceIds\.length\) return jsonResponse/);
  assert.doesNotMatch(action, /if \(!eligibleSources\.length\) return jsonResponse/);
  assert.match(action, /fetchEligible: Boolean\(approvedSource\)/);
  assert.match(queueUi, /if \(!selectedProfile\)/);
  assert.doesNotMatch(queueUi, /if \(!selectedProfile \|\| !eligibleSources\.length\)/);
  assert.match(queueUi, /exact URL path is registered, approved and attached/);
});

test("E03 returns unverified search candidates and never queues or fetches them automatically", () => {
  const actionStart = handler.indexOf('if (action === "search.preview")');
  const actionEnd = handler.indexOf('if (action === "workers.status")', actionStart);
  const action = handler.slice(actionStart, actionEnd);
  assert.match(action, /assertAllowedSourceUrl/);
  assert.match(action, /fetchEligible: Boolean\(approvedSource\)/);
  assert.match(action, /unverified candidates, not evidence or verified contacts/);
  assert.doesNotMatch(action, /jobs\.enqueue|fetchEvidence|discovery_jobs/);
});

test("E03 blocks sensitive Personal Loan and Litigation lender profile modes", () => {
  const actionStart = handler.indexOf('if (action === "search.preview")');
  const actionEnd = handler.indexOf('if (action === "workers.status")', actionStart);
  const action = handler.slice(actionStart, actionEnd);
  assert.match(action, /personal_loan.*CUSTOMER/);
  assert.match(action, /litigation.*LENDER/);
  assert.match(action, /disabledByPolicy/);
});

test("E03 UI only adds a search result to E04 when server confirms an attached approved source", () => {
  assert.match(queueUi, /invoke\("search\.preview"/);
  assert.match(queueUi, /status: "unverified_candidate"/);
  assert.match(queueUi, /candidate\.fetchEligible/);
  assert.match(queueUi, /candidate\.approvedSourceId/);
  assert.match(queueUi, /Add URL to E04 draft/);
  assert.match(queueUi, /No fetch permission/);
  assert.match(queueUi, /Candidate URL added to the E04 draft/);
  assert.ok(queueUi.includes(String.raw`current.split(/\r?\n/)`));
  assert.ok(queueUi.includes(String.raw`.join("\n")`));
  assert.doesNotMatch(queueUi, /searchResults\.map[\s\S]{0,300}fetch\(/);
});

test("E03 search connector has bounded result count, HTTPS-only output, and blocks person-centric social sites", () => {
  assert.match(connector, /MAX_RESULTS = 10/);
  assert.match(connector, /url\.protocol !== "https:"/);
  assert.match(connector, /linkedin\.com/);
  assert.match(connector, /facebook\.com/);
  assert.match(connector, /unverified_candidate/);
});

 
test("E03 search results are persisted idempotently per company/profile and reloaded on return", () => {
  const searchStart = handler.indexOf('if (action === "search.preview")');
  const searchEnd = handler.indexOf('if (action === "search.candidates.list")', searchStart);
  const searchAction = handler.slice(searchStart, searchEnd);
  assert.match(searchAction, /discovery_search_candidates/);
  assert.match(searchAction, /\.upsert\(candidateRows, \{ onConflict: "company_id,profile_id,canonical_url" \}\)/);
  assert.ok(handler.includes('action === "search.candidates.list"'));
  assert.match(handler, /resultsByProfile/);
  assert.match(candidateMigration, /unique \(company_id, profile_id, canonical_url\)/);
  assert.match(candidateMigration, /enable row level security/);
  assert.match(candidateMigration, /discovery_search_candidates_company_read/);
  assert.match(candidateMigration, /unverified_candidate/);
});

test("E03 search status requires an enabled HTTPS gateway, secure Vault token and healthy endpoint", () => {
  const statusStart = handler.indexOf('if (action === "search.status")');
  const statusEnd = handler.indexOf('if (action === "sources.list")', statusStart);
  const statusAction = handler.slice(statusStart, statusEnd);
  assert.ok(statusStart >= 0 && statusEnd > statusStart);
  assert.match(statusAction, /DISCOVERY_SEARXNG_ENABLED/);
  assert.match(statusAction, /DISCOVERY_SEARXNG_URL/);
  assert.match(statusAction, /get_axivestra_search_gateway_token/);
  assert.match(statusAction, /endpoint\.startsWith\("https:\/\/"\)/);
  assert.match(statusAction, /new URL\("\/healthz", endpoint\)/);
  assert.match(statusAction, /configured: configured && healthy/);
  assert.match(statusAction, /secure Vault token is not configured/);
  assert.match(statusAction, /live search gateway is not responding yet/);
  assert.doesNotMatch(statusAction, /configured: enabled && Boolean\(endpoint\)/);
});
