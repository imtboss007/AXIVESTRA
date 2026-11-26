import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration=await readFile(new URL("../../../supabase/migrations/20261122240000_discovery_enrichment.sql",import.meta.url),"utf8");
const worker=await readFile(new URL("../../discovery-worker/enrichment-worker.mjs",import.meta.url),"utf8");
const normalizer=await readFile(new URL("../../discovery-worker/enrichment.mjs",import.meta.url),"utf8");

test("E10 persists source-by-source observations and reviewable source-value conflicts",()=>{
 for(const table of [
  "discovery_enrichment_attribute_registry",
  "discovery_enrichment_jobs",
  "discovery_enrichment_observations",
  "discovery_enrichment_conflicts",
  "discovery_enrichment_review_events"
 ]) assert.ok(migration.includes("create table if not exists public."+table),table+" missing");
 assert.match(migration,/source_published_at timestamptz/);
 assert.match(migration,/evidence_captured_at timestamptz/);
 assert.match(migration,/evidence_content_hash text/);
 assert.match(migration,/source_attribution text/);
 assert.match(migration,/source_license_ref text/);
});

test("E10 accepts only the business, finance, property and operating attribute registry",()=>{
 for(const category of ["business","finance","property","operating"]) assert.ok(migration.includes("'"+category+"'"),category);
 assert.match(migration,/source_field_names text\[\]/);
 assert.match(migration,/accepted_value_types text\[\]/);
 assert.match(migration,/field_schema_snapshot/);
 assert.match(normalizer,/ATTRIBUTE_REGISTRY/);
 assert.match(normalizer,/getEnrichmentAttribute/);
});

test("E10 queue requires E06 assignment, source approval, exact enrichment purpose and unchanged E02 schema",()=>{
 assert.match(migration,/after insert on public\.discovery_entity_assignments/);
 assert.match(migration,/'enrichment'=any\(allowed_purposes\)/);
 assert.match(migration,/s\.field_schema=j\.field_schema_snapshot/);
 assert.match(migration,/s\.allowed_fields=j\.allowed_fields_snapshot/);
 assert.match(migration,/discovery_company_worker_controls/);
 assert.match(worker,/discovery_entity_assignments/);
});

test("E10 never auto-selects, converts or overwrites source values",()=>{
 assert.match(migration,/potential_value_disagreement/);
 assert.match(migration,/normalized_value is distinct from v_observation\.normalized_value/);
 assert.match(migration,/source_published_at/);
 assert.match(migration,/evidence_captured_at/);
 assert.doesNotMatch(migration,/update public\.discovery_canonical_entities\s+set/is);
 assert.doesNotMatch(worker,/fetch\s*\(|axios|got\(/);
 assert.doesNotMatch(normalizer,/email|phone|consent_state/i);
});

test("E10 conflicts require owner/admin review with explicit different-period, retain-both or source selection decision",()=>{
 assert.match(migration,/Only a company owner or admin can review enrichment observations/);
 assert.match(migration,/Only a company owner or admin can resolve enrichment conflicts/);
 assert.match(migration,/different_periods/);
 assert.match(migration,/retained_both/);
 assert.match(migration,/selected_a/);
 assert.match(migration,/selected_b/);
});
