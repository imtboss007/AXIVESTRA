import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../../../supabase/migrations/20261122220000_discovery_contact_validation.sql", import.meta.url), "utf8");
const worker = await readFile(new URL("../../discovery-worker/contact-validation-worker.mjs", import.meta.url), "utf8");
const validator = await readFile(new URL("../../discovery-worker/contact-validation.mjs", import.meta.url), "utf8");

test("E08 persists observed contact values only as authenticated ciphertext and keyed fingerprints", () => {
  for (const table of [
    "discovery_contact_validation_jobs",
    "discovery_contact_candidates",
    "discovery_contact_points",
    "discovery_contact_validation_events"
  ]) assert.ok(migration.includes("create table if not exists public." + table), table + " missing");
  assert.match(migration, /value_ciphertext text not null/);
  assert.match(migration, /value_nonce text not null/);
  assert.match(migration, /value_auth_tag text not null/);
  assert.match(migration, /value_fingerprint text not null/);
  assert.match(migration, /encryption_version text not null check \(encryption_version='aes-256-gcm-v1'\)/);
  assert.doesNotMatch(migration, /\b(raw_value|email_address|phone_number)\s+text\b/i);
});

test("E08 queue requires approved source, unchanged field schema, succeeded parent job, enabled profile and worker grant", () => {
  assert.match(migration, /after insert on public\.discovery_extraction_runs/);
  assert.match(migration, /s\.field_schema=j\.field_schema_snapshot/);
  assert.match(migration, /s\.allowed_fields=j\.allowed_fields_snapshot/);
  assert.match(migration, /wc\.enabled=true/);
  assert.match(migration, /wc\.expires_at>v_now/);
  assert.match(migration, /dj\.status='succeeded'/);
  assert.match(migration, /p\.enabled=true/);
});

test("E08 completion verifies each contact against a valid, source-allow-listed E05 fact", () => {
  assert.match(migration, /f\.validation_status='valid'/);
  assert.match(migration, /f\.field_name=v_field/);
  assert.match(migration, /f\.value_type=v_type/);
  assert.match(migration, /f\.source_span=coalesce\(v_candidate->'source_span'/);
  assert.match(migration, /v_job\.field_schema_snapshot->v_field->>'type' is distinct from v_type/);
});

test("E08 contact-point approval requires owner/admin, syntax-valid evidence, purpose, retention and an entity association", () => {
  assert.match(migration, /Only a company owner or admin can review contact points/);
  assert.match(migration, /E08 syntax-invalid contact cannot be approved/);
  assert.match(migration, /E08 processing purpose is required/);
  assert.match(migration, /E08 retention expiry must be explicit and no more than 365 days away/);
  assert.match(migration, /A reviewed company or professional-person association is required/);
  assert.match(migration, /contact_point_review_recorded/);
});

test("E08 validation history keeps catch-all and bounce separate and is append-only", () => {
  assert.match(migration, /catch_all_result boolean/);
  assert.match(migration, /bounce_type text/);
  assert.match(migration, /'catch_all'/);
  assert.match(migration, /'hard_bounce'/);
  assert.match(migration, /before update or delete on public\.discovery_contact_validation_events/);
});

test("E08 worker is disabled by default and has no active external validator/network call", () => {
  assert.match(worker, /DISCOVERY_CONTACT_VALIDATION_WORKER_ENABLED !== "true"/);
  assert.match(worker, /DISCOVERY_CONTACT_ENCRYPTION_KEY/);
  assert.match(worker, /DISCOVERY_CONTACT_FINGERPRINT_KEY/);
  assert.doesNotMatch(worker, /fetch\s*\(/);
  assert.doesNotMatch(worker, /axios|got\(|https?\.request/);
  assert.doesNotMatch(worker, /permitted_to_contact|consent_state/i);
  assert.match(validator, /createCipheriv\("aes-256-gcm"/);
  assert.match(validator, /createHmac\("sha256"/);
  assert.match(validator, /international_e164_required_no_country_guessing/);
});
