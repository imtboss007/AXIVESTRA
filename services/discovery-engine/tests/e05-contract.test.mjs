import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../../../supabase/migrations/20261122190000_discovery_extraction.sql", import.meta.url), "utf8");
const worker = await readFile(new URL("../../discovery-worker/extraction-worker.mjs", import.meta.url), "utf8");
const extractor = await readFile(new URL("../../discovery-worker/extractor.mjs", import.meta.url), "utf8");
const control = await readFile(new URL("../../../supabase/functions/discovery-control/index.ts", import.meta.url), "utf8");
const reviewUi = await readFile(new URL("../../../src/DiscoveryExtractionResults.tsx", import.meta.url), "utf8");

test("E05 stores typed candidate facts and unresolved mentions against immutable evidence", () => {
  assert.match(migration, /create table if not exists public\.discovery_extraction_runs/);
  assert.match(migration, /create table if not exists public\.discovery_extracted_entities/);
  assert.match(migration, /create table if not exists public\.discovery_extracted_facts/);
  assert.match(migration, /source_span jsonb not null/);
  assert.match(migration, /source_content_hash text not null/);
  assert.match(migration, /confidence numeric\(4,3\) not null/);
});

test("E05 extraction claims wait for a terminal E04 job and active profile/source attachment", () => {
  const claim = migration.slice(migration.indexOf("create or replace function public.claim_discovery_extraction_job"), migration.indexOf("create or replace function public.heartbeat_discovery_extraction_job"));
  assert.match(claim, /dj\.status = 'succeeded'/);
  assert.match(claim, /p\.enabled = true/);
  assert.match(claim, /public\.discovery_profile_sources/);
  assert.match(claim, /for update of j skip locked/);
});

test("E05 commit atomically rechecks source schema snapshot, evidence hash and company scope", () => {
  const complete = migration.slice(migration.indexOf("create or replace function public.complete_discovery_extraction"), migration.indexOf("create or replace function public.fail_discovery_extraction_job"));
  assert.match(complete, /source_field_schema_snapshot/);
  assert.match(complete, /source_allowed_fields_snapshot/);
  assert.match(complete, /source_content_hash/);
  assert.match(complete, /v_source\.allowed_fields/);
  assert.match(complete, /v_source\.field_schema/);
});

test("E05 worker is disabled by default and verifies immutable evidence bytes before parsing", () => {
  assert.match(worker, /DISCOVERY_EXTRACTION_WORKER_ENABLED !== "true"/);
  assert.match(worker, /createHash\("sha256"\)/);
  assert.match(worker, /actualHash !== evidence\.content_hash/);
  assert.match(worker, /complete_discovery_extraction/);
  assert.match(extractor, /isEvalSupported: false/);
  assert.match(extractor, /MAX_OBSERVATIONS/);
});

test("E05 extraction uses bounded parallel slots backed by PostgreSQL SKIP LOCKED claims", () => {
  assert.match(worker, /DISCOVERY_EXTRACTION_CONCURRENCY \|\| 2/);
  assert.match(worker, /Math\.min\(4,/);
  assert.match(worker, /Promise\.all\(workerSlots\.map/);
  assert.match(worker, /runExtractionWorkerOnce\(admin, slotId\)/);
  assert.match(migration, /for update of j skip locked/);
});

test("PDF parser releases the PDF.js loading task and keeps OCR disabled", () => {
  assert.match(extractor, /const loadingTask = getDocument/);
  assert.match(extractor, /await loadingTask\.destroy\(\)/);
  assert.match(extractor, /OCR is not enabled/);
});

test("E05 human review and audit receipt use one owner/admin-only database transaction", () => {
  assert.match(migration, /create or replace function public\.record_discovery_extraction_review/);
  assert.match(migration, /Only a company owner or admin can review extracted facts/);
  const review = migration.slice(migration.indexOf("create or replace function public.record_discovery_extraction_review"), migration.indexOf("-- Extraction results are immutable snapshots"));
  assert.match(review, /insert into public\.discovery_extraction_review_events/);
  assert.match(review, /insert into public\.discovery_audit_events/);
  assert.match(control, /admin\.rpc\("record_discovery_extraction_review"/);
  assert.doesNotMatch(control, /admin\.from\("discovery_extraction_review_events"\)\.insert/);
});

test("E05 UI exposes evidence spans and keeps review decisions separate from immutable facts", () => {
  assert.match(reviewUi, /Evidence span/);
  assert.match(reviewUi, /Original source/);
  assert.match(reviewUi, /The original extracted fact remains immutable/);
  assert.match(reviewUi, /companyRole===\"owner\"\|\|companyRole===\"admin\"/);
});
