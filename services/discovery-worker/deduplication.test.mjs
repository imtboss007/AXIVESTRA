import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildDeduplicationCandidates } from "./deduplication.mjs";

const entities = [
  { id: "org-a", status: "active", jurisdiction: "IN", legal_name: "Acme Private Limited", normalized_name: "acme" },
  { id: "org-b", status: "active", jurisdiction: "IN", legal_name: "Acme Pvt Ltd", normalized_name: "acme" },
  { id: "org-c", status: "active", jurisdiction: "US", legal_name: "Acme Inc", normalized_name: "acme" },
  { id: "org-d", status: "merged", jurisdiction: "IN", legal_name: "Acme", normalized_name: "acme" }
];

test("E12 proposes exact legal-name duplicates only within the same jurisdiction", () => {
  const results = buildDeduplicationCandidates({ canonicalEntities: entities });
  assert.equal(results.filter(item => item.match_rule === "exact_legal_name").length, 1);
  assert.equal(results.find(item => item.match_rule === "exact_legal_name").right_record_id, "org-b");
});

test("E12 flags identical registry identifiers without exposing the identifier value", () => {
  const results = buildDeduplicationCandidates({
    canonicalEntities: entities,
    identifiers: [
      { id: "id-a", canonical_entity_id: "org-a", scheme: "CIN", jurisdiction: "IN", normalized_value: "U123456789", review_state: "owner_accepted" },
      { id: "id-b", canonical_entity_id: "org-b", scheme: "cin", jurisdiction: "IN", normalized_value: "U123456789", review_state: "needs_verification" }
    ]
  });
  const candidate = results.find(item => item.match_rule === "exact_registry_identifier");
  assert.ok(candidate);
  assert.deepEqual(candidate.evidence_refs.sort(), ["id-a", "id-b"]);
  assert.equal(JSON.stringify(candidate).includes("U123456789"), false);
  assert.equal(candidate.automatic_merge_permitted, false);
});

test("E12 detects shared owner-reviewed aliases but never fuzzy-name matches", () => {
  const results = buildDeduplicationCandidates({
    canonicalEntities: entities,
    aliases: [
      { id: "alias-a", canonical_entity_id: "org-a", alias: "Acme Group", review_state: "owner_accepted" },
      { id: "alias-b", canonical_entity_id: "org-b", alias: "ACME GROUP", review_state: "owner_accepted" }
    ]
  });
  assert.equal(results.filter(item => item.match_rule === "exact_alias").length, 1);
  assert.equal(results.some(item => item.match_rule.includes("fuzzy")), false);
});

test("E12 person candidates require the same employer, role and overlapping dates", () => {
  const people = [
    { id: "person-a", status: "active", full_name: "Ravi Kumar", normalized_name: "ravi kumar" },
    { id: "person-b", status: "active", full_name: "Ravi Kumar", normalized_name: "ravi kumar" },
    { id: "person-c", status: "active", full_name: "Ravi Kumar", normalized_name: "ravi kumar" }
  ];
  const results = buildDeduplicationCandidates({
    canonicalEntities: entities,
    professionalPeople: people,
    roleAssignments: [
      { id: "role-a", professional_person_id: "person-a", canonical_entity_id: "org-a", role_title: "CFO", valid_from: "2024-01-01", valid_to: "2025-01-01" },
      { id: "role-b", professional_person_id: "person-b", canonical_entity_id: "org-a", role_title: "cfo", valid_from: "2024-06-01", valid_to: "2025-06-01" },
      { id: "role-c", professional_person_id: "person-c", canonical_entity_id: "org-b", role_title: "CFO", valid_from: "2024-06-01", valid_to: "2025-06-01" }
    ]
  });
  const candidate = results.find(item => item.match_rule === "same_employer_role");
  assert.ok(candidate);
  assert.deepEqual([candidate.left_record_id, candidate.right_record_id], ["person-a", "person-b"]);
});

test("E12 detects exact encrypted-contact fingerprints only for the same owner", () => {
  const fingerprint = "a".repeat(64);
  const results = buildDeduplicationCandidates({
    canonicalEntities: entities,
    contactPoints: [
      { id: "contact-a", status: "active", contact_type: "email", value_fingerprint: fingerprint, canonical_entity_id: "org-a" },
      { id: "contact-b", status: "active", contact_type: "email", value_fingerprint: fingerprint, canonical_entity_id: "org-a" },
      { id: "contact-c", status: "active", contact_type: "email", value_fingerprint: fingerprint, canonical_entity_id: "org-b" }
    ]
  });
  const candidates = results.filter(item => item.match_rule === "exact_contact_fingerprint");
  assert.equal(candidates.length, 1);
  assert.deepEqual([candidates[0].left_record_id, candidates[0].right_record_id], ["contact-a", "contact-b"]);
  assert.equal(JSON.stringify(candidates).includes(fingerprint), false);
});

test("E12 preserves source record identifiers and review-only semantics", () => {
  const results = buildDeduplicationCandidates({ canonicalEntities: entities });
  assert.ok(results.every(item => item.human_review_required));
  assert.ok(results.every(item => item.automatic_merge_permitted === false));
  assert.ok(results.every(item => item.left_record_id && item.right_record_id));
});

test("E12 enforces bounded candidate output", () => {
  assert.throws(() => buildDeduplicationCandidates({ maxCandidates: 0 }), /maxCandidates/);
});

test("E12 SQL contract is company-scoped, review-gated and exposes accepted graph edges only", async () => {
  const migration = await readFile(new URL("../../supabase/migrations/20261122260000_discovery_deduplication.sql", import.meta.url), "utf8");
  assert.match(migration, /generate_discovery_deduplication_candidates/);
  assert.match(migration, /record_discovery_deduplication_review/);
  assert.match(migration, /Only a company owner or admin can review/);
  assert.match(migration, /discovery_entity_graph_edges/);
  assert.match(migration, /review_state='owner_accepted'/);
  assert.doesNotMatch(migration, /update public\.discovery_canonical_entities/i);
});
