import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildProfessionalRoleCandidates } from "./professional-roles.mjs";

const worker = await readFile(new URL("./professional-role-worker.mjs", import.meta.url), "utf8");
const migration = await readFile(new URL("../../supabase/migrations/20261122210000_discovery_professional_roles.sql", import.meta.url), "utf8");

test("E07 worker is disabled by default and uses only server-side credentials", () => {
  assert.match(worker, /DISCOVERY_PROFESSIONAL_ROLE_WORKER_ENABLED !== "true"/);
  assert.match(worker, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(worker, /complete_discovery_professional_role_job/);
  assert.match(worker, /fail_discovery_professional_role_job/);
});

test("E07 only runs after a reviewed E06 entity assignment exists", () => {
  assert.match(migration, /after insert on public\.discovery_entity_assignments/);
  assert.match(migration, /exists \(\s*select 1 from public\.discovery_entity_assignments/);
  assert.match(migration, /owner-reviewed E06 assignment/);
});

test("E07 creates pending candidates only; owner/admin review creates canonical professional people", () => {
  assert.match(migration, /Only a company owner or admin can review professional roles/);
  assert.match(migration, /insert into public\.discovery_professional_people/);
  assert.match(migration, /insert into public\.discovery_professional_role_assignments/);
  assert.match(migration, /professional_role_review_recorded/);
  assert.doesNotMatch(worker, /insert into public\.discovery_professional_people/i);
});

test("E07 schema has no email, phone, consent or outreach fields", () => {
  const schema = migration.slice(migration.indexOf("create table if not exists public.discovery_professional_people"),
    migration.indexOf("create table if not exists public.discovery_professional_role_assignments"));
  assert.doesNotMatch(schema, /\b(email|phone|consent|outreach|linkedin|social_profile)\b/i);
});

test("E07 insufficient evidence cannot be promoted by the review RPC", () => {
  assert.match(migration, /candidate_state<>'pending_review'/);
  assert.match(migration, /lacks a source-backed role or reviewed employer link/);
  const candidate = buildProfessionalRoleCandidates({
    extractedEntities: [{ id: "p", entity_kind: "person", raw_name: "Asha Rao", confidence: 0.9 }],
    extractedFacts: [], assignments: [], canonicalEntities: [], evidenceId: "evidence", jurisdiction: "IN"
  })[0];
  assert.equal(candidate.candidate_state, "insufficient_evidence");
  assert.equal(candidate.canonical_entity_id, null);
});
