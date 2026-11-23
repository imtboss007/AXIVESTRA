import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration=await readFile(new URL("../../../supabase/migrations/20261123110000_axivestra_verification_confidence.sql",import.meta.url),"utf8");
const ui=await readFile(new URL("../../../src/DiscoveryVerificationWorkspace.tsx",import.meta.url),"utf8");
const manager=await readFile(new URL("../../../src/DiscoverySourceManager.tsx",import.meta.url),"utf8");

test("E19 opens company-scoped verification cases from the existing provenance ledger",()=>{
  assert.match(migration,/create table if not exists public\.discovery_verification_cases/);
  assert.match(migration,/after insert on public\.discovery_provenance_events/);
  assert.match(migration,/sync_discovery_verification_provenance/);
  assert.match(migration,/on conflict\(company_id,subject_kind,subject_id\) do nothing/);
  assert.match(migration,/Backfilled from the existing company-scoped provenance ledger/);
  assert.match(migration,/unique\(company_id,subject_kind,subject_id\)/);
});

test("E19 links immutable provenance metadata without copying source or personal content",()=>{
  assert.match(migration,/references public\.discovery_provenance_events\(id\) on delete restrict/);
  assert.match(migration,/source_domain_snapshot/);
  assert.match(migration,/evidence_content_hash/);
  assert.match(migration,/default_classification/);
  assert.doesNotMatch(migration,/raw_value|normalized_value|canonical_url|value_ciphertext|value_fingerprint/);
  assert.match(migration,/source body, URL, extracted value or contact data is copied/);
});

test("E19 confidence index is explainable and explicitly non-probabilistic",()=>{
  assert.match(migration,/independent_source_count/);
  assert.match(migration,/hashed_evidence_count/);
  assert.match(migration,/supporting_evidence_count/);
  assert.match(migration,/contradicting_evidence_count/);
  assert.match(migration,/confidence_index/);
  assert.match(migration,/not a probability or automatic truth decision/);
  assert.match(migration,/least\(coalesce\(t\.independent_source_count,0\),3\)/);
});

test("E19 review and evidence classification require owner/admin reasoned decisions",()=>{
  assert.match(migration,/record_discovery_verification_review/);
  assert.match(migration,/record_discovery_verification_evidence_classification/);
  assert.match(migration,/coalesce\(v_role,''\) not in \('owner','admin'\)/);
  assert.match(migration,/length\(trim\(p_reason\)\)<10/);
  assert.match(migration,/Verification requires supporting evidence/);
  assert.match(migration,/verification_review_recorded/);
  assert.match(migration,/verification_evidence_classified/);
});

test("E19 events are append-only and new evidence reopens prior verification decisions",()=>{
  assert.match(migration,/before update or delete on public\.discovery_verification_events/);
  assert.match(migration,/case_reopened_after_new_evidence/);
  assert.match(migration,/New source-backed provenance arrived after a prior verification decision/);
  assert.match(migration,/grant select on public\.discovery_verification_cases/);
  assert.doesNotMatch(migration,/grant .*insert.*discovery_verification_cases to authenticated/i);
});

test("E19 UI is surfaced inside the company Discovery workspace with owner/admin actions",()=>{
  assert.match(manager,/DiscoveryVerificationWorkspace/);
  assert.match(ui,/discovery_verification_inbox/);
  assert.match(ui,/record_discovery_verification_review/);
  assert.match(ui,/record_discovery_verification_evidence_classification/);
  assert.match(ui,/companyRole==="owner"\|\|companyRole==="admin"/);
  assert.match(ui,/supporting/);
  assert.match(ui,/contradicting/);
  assert.match(ui,/Confidence index/);
});
