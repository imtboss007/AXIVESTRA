import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../../../supabase/migrations/20261122210000_discovery_professional_roles.sql", import.meta.url), "utf8");
const worker = await readFile(new URL("../../discovery-worker/professional-role-worker.mjs", import.meta.url), "utf8");
const matcher = await readFile(new URL("../../discovery-worker/professional-roles.mjs", import.meta.url), "utf8");

test("E07 stores minimal professional identity and role evidence without contact data", () => {
  for (const table of [
    "discovery_professional_people",
    "discovery_professional_role_candidates",
    "discovery_professional_role_assignments",
    "discovery_professional_role_review_events"
  ]) assert.ok(migration.includes("create table if not exists public." + table), table + " table missing");
  assert.match(migration, /public_professional_source boolean/);
  assert.match(migration, /source_span jsonb/);
  assert.doesNotMatch(migration, /\b(email|phone|consent_state|linkedin_url|social_profile)\b/i);
});

test("E07 role jobs are queued only after E06 reviewed entity assignments", () => {
  assert.match(migration, /after insert on public\.discovery_entity_assignments/);
  assert.match(migration, /discovery_entity_assignments a/);
  assert.match(migration, /r\.source_content_hash=e\.content_hash/);
  assert.match(migration, /for update of j skip locked/);
});

test("E07 worker reads E05 facts and E06 assignments and cannot create canonical people", () => {
  assert.match(worker, /from\("discovery_extracted_facts"\)/);
  assert.match(worker, /from\("discovery_entity_assignments"\)/);
  assert.match(worker, /complete_discovery_professional_role_job/);
  assert.doesNotMatch(worker, /insert into public\.discovery_professional_people/i);
});

test("E07 professional identity and role assignment require company owner/admin review", () => {
  assert.match(migration, /Only a company owner or admin can review professional roles/);
  assert.match(migration, /candidate_state<>'pending_review'/);
  assert.match(migration, /insert into public\.discovery_professional_role_review_events/);
  assert.match(migration, /insert into public\.discovery_professional_role_assignments/);
  assert.match(migration, /professional_role_review_recorded/);
});

test("E07 employer association requires an E06 assignment; fuzzy person or employer matching is absent", () => {
  assert.match(matcher, /reviewed_entity_assignment/);
  assert.match(matcher, /exact_reviewed_company_name/);
  assert.match(matcher, /human_review/);
  assert.doesNotMatch(matcher, /levenshtein|fuzzywuzzy|cosineSimilarity/);
});
