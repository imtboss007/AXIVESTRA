import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEntityResolutionCandidates,
  identifierSchemeFromField,
  normalizeCompanyName,
  normalizeEntityIdentifier,
  normalizeJurisdiction,
  trigramDiceSimilarity
} from "./entity-resolution.mjs";

const mention = {
  id: "mention-1",
  entity_kind: "organization",
  raw_name: "Acme Holdings Private Limited",
  normalized_name: "Acme Holdings Private Limited"
};
const facts = [
  {
    extracted_entity_id: "mention-1", field_name: "legal_name",
    raw_value: "Acme Holdings Private Limited",
    normalized_value: "Acme Holdings Private Limited",
    validation_status: "valid"
  },
  {
    extracted_entity_id: "mention-1", field_name: "cin",
    raw_value: "U12345KA2020PLC123456",
    normalized_value: "U12345KA2020PLC123456",
    validation_status: "valid",
    source_span: { kind: "json-pointer", locator: "$/cin" }
  }
];

test("E06 canonical name normalisation removes legal suffixes but preserves the base name", () => {
  assert.equal(normalizeCompanyName("  Acme Holdings Pvt. Ltd. "), "acme holdings");
  assert.equal(normalizeCompanyName("ACME HOLDINGS PRIVATE LIMITED"), "acme holdings");
  assert.equal(normalizeCompanyName("München & Partners LLP"), "münchen and partners");
});

test("E06 jurisdiction normalisation is explicit and does not infer a missing country", () => {
  assert.equal(normalizeJurisdiction("India"), "IN");
  assert.equal(normalizeJurisdiction("in"), "IN");
  assert.equal(normalizeJurisdiction(""), null);
});

test("E06 identifier values are canonicalised and scheme comes from the approved field name", () => {
  assert.equal(identifierSchemeFromField("cin"), "CIN");
  assert.equal(identifierSchemeFromField("registration_id"), "REGISTRATION_ID");
  assert.equal(identifierSchemeFromField("private_owner_identifier"), null);
  assert.equal(normalizeEntityIdentifier("u-12345/ka 2020 plc 123456"), "U12345KA2020PLC123456");
  assert.equal(normalizeEntityIdentifier("123"), null);
});

test("E06 exact registry identifier outranks a different fuzzy legal name", () => {
  const result = buildEntityResolutionCandidates({
    extractedEntities: [mention], extractedFacts: facts, jurisdiction: "IN",
    existingEntities: [{
      id: "canonical-1", entity_kind: "organization", status: "active",
      jurisdiction: "IN", legal_name: "Different display name", normalized_name: "different display name",
      identifiers: [{ scheme: "CIN", jurisdiction: "IN", normalized_value: "U12345KA2020PLC123456" }]
    }]
  })[0];
  assert.equal(result.match_type, "exact_identifier");
  assert.equal(result.matched_entity_id, "canonical-1");
  assert.equal(result.match_score, 1);
  assert.equal(result.rationale.auto_link_permitted, false);
  assert.equal(result.rationale.human_review_required, true);
});

test("E06 does not match identical registration values across jurisdictions", () => {
  const result = buildEntityResolutionCandidates({
    extractedEntities: [mention], extractedFacts: facts, jurisdiction: "IN",
    existingEntities: [{
      id: "canonical-foreign", entity_kind: "organization", status: "active",
      jurisdiction: "US", legal_name: mention.raw_name,
      identifiers: [{ scheme: "CIN", jurisdiction: "US", normalized_value: "U12345KA2020PLC123456" }]
    }]
  })[0];
  assert.equal(result.match_type, "new_entity_proposal");
  assert.equal(result.matched_entity_id, null);
});

test("E06 exact name and alias matches always remain review candidates", () => {
  const existing = {
    id: "canonical-2", entity_kind: "organization", status: "active",
    jurisdiction: "IN", legal_name: "Acme Holdings Private Limited",
    normalized_name: "acme holdings", aliases: [{ alias: "Acme Group" }]
  };
  const legal = buildEntityResolutionCandidates({
    extractedEntities: [mention], extractedFacts: facts, jurisdiction: "IN",
    existingEntities: [existing]
  })[0];
  assert.equal(legal.match_type, "exact_legal_name");
  assert.equal(legal.matched_entity_id, "canonical-2");
  assert.equal(legal.rationale.auto_link_permitted, false);
  const alias = buildEntityResolutionCandidates({
    extractedEntities: [{ ...mention, raw_name: "Acme Group", normalized_name: "Acme Group" }],
    extractedFacts: [], jurisdiction: "IN", existingEntities: [existing]
  })[0];
  assert.equal(alias.match_type, "exact_alias");
});

test("E06 fuzzy similarity creates a review candidate but never authorises auto-linking", () => {
  const score = trigramDiceSimilarity("Acme Holding", "Acme Holdings Private Limited");
  assert.ok(score >= 0 && score <= 1);
  const typoMention = { ...mention, raw_name: "Acme Holdings Group", normalized_name: "Acme Holdings Group" };
  const result = buildEntityResolutionCandidates({
    extractedEntities: [typoMention], extractedFacts: [], jurisdiction: "IN",
    existingEntities: [{
      id: "canonical-3", entity_kind: "organization", status: "active",
      jurisdiction: "IN", legal_name: "Acme Holding Group", normalized_name: "acme holding group"
    }]
  })[0];
  assert.equal(result.match_type, "name_similarity");
  assert.equal(result.matched_entity_id, "canonical-3");
  assert.equal(result.rationale.human_review_required, true);
  assert.equal(result.rationale.auto_link_permitted, false);
});

test("E06 ambiguous identifier collisions never select one entity", () => {
  const result = buildEntityResolutionCandidates({
    extractedEntities: [mention], extractedFacts: facts, jurisdiction: "IN",
    existingEntities: ["A", "B"].map(suffix => ({
      id: "canonical-" + suffix, entity_kind: "organization", status: "active",
      jurisdiction: "IN", legal_name: "Other " + suffix,
      identifiers: [{ scheme: "CIN", jurisdiction: "IN", normalized_value: "U12345KA2020PLC123456" }]
    }))
  })[0];
  assert.equal(result.match_type, "ambiguous_identifier");
  assert.equal(result.matched_entity_id, null);
});

test("E06 ignores person/location mentions instead of canonicalising them as companies", () => {
  const result = buildEntityResolutionCandidates({
    extractedEntities: [
      { ...mention, entity_kind: "person" },
      { ...mention, id: "loc-1", entity_kind: "location" }
    ],
    extractedFacts: [], jurisdiction: "IN", existingEntities: []
  });
  assert.deepEqual(result, []);
});
