import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

test("E22 suggestion persistence is company-scoped and bound to an E11 result", async () => {
  const sql = await read("supabase/migrations/20261123270000_axivestra_e22_ai_matching_review.sql");
  assert.match(sql, /foreign key\(company_id,match_result_id\)[\s\S]*references public\.discovery_match_results\(company_id,id\)/i);
  assert.ok(sql.includes("unique(company_id,match_result_id,request_hash,provider_id,model_version)"));
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /security_invoker=true/i);
  assert.ok(sql.includes("public.is_company_member(company_id)"));
  assert.ok(sql.includes("grant select on public.discovery_ai_match_suggestions to service_role"));
});

test("only the isolated service role can persist validated suggestions", async () => {
  const sql = await read("supabase/migrations/20261123270000_axivestra_e22_ai_matching_review.sql");
  assert.ok(sql.includes("if coalesce(auth.role(),'') <> 'service_role' then"));
  assert.match(sql, /grant execute on function public\.record_discovery_ai_match_suggestion[\s\S]*to service_role/i);
  assert.ok(sql.includes("p_suggestion->>'recommendation' not in ('possible_match','not_a_match','insufficient_evidence')"));
  assert.ok(sql.includes("E22 request integrity hash is invalid."));
  assert.ok(sql.includes("E22 rationale contains an unapproved criterion, code or evidence reference."));
});

test("owner/admin review is reasoned, bounded and append-only", async () => {
  const sql = await read("supabase/migrations/20261123270000_axivestra_e22_ai_matching_review.sql");
  assert.ok(sql.includes("if v_actor is null or coalesce(v_role,'') not in ('owner','admin') then"));
  assert.ok(sql.includes("('accepted_for_review','rejected','needs_more_evidence')"));
  assert.ok(sql.includes("A review reason of 10–1000 characters is required."));
  assert.match(sql, /before update or delete on public\.discovery_ai_match_suggestion_events/i);
  assert.match(sql, /discovery_ai_match_suggestion_events_immutable/i);
});

test("E22 owner/admin review desk is mounted in the existing discovery workspace", async () => {
  const manager = await read("src/DiscoverySourceManager.tsx");
  const component = await read("src/DiscoveryAiMatchingReviewWorkspace.tsx");
  assert.match(manager, /import DiscoveryAiMatchingReviewWorkspace/);
  assert.ok(manager.includes("<DiscoveryAiMatchingReviewWorkspace companyId={companyId} companyRole={companyRole}/>"));
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

test("E22 authenticated browser acceptance remains provider-off and fixture-gated", async () => {
  const browser = await read("tests/browser/axivestra-ai-matching-review.spec.ts");
  const workflow = await read(".github/workflows/discovery-governance-checks.yml");
  const component = await read("src/DiscoveryAiMatchingReviewWorkspace.tsx");
  assert.match(component, /data-testid="e22-review-workspace"/);
  assert.match(component, /data-suggestion-id=\{item\.id\}/);
  assert.match(browser, /AXIVESTRA_E2E_E22_SUGGESTION_ID/);
  assert.match(browser, /Provider execution remains disabled by default/);
  assert.match(browser, /Deliberately do not submit/);
  assert.match(workflow, /tests\/browser\/axivestra-ai-matching-review\.spec\.ts/);
  assert.match(workflow, /AXIVESTRA_E2E_E22_SUGGESTION_ID/);
  assert.match(workflow, /Validate authenticated browser acceptance test discovery/);
});
