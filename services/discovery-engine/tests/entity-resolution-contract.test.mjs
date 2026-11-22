import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../../../supabase/migrations/20261122200000_discovery_entity_intelligence.sql", import.meta.url), "utf8");
const worker = await readFile(new URL("../../discovery-worker/entity-resolution-worker.mjs", import.meta.url), "utf8");
const matcher = await readFile(new URL("../../discovery-worker/entity-resolution.mjs", import.meta.url), "utf8");

test("E06 persists canonical organisations, aliases, identifiers and evidence-backed relationships", () => {
  for (const table of [
    "discovery_canonical_entities",
    "discovery_entity_identifiers",
    "discovery_entity_aliases",
    "discovery_entity_match_candidates",
    "discovery_entity_assignments",
    "discovery_entity_relationships",
    "discovery_entity_review_events"
  ]) {
    assert.ok(migration.includes("create table if not exists public." + table), table + " migration table missing");
  }
  assert.match(migration, /source_evidence_id/);
  assert.match(migration, /source_span jsonb/);
  assert.match(migration, /extraction_run_id, extracted_entity_id and source_evidence_id are historical/);
  assert.match(migration, /candidate_id remains a historical reference after E05 evidence retention/);
  assert.match(migration, /discovery_entity_identifiers_accepted_unique/);
});

test("E06 resolution work is enqueued only from a completed E05 extraction run", () => {
  assert.match(migration, /enqueue_discovery_entity_resolution_job/);
  assert.match(migration, /new\.status in \('completed','completed_with_warnings'\)/);
  assert.match(migration, /for update of j skip locked/);
  assert.match(migration, /r\.source_content_hash=e\.content_hash/);
});

test("E06 commits company-scoped candidates without rewriting immutable E05 facts", () => {
  assert.match(migration, /complete_discovery_entity_resolution/);
  assert.match(migration, /discovery_extracted_entities/);
  assert.match(worker, /from\("discovery_extracted_facts"\)/);
  assert.match(worker, /complete_discovery_entity_resolution/);
  assert.doesNotMatch(worker, /update\([^)]*\)\.from\("discovery_extracted_facts"\)/);
});

test("E06 review is owner/admin-only and appends a review, assignment and audit receipt", () => {
  const start = migration.indexOf("create or replace function public.record_discovery_entity_resolution_review");
  const end = migration.indexOf("create or replace function public.prevent_discovery_entity_record_update");
  assert.ok(start >= 0 && end > start);
  const review = migration.slice(start, end);
  assert.match(review, /company_memberships/);
  assert.match(review, /role not in \('owner','admin'\)/);
  assert.match(review, /insert into public.discovery_entity_review_events/);
  assert.match(review, /insert into public.discovery_entity_assignments/);
  assert.match(review, /insert into public.discovery_audit_events/);
});

test("E06 legal-entity relationship writes require an evidence-backed owner/admin review", () => {
  assert.match(migration, /record_discovery_entity_relationship_review/);
  assert.match(migration, /Only a company owner or admin can review entity relationships/);
  assert.match(migration, /entity_relationship_review_recorded/);
  assert.match(migration, /source_span jsonb not null/);
  assert.match(migration, /evidence_id is not null/);
});

test("E06 matching prefers scoped exact identifiers and never allows automatic linking", () => {
  assert.match(matcher, /exact_identifier/);
  assert.match(matcher, /normalizeJurisdiction/);
  assert.match(matcher, /trigramDiceSimilarity/);
  assert.match(matcher, /auto_link_permitted: false/);
  assert.match(matcher, /human_review_required: true/);
  assert.doesNotMatch(worker, /insert into public\.discovery_canonical_entities/i);
});
