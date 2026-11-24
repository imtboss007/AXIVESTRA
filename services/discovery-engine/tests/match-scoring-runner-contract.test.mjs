import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const handler = await readFile(new URL("../../../supabase/functions/discovery-control/index.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../../../supabase/migrations/20261124003000_discovery_match_scoring_runner.sql", import.meta.url), "utf8");
const dimensionMigration = await readFile(new URL("../../../supabase/migrations/20261124002500_discovery_e11_matching_dimensions.sql", import.meta.url), "utf8");
const matcher = await readFile(new URL("../../discovery-worker/matching.mjs", import.meta.url), "utf8");
const sharedMatcher = await readFile(new URL("../../../supabase/functions/_shared/discovery-matching.mjs", import.meta.url), "utf8");
const component = await readFile(new URL("../../../src/DiscoveryMatchScoringWorkspace.tsx", import.meta.url), "utf8");
const sourceManager = await readFile(new URL("../../../src/DiscoverySourceManager.tsx", import.meta.url), "utf8");
const enrichment = await readFile(new URL("../../discovery-worker/enrichment.mjs", import.meta.url), "utf8");

test("E11 evaluates only accepted E10 observations linked to attached, approved profile sources", () => {
  assert.match(handler, /action === "matches\.evaluate"/);
  assert.match(handler, /\.eq\("review_state", "accepted"\)/);
  assert.match(handler, /\.in\("source_id", eligibleSourceIds\)/);
  assert.match(handler, /buildE11CandidateFromAcceptedObservations/);
  assert.match(handler, /scoreDiscoveryMatch/);
  assert.match(migration, /o\.review_state='accepted'/);
  assert.match(migration, /public\.discovery_profile_sources/);
  assert.match(migration, /s\.status='approved'/);
  assert.match(migration, /v_profile\.purpose=any\(s\.allowed_purposes\)/);
});

test("E11 scoring criteria are workspace-specific and server-checked against the stored profile", () => {
  assert.match(handler, /profile\.criteria\?\.matchCriteria/);
  assert.match(migration, /p_criteria_snapshot <> coalesce\(v_profile\.criteria->'matchCriteria'/);
  assert.match(migration, /p_profile_id/);
  assert.match(migration, /v_profile\.workspace_key/);
  assert.match(migration, /v_profile\.discovery_mode/);
  assert.match(dimensionMigration, /'geography','type','sector','ticket','instrument','collateral','stage','mandate','evidence_freshness'/);
});

test("E11 score, components and audit receipt are written atomically by a service-role-only RPC", () => {
  assert.match(migration, /create or replace function public\.record_discovery_match_score/);
  assert.match(migration, /insert into public\.discovery_match_results/);
  assert.match(migration, /insert into public\.discovery_match_score_components/);
  assert.match(migration, /insert into public\.discovery_audit_events/);
  assert.match(migration, /'match_score_recorded','match_result'/);
  assert.match(migration, /revoke all on function public\.record_discovery_match_score/);
  assert.match(migration, /to service_role/);
});

test("E11 requires owner/admin and persists a pending-review score without creating a lead or sending outreach", () => {
  assert.match(handler, /Only company owners\/admins can run and persist E11 match scoring/);
  assert.match(migration, /Only a company owner or admin can persist an E11 match score/);
  assert.match(handler, /No lead, approval, contact or outreach was created/);
  assert.match(component, /Human review required/);
  assert.match(component, /Only a company owner or admin can create a persisted E11 score/);
});

test("E11 matching code has a single shared implementation used by Node tests and the Edge Function", () => {
  assert.match(matcher, /supabase\/functions\/_shared\/discovery-matching\.mjs/);
  assert.match(handler, /_shared\/discovery-matching\.mjs/);
  assert.match(sharedMatcher, /buildE11CandidateFromAcceptedObservations/);
  assert.match(sharedMatcher, /evidence_freshness/);
  assert.match(sharedMatcher, /"sector"/);
});

test("E10 attribute catalogue includes lender/customer match dimensions without private personal financial fields", () => {
  for (const field of ["lender_category","borrower_type","capital_instrument","collateral_type","startup_stage","investment_mandate","geography","city","district"]) {
    assert.match(enrichment, new RegExp('"' + field + '"'));
    assert.match(dimensionMigration, new RegExp("'" + field + "'"));
  }
  assert.doesNotMatch(enrichment, /define\([^\n]*personal_credit_score/);
  assert.match(component, /owner-accepted E10 observations/);
  assert.match(sourceManager, /DiscoveryMatchScoringWorkspace/);
});
