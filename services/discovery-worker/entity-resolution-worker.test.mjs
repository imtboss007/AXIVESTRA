import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildEntityResolutionCandidates } from "./entity-resolution.mjs";

const worker = await readFile(new URL("./entity-resolution-worker.mjs", import.meta.url), "utf8");
const migration = await readFile(new URL("../../supabase/migrations/20261122200000_discovery_entity_intelligence.sql", import.meta.url), "utf8");

test("E06 worker is disabled by default and requires a server-only Supabase service role", () => {
  assert.match(worker, /DISCOVERY_ENTITY_RESOLUTION_WORKER_ENABLED !== "true"/);
  assert.match(worker, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(worker, /no network calls/i);
});

test("E06 worker commits only through a bounded, company-scoped resolution RPC", () => {
  assert.match(worker, /complete_discovery_entity_resolution/);
  assert.match(worker, /company_id/);
  assert.match(migration, /for update of j skip locked/);
  assert.match(migration, /v_job\.company_id/);
  assert.match(migration, /p_candidates/);
});

test("E06 never creates canonical entities before explicit owner/admin review", () => {
  assert.match(migration, /create or replace function public\.record_discovery_entity_resolution_review/);
  assert.match(migration, /Only a company owner or admin can review entity matches/);
  assert.match(migration, /decision in \('linked_existing','created_new','rejected','escalated'\)/);
  assert.doesNotMatch(worker, /insert into public\.discovery_canonical_entities/i);
  const candidates = buildEntityResolutionCandidates({
    extractedEntities: [{
      id: "mention", entity_kind: "organization",
      raw_name: "Pending Company Private Limited",
      normalized_name: "Pending Company Private Limited"
    }],
    extractedFacts: [],
    existingEntities: [],
    jurisdiction: "IN"
  });
  assert.equal(candidates[0].match_type, "new_entity_proposal");
  assert.equal(candidates[0].matched_entity_id, null);
  assert.equal(candidates[0].rationale.auto_link_permitted, false);
});
