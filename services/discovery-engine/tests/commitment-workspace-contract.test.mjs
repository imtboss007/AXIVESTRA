import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration=await readFile(new URL("../../../supabase/migrations/20261122330000_axivestra_commitment_workspace.sql",import.meta.url),"utf8");
const ui=await readFile(new URL("../../../src/CompanyCommitmentWorkspace.tsx",import.meta.url),"utf8");

test("E18 creates typed company commitments with optional canonical deal and party links",()=>{
  assert.match(migration,/create table if not exists public\.company_action_commitments/);
  assert.match(migration,/commitment_type in \('task','promise','obligation','milestone'\)/);
  assert.match(migration,/foreign key\(company_id,deal_record_type,deal_record_key\)/);
  assert.match(migration,/foreign key\(company_id,party_record_type,party_record_key\)/);
  assert.match(migration,/foreign key\(company_id,relationship_id\)/);
  assert.match(migration,/foreign key\(company_id,source_task_record_type,source_task_record_key\)/);
});

test("E18 protects company membership, responsible-member assignment and staff permissions",()=>{
  assert.match(migration,/public\.is_company_member\(company_id\)/);
  assert.match(migration,/public\.has_company_role\(company_id,array\['owner','admin','manager','staff'\]\)/);
  assert.match(migration,/Responsible user must be a member of this company/);
  assert.match(migration,/Staff can only assign commitments to themselves/);
  assert.match(migration,/Staff can only update commitments assigned to them or created by them/);
  assert.match(migration,/Commitments cannot be hard-deleted/);
});

test("E18 guards lifecycle transitions, explicit reopen and close timestamps",()=>{
  assert.match(migration,/Commitment status transition is not allowed/);
  assert.match(migration,/Completed commitments can only be reopened to in_progress with a reason/);
  assert.match(migration,/Cancelled commitments are terminal/);
  assert.match(migration,/new\.closed_at:=case when new\.status in \('completed','cancelled'\)/);
  assert.match(migration,/change_reason_code/);
});

test("E18 captures immutable creation, status, assignment and due-date history",()=>{
  assert.match(migration,/create table if not exists public\.company_commitment_events/);
  for(const event of ["commitment_created","status_changed","assignee_changed","due_date_changed","details_changed"])
    assert.match(migration,new RegExp("'" + event + "'"));
  assert.match(migration,/Commitment event history is immutable/);
  assert.match(migration,/after insert or update on public\.company_action_commitments/);
});

test("E18 inbox derives due states from stored due dates without an automatic worker",()=>{
  assert.match(migration,/create or replace view public\.company_commitment_inbox/);
  for(const state of ["closed","no_due_date","due_today","overdue","upcoming"])
    assert.match(migration,new RegExp("'" + state + "'"));
  assert.match(migration,/days_overdue/);
  assert.doesNotMatch(migration,/create extension.*cron|pg_cron|create.*worker|schedule.*job/i);
});

test("E18 does not overwrite the legacy local task register or delete prior records",()=>{
  assert.match(migration,/Existing local task collections are not rewritten or deleted/);
  assert.doesNotMatch(migration,/update public\.company_records|delete from public\.company_records/i);
  assert.match(migration,/source_task_record_key/);
});

test("E18 overview workspace creates and manages typed commitments with saved membership and due-state context",()=>{
  for(const action of ["company_action_commitments","company_commitment_inbox","responsible_user_id","change_reason_code","due_at"])
    assert.match(ui,new RegExp(action));
  assert.match(ui,/commitment_type:kind/);
  assert.match(ui,/getUser\(\)/);
  assert.match(ui,/Save status/);
  assert.match(ui,/Save date/);
  assert.match(ui,/Save status|changeAssignee/);
  assert.match(ui,/recurring reminders and message delivery are not enabled/);
});
