import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration=await readFile(new URL("../../../supabase/migrations/20261122300000_discovery_lead_workspace.sql",import.meta.url),"utf8");
const edge=await readFile(new URL("../../../supabase/functions/discovery-control/index.ts",import.meta.url),"utf8");
const ui=await readFile(new URL("../../../src/DiscoveryLeadWorkspace.tsx",import.meta.url),"utf8");

test("E15 creates a company-scoped lead pipeline from human-accepted E11 matches only",()=>{
  for(const table of ["discovery_leads","discovery_lead_match_reviews","discovery_lead_events"])
    assert.ok(migration.includes("create table if not exists public."+table),table);
  assert.match(migration,/unique\(company_id,match_result_id\)/);
  assert.match(migration,/review_state='pending_review'/);
  assert.match(migration,/eligible is not true/);
  assert.match(migration,/accepted_for_review/);
  assert.match(migration,/Rejected matches must not create leads|Only owner\/admin-accepted/);
});

test("E15 enforces owner/admin writes, company-member assignees and legal stage transitions",()=>{
  assert.match(migration,/role not in \('owner','admin'\)/);
  assert.match(migration,/assignee must be a member of this company/);
  assert.match(migration,/lead stage transition is not allowed/);
  assert.match(migration,/terminal leads can only be reopened to reviewing/);
  assert.match(migration,/deal_won/);
  assert.match(migration,/deal_lost/);
  assert.match(migration,/not_a_fit/);
  assert.match(migration,/next_action_code/);
});

test("E15 makes match reviews and workflow events append-only with company-member read policies",()=>{
  assert.match(migration,/before update or delete on public\.discovery_lead_match_reviews/);
  assert.match(migration,/before update or delete on public\.discovery_lead_events/);
  assert.match(migration,/public\.is_company_member\(company_id\)/);
  assert.match(migration,/revoke all on public\.discovery_leads,public\.discovery_lead_match_reviews,public\.discovery_lead_events/);
});

test("E15 extends E13 provenance for match reviews, lead creation and workflow changes",()=>{
  for(const kind of ["lead","lead_match_review"]) assert.match(migration,new RegExp("'" + kind + "'"));
  for(const event of ["lead_match_reviewed","lead_created","lead_assigned","lead_status_changed","lead_priority_changed","lead_next_action_set"])
    assert.match(migration,new RegExp("'" + event + "'"));
  assert.match(migration,/append_discovery_provenance_event/);
});

test("E15 edge actions are company-scoped and do not expose raw candidate snapshots",()=>{
  for(const action of ["matches.list","matches.review","leads.list","leads.assign","leads.transition","leads.priority","leads.next-action","members.list"])
    assert.ok(edge.includes('action === "'+action+'"'),action);
  assert.match(edge,/eq\("company_id", companyId\)/);
  assert.doesNotMatch(edge,/candidate_snapshot/);
  assert.match(edge,/record_discovery_match_review/);
  assert.match(edge,/assign_discovery_lead/);
  assert.match(edge,/transition_discovery_lead/);
});

test("E15 UI keeps review and workflow actions owner/admin-only and disables ineligible matches",()=>{
  assert.match(ui,/companyRole === "owner" \|\| companyRole === "admin"/);
  assert.match(ui,/disabled=\{!match\.eligible/);
  assert.match(ui,/matches\.review/);
  assert.match(ui,/leads\.assign/);
  assert.match(ui,/leads\.transition/);
  assert.match(ui,/leads\.priority/);
  assert.match(ui,/leads\.next-action/);
  assert.match(ui,/No email, phone, WhatsApp, underwriting or external outreach is triggered/);
});
