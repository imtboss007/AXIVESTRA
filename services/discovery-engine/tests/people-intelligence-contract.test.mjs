import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration=await readFile(new URL("../../../supabase/migrations/20261122210000_discovery_people_intelligence.sql",import.meta.url),"utf8");
const worker=await readFile(new URL("../../discovery-worker/people-intelligence-worker.mjs",import.meta.url),"utf8");
const matcher=await readFile(new URL("../../discovery-worker/people-intelligence.mjs",import.meta.url),"utf8");

test("E07 stores only a public name, explicit role and source locators",()=>{
  const start=migration.indexOf("create table if not exists public.discovery_public_person_role_candidates");
  const end=migration.indexOf("create index if not exists discovery_public_person_role_review_idx",start);
  assert.ok(start>=0&&end>start);
  const table=migration.slice(start,end);
  assert.match(table,/person_name text/);
  assert.match(table,/role_title text/);
  assert.match(table,/person_source_span jsonb/);
  assert.match(table,/role_source_span jsonb/);
  assert.doesNotMatch(table,/\b(email|phone|address|date_of_birth|pan|personal_identifier)\s+text\b/i);
  assert.match(table,/on delete cascade/);
});

test("E07 jobs are enqueued only after an owner-approved E06 company assignment",()=>{
  assert.match(migration,/after insert on public\.discovery_entity_assignments/);
  assert.match(migration,/new\.canonical_entity_id/);
  assert.match(migration,/entity_kind='person'/);
  assert.match(migration,/for update of j skip locked/);
});

test("E07 worker reads only the fixed public role-field allowlist and has no external crawler",()=>{
  assert.match(worker,/ROLE_FIELDS/);
  assert.match(worker,/\.in\("field_name",ROLE_FIELDS\)/);
  assert.match(worker,/DISCOVERY_PUBLIC_PERSON_ROLE_WORKER_ENABLED/);
  assert.doesNotMatch(worker,/crawlee|playwright|fetch\(/i);
});

test("E07 SQL verifies source-backed person names and role-field values before candidate persistence",()=>{
  assert.match(migration,/x\.source_span=v_candidate->'person_source_span'/);
  assert.match(migration,/f\.field_name=any\(array/);
  assert.match(migration,/f\.source_span=v_candidate->'role_source_span'/);
  assert.match(migration,/same_source_row/);
  assert.match(migration,/unique_company_run/);
});

test("E07 review is owner/admin-only and appends review plus audit events",()=>{
  assert.match(migration,/record_discovery_public_person_role_review/);
  assert.match(migration,/Only a company owner or admin can review public person roles/);
  assert.match(migration,/insert into public\.discovery_public_person_role_review_events/);
  assert.match(migration,/insert into public\.discovery_audit_events/);
});

test("E07 personal role observations and review history expire with source evidence",()=>{
  assert.match(migration,/foreign key \(company_id,source_evidence_id\)[\s\S]{0,150}on delete cascade/);
  assert.match(migration,/foreign key \(company_id,candidate_id\)[\s\S]{0,150}on delete cascade/);
  assert.match(matcher,/personal_contact_details_collected: false/);
  assert.match(matcher,/auto_link_permitted: false/);
});
