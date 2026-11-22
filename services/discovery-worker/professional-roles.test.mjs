import test from "node:test";
import assert from "node:assert/strict";
import { buildProfessionalRoleCandidates, normalizeProfessionalRole } from "./professional-roles.mjs";

const evidenceId = "evidence-1";
const person = {
  id: "person-1", entity_kind: "person", raw_name: "Asha Rao",
  normalized_name: "Asha Rao", confidence: 0.96,
  source_span: { kind: "html-text", start: 10, end: 18 }
};
const organization = {
  id: "org-mention-1", entity_kind: "organization",
  raw_name: "Acme Holdings Private Limited",
  normalized_name: "Acme Holdings Private Limited"
};
const facts = [
  {
    extracted_entity_id: "person-1", field_name: "job_title",
    raw_value: "Chief Financial Officer", normalized_value: "Chief Financial Officer",
    validation_status: "valid", confidence: 0.94,
    source_span: { kind: "html-text", start: 20, end: 43 }
  },
  {
    extracted_entity_id: "person-1", field_name: "employer_entity_id",
    raw_value: "org-mention-1", normalized_value: "org-mention-1",
    validation_status: "valid", confidence: 0.91,
    source_span: { kind: "json-pointer", locator: "$/officers/0/company" }
  },
  {
    extracted_entity_id: "person-1", field_name: "department",
    raw_value: "Finance", normalized_value: "Finance",
    validation_status: "valid", confidence: 0.9,
    source_span: { kind: "html-text", start: 44, end: 51 }
  }
];
const canonical = [{
  id: "canonical-acme", entity_kind: "organization", status: "active",
  legal_name: "Acme Holdings Private Limited", normalized_name: "acme holdings",
  jurisdiction: "IN"
}];
const assignments = [{
  extracted_entity_id: "org-mention-1", canonical_entity_id: "canonical-acme"
}];

test("E07 normalises only source-backed professional role text", () => {
  assert.equal(normalizeProfessionalRole("  Chief   Financial Officer "), "Chief Financial Officer");
  assert.equal(normalizeProfessionalRole(""), null);
  assert.equal(normalizeProfessionalRole("x".repeat(161)), null);
});

test("E07 links a person to an employer only through an owner-reviewed E06 assignment", () => {
  const result = buildProfessionalRoleCandidates({
    extractedEntities: [person, organization], extractedFacts: facts,
    assignments, canonicalEntities: canonical, evidenceId, jurisdiction: "IN"
  })[0];
  assert.equal(result.person_name, "Asha Rao");
  assert.equal(result.role_title, "Chief Financial Officer");
  assert.equal(result.canonical_entity_id, "canonical-acme");
  assert.equal(result.relationship_method, "reviewed_entity_assignment");
  assert.equal(result.candidate_state, "pending_review");
  assert.equal(result.review_state, "pending_review");
  assert.equal(result.rationale.auto_publish_permitted, false);
});

test("E07 does not infer an employer from a person name or fuzzy company text", () => {
  const noLink = buildProfessionalRoleCandidates({
    extractedEntities: [person, organization],
    extractedFacts: [facts[0], { ...facts[1], field_name: "employer_name", raw_value: "Acme Holding" }],
    assignments: [], canonicalEntities: canonical, evidenceId, jurisdiction: "IN"
  })[0];
  assert.equal(noLink.canonical_entity_id, null);
  assert.equal(noLink.candidate_state, "insufficient_evidence");
  assert.ok(noLink.missing_requirements.includes("reviewed_employer_link"));
});

test("E07 exact employer-name linking requires a unique reviewed canonical company", () => {
  const result = buildProfessionalRoleCandidates({
    extractedEntities: [person, organization],
    extractedFacts: [facts[0], { ...facts[1], field_name: "employer_name", raw_value: "Acme Holdings Pvt Ltd" }],
    assignments, canonicalEntities: canonical, evidenceId, jurisdiction: "IN"
  })[0];
  assert.equal(result.canonical_entity_id, "canonical-acme");
  assert.equal(result.relationship_method, "exact_reviewed_company_name");
});

test("E07 ambiguous company names are not linked", () => {
  const second = { ...canonical[0], id: "canonical-acme-2", legal_name: "Acme Holdings Pvt Ltd", normalized_name: "acme holdings" };
  const result = buildProfessionalRoleCandidates({
    extractedEntities: [person, organization],
    extractedFacts: [facts[0], { ...facts[1], field_name: "employer_name", raw_value: "Acme Holdings" }],
    assignments, canonicalEntities: [canonical[0], second], evidenceId, jurisdiction: "IN"
  })[0];
  assert.equal(result.canonical_entity_id, null);
  assert.equal(result.candidate_state, "insufficient_evidence");
});

test("E07 excludes contact fields and does not manufacture email or phone data", () => {
  const result = buildProfessionalRoleCandidates({
    extractedEntities: [person, organization], extractedFacts: facts,
    assignments, canonicalEntities: canonical, evidenceId, jurisdiction: "IN"
  })[0];
  assert.equal(Object.hasOwn(result, "email"), false);
  assert.equal(Object.hasOwn(result, "phone"), false);
  assert.equal(Object.hasOwn(result, "consent_state"), false);
});

test("E07 ignores person mentions without explicit role facts", () => {
  const result = buildProfessionalRoleCandidates({
    extractedEntities: [person, organization], extractedFacts: [facts[1]],
    assignments, canonicalEntities: canonical, evidenceId, jurisdiction: "IN"
  })[0];
  assert.equal(result.role_title, null);
  assert.equal(result.candidate_state, "insufficient_evidence");
  assert.ok(result.missing_requirements.includes("role_title"));
});
