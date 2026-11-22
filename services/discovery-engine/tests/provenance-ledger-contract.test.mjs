import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../../../supabase/migrations/20261122280000_discovery_provenance_ledger.sql", import.meta.url), "utf8");

test("E13 creates a company-scoped append-only provenance event ledger", () => {
  assert.match(migration, /create table if not exists public\.discovery_provenance_events/);
  assert.match(migration, /references public\.companies\(id\) on delete cascade/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /public\.is_company_member\(company_id\)/);
  assert.match(migration, /before update on public\.discovery_provenance_events/);
  assert.match(migration, /revoke update,delete on public\.discovery_provenance_events[^;]*service_role/i);
  assert.match(migration, /unique\(company_id,origin_table,origin_record_id,event_type,subject_id\)/);
});

test("E13 records field-level source lineage and immutable source snapshots", () => {
  for (const value of [
    "source_registered", "source_approved", "evidence_captured",
    "source_observed", "extraction_reviewed", "identifier_recorded",
    "alias_recorded", "relationship_recorded", "professional_role_observed",
    "contact_candidate_observed", "place_candidate_observed", "match_score_recorded",
    "deduplication_candidate_created", "deduplication_reviewed", "enrichment_observed"
  ]) assert.ok(migration.includes("'" + value + "'"), value);
  for (const field of [
    "evidence_content_hash", "evidence_captured_at", "source_published_at",
    "source_name_snapshot", "source_domain_snapshot", "source_jurisdiction_snapshot",
    "source_attribution_snapshot", "source_license_ref_snapshot", "source_license_snapshot",
    "source_span", "actor_user_id"
  ]) assert.match(migration, new RegExp(field));
  assert.match(migration, /evidenceContentHash/);
  assert.match(migration, /sourceLicenseRef/);
  assert.match(migration, /left\(coalesce\(v_attribution/);
  assert.match(migration, /octet_length\(v_license::text\)>4000/);
});

test("E13 does not duplicate or leak raw source, contact or extracted values", () => {
  assert.match(migration, /raw values or source URLs are copied/);
  assert.match(migration, /masked',true/);
  assert.match(migration, /jsonb_object_keys\(p_source_span\)/);
  assert.match(migration, /'kind','start','end','locator','path','page','line','column'/);
  assert.doesNotMatch(migration, /selector|attribute'\s*\]\);/);
  assert.doesNotMatch(migration, /insert into public\.discovery_provenance_events[\s\S]{0,600}raw_value/i);
  assert.doesNotMatch(migration, /value_ciphertext|value_fingerprint/);
});

test("E13 automatically captures evidence, extraction, entity, contact, location and enrichment lineage", () => {
  for (const table of [
    "discovery_audit_events", "discovery_evidence_items", "discovery_fetch_events",
    "discovery_extracted_entities", "discovery_extracted_facts",
    "discovery_extraction_review_events", "discovery_canonical_entities",
    "discovery_entity_assignments", "discovery_entity_identifiers",
    "discovery_entity_aliases", "discovery_entity_relationships",
    "discovery_professional_role_candidates", "discovery_professional_role_assignments",
    "discovery_professional_role_review_events", "discovery_contact_candidates",
    "discovery_contact_points", "discovery_place_candidates",
    "discovery_place_resolution_events", "discovery_enrichment_observations",
    "discovery_enrichment_review_events", "discovery_match_results",
    "discovery_deduplication_candidates", "discovery_deduplication_review_events"
  ]) assert.ok(migration.includes("'" + table + "'"), table);
  assert.match(migration, /after insert on public\.%I for each row execute function public\.capture_discovery_provenance_trigger/);
  assert.match(migration, /Backfill provenance for records created before E13 was installed/);
});

test("E13 lineage remains traceable after raw evidence retention purge", () => {
  assert.match(migration, /evidence_retention_purged/);
  assert.match(migration, /case[\s\S]*when p\.evidence_id is null then null[\s\S]*then false[\s\S]*else true/);
  assert.match(migration, /create or replace view public\.discovery_field_provenance/);
  assert.match(migration, /with \(security_invoker=true\)/);
});
