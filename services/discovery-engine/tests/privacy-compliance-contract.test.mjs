import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration=await readFile(new URL("../../../supabase/migrations/20261122290000_discovery_privacy_compliance.sql",import.meta.url),"utf8");

test("E14 adds owner/admin privacy policies, verified request intake and company-scoped subject references",()=>{
  for(const table of [
    "discovery_privacy_processing_policies","discovery_privacy_requests",
    "discovery_privacy_request_subjects","discovery_privacy_events",
    "discovery_privacy_retention_queue"
  ]) assert.ok(migration.includes("create table if not exists public."+table),table);
  assert.match(migration,/public\.has_company_role\(company_id,array\['owner','admin'\]\)/);
  assert.match(migration,/company_memberships where company_id=p_company_id and user_id=p_actor_user_id and role in \('owner','admin'\)/);
  assert.doesNotMatch(migration,/if not public\.has_company_role\(p_company_id/);
  assert.match(migration,/p_requester_reference_hmac/);
  assert.match(migration,/identity_verification_pending/);
  assert.match(migration,/requester_reference_hmac text check/);
  assert.doesNotMatch(migration,/requester_name|requester_email|requester_phone/i);
});

test("E14 verifies identity before attaching any subject record and rejects cross-company references",()=>{
  assert.match(migration,/request must be identity-verified before records are attached/);
  assert.match(migration,/where company_id=\$1 and id=\$2/);
  assert.match(migration,/Unsupported E14 data subject table/);
  assert.match(migration,/only a company owner\/admin may scope a privacy request/i);
});

test("E14 preserves immutable privacy event receipts and explicit request resolution",()=>{
  assert.match(migration,/before update or delete on public\.discovery_privacy_events/);
  assert.match(migration,/E14 privacy events are immutable/);
  assert.match(migration,/all scoped subjects must be resolved before request completion/);
  assert.match(migration,/privacy_request_fulfilled/);
});

test("E14 performs minimisation-aware erasure for contact and professional identity data",()=>{
  assert.match(migration,/foreign key\(professional_person_id\) references public\.discovery_professional_people\(id\) on delete set null/);
  assert.match(migration,/delete from public\.discovery_contact_points/);
  assert.match(migration,/delete from public\.discovery_professional_people/);
  assert.match(migration,/delete from public\.discovery_extracted_entities/);
  assert.match(migration,/delete from public\.discovery_extracted_facts/);
  assert.match(migration,/E14 company-scoped erasure helper/);
  assert.match(migration,/E08 contact validation events are append-only except for privacy subject detachment/);
  assert.match(migration,/subjectErased/);
});

test("E14 only queues expiry where a reviewed purpose and current privacy policy match",()=>{
  assert.match(migration,/policy\.processing_purpose=p\.purpose/);
  assert.match(migration,/policy\.processing_purpose=c\.purpose/);
  assert.match(migration,/least\(p\.retention_until,\(p\.created_at\+make_interval\(days=>policy\.maximum_retention_days\)\)::date\)/);
  assert.match(migration,/least\(c\.retention_until,\(c\.created_at\+make_interval\(days=>policy\.maximum_retention_days\)\)::date\)/);
  assert.match(migration,/policy\.active=true/);
  assert.match(migration,/review_due_at>=current_date/);
  assert.match(migration,/Only a company owner\/admin may execute E14 retention erasure/);
  assert.match(migration,/no automatic purge worker is enabled/);
});

test("E14 keeps all request and erasure RPCs service-role gated",()=>{
  for(const fn of [
    "record_discovery_privacy_policy","create_discovery_privacy_request",
    "verify_discovery_privacy_request","attach_discovery_privacy_request_subject",
    "apply_discovery_privacy_subject_action","complete_discovery_privacy_request",
    "enqueue_expired_discovery_personal_data","process_discovery_privacy_retention_queue"
  ]) assert.match(migration,new RegExp("grant execute on function public\\."+fn+"\\("));
  assert.match(migration,/revoke all on function public\.erase_discovery_personal_subject/);
  assert.doesNotMatch(migration,/grant execute on function public\.erase_discovery_personal_subject/);
});
