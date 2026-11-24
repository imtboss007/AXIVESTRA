import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

test("E22 suggestion persistence is company-scoped and bound to an E11 result", async () => {
  const sql = await read("supabase/migrations/20261123270000_axivestra_e22_ai_matching_review.sql");
  assert.match(sql, /foreign key\(company_id,match_result_id\)[\s\S]*references public\.discovery_match_results\(company_id,id\)/i);
  assert.match(sql, /unique\(company_id,match_result_id,request_hash\)/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /security_invoker=true/i);
  assert.match(sql, /public\.is_company_member\(company_id\)/i);
});

test("only the isolated service role can persist validated suggestions", async () => {
  const sql = await read("supabase/migrations/20261123270000_axivestra_e22_ai_matching_review.sql");
  assert.match(sql, /coalesce\(auth\.role\(\),' '\) <> 'service_role'/i);
  assert.match(sql, /grant execute on function public\.record_discovery_ai_match_suggestion[\s\S]*to service_role/i);
  assert.match(sql, /recommendation' not in \('possible_match','not_a_match','insufficient_evidence'\)/i);
  assert.match(sql, /request integrity hash is invalid/i);
  assert.match(sql, /evidence reference/i);
});

test("owner/admin review is reasoned, bounded and append-only", async () => {
  const sql = await read("supabase/migrations/20261123270000_axivestra_e22_ai_matching_review.sql");
  assert.match(sql, /coalesce\\(v_role,''\\) not in \('owner','admin'\)/i);
  assert.match(sql, /accepted_for_review','rejected','needs_more_evidence/i);
  assert.match(sql, /10–1000 characters/i);
  assert.match(sql, /before update or delete on public\.discovery_ai_match_suggestion_events/i);
  assert.match(sql, /discovery_ai_match_suggestion_events_immutable/i);
});

test("E22 owner/admin review desk is mounted in the existing discovery workspace", async () => {
  const manager = await read("src/DiscoverySourceManager.tsx");
  const component = await read("src/DiscoveryAiMatchingReviewWorkspace.tsx");
  assert.match(manager, /import DiscoveryAiMatchingReviewWorkspace/);
  assert.match(manager, /<DiscoveryAiMatchingReviewWorkspace companyId=\{companyId\} companyRole=\{companyRole\} \/>/);
  assert.match(component, /companyRole === "owner" \|\| companyRole === "admin"/);
  assert.match(component, /review_discovery_ai_match_suggestion/);
  assert.match(component, /deterministic_score/);
  assert.match(component, /Immutable history/);
});

test("E22 review desk does not activate a model provider or mutate E11", async () => {
  const component = await read("src/DiscoveryAiMatchingReviewWorkspace.tsx");
  const sql = await read("supabase/migrations/20261123270000_axivestra_e22_ai_matching_review.sql");
  assert.match(component, /Provider execution remains disabled by default/);
  assert.match(component, /E11 match result and canonical records were not changed/);
  assert.match(sql, /No AI suggestion approves, rejects, mutates canonical data or promotes a lead/);
  assert.doesNotMatch(sql, /create or replace function public\.(approve|promote|merge)_/i);
});
