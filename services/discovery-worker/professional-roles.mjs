const ROLE_FIELDS = new Map([
  ["job_title", "job_title"], ["title", "job_title"], ["designation", "job_title"],
  ["position", "job_title"], ["professional_role", "job_title"],
  ["role", "job_title"], ["current_role", "job_title"],
  ["department", "department"], ["business_unit", "department"],
  ["role_start_date", "valid_from"], ["start_date", "valid_from"],
  ["appointed_on", "valid_from"], ["appointment_date", "valid_from"],
  ["role_end_date", "valid_to"], ["end_date", "valid_to"],
  ["resigned_on", "valid_to"], ["cessation_date", "valid_to"]
]);
const EMPLOYER_REFERENCE_FIELDS = new Set([
  "employer_entity_id", "organization_entity_id", "organisation_entity_id",
  "company_entity_id", "works_at_entity_id", "role_at_entity_id"
]);
const EMPLOYER_NAME_FIELDS = new Set([
  "employer_name", "organization_name", "organisation_name",
  "company_name", "works_at", "employer"
]);
const text = value => typeof value === "string" ? value.trim() : String(value ?? "").trim();
const normalizePersonName = value => text(value).normalize("NFKC").toLowerCase()
  .replace(/[’']/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
const keyOf = value => text(value).normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

export function normalizeProfessionalRole(value) {
  const normalized = text(value).normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 160) return null;
  return normalized;
}

function normalizeCompany(value) {
  return text(value).normalize("NFKC").toLowerCase()
    .replace(/&/g, " and ").replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim()
    .replace(/\s+(private limited|pvt ltd|limited|ltd|llp|inc|corporation|corp)$/i, "");
}

function valueOf(fact) {
  const value = fact.normalized_value ?? fact.raw_value;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value.value ?? value.id ?? "" : value;
}

function sourceBackedFacts(facts, personId) {
  return facts.filter(fact =>
    fact.extracted_entity_id === personId &&
    fact.validation_status === "valid" &&
    fact.source_span && typeof fact.source_span === "object"
  );
}

function resolveEmployer(personFacts, organizationMentions, assignments, canonicalEntities) {
  const byMention = new Map(organizationMentions.map(item => [item.id, item]));
  const assigned = new Map(assignments.map(item => [item.extracted_entity_id, item.canonical_entity_id]));
  const canonical = new Map(canonicalEntities.map(item => [item.id, item]));
  for (const fact of personFacts) {
    const key = keyOf(fact.field_name);
    if (EMPLOYER_REFERENCE_FIELDS.has(key)) {
      const mentionId = text(valueOf(fact));
      const canonicalId = assigned.get(mentionId);
      if (canonicalId && byMention.has(mentionId) && canonical.has(canonicalId)) {
        return { canonicalEntity: canonical.get(canonicalId), relationFact: fact, linkMethod: "reviewed_entity_assignment" };
      }
    }
  }
  for (const fact of personFacts) {
    if (!EMPLOYER_NAME_FIELDS.has(keyOf(fact.field_name))) continue;
    const proposed = normalizeCompany(valueOf(fact));
    if (!proposed) continue;
    const hits = [];
    for (const mention of organizationMentions) {
      const canonicalId = assigned.get(mention.id);
      const canonicalEntity = canonical.get(canonicalId);
      if (!canonicalEntity) continue;
      if (normalizeCompany(canonicalEntity.normalized_name || canonicalEntity.legal_name) === proposed ||
          normalizeCompany(mention.normalized_name || mention.raw_name) === proposed) {
        hits.push(canonicalEntity);
      }
    }
    const unique = [...new Map(hits.map(item => [item.id, item])).values()];
    if (unique.length === 1) {
      return { canonicalEntity: unique[0], relationFact: fact, linkMethod: "exact_reviewed_company_name" };
    }
  }
  return null;
}

export function buildProfessionalRoleCandidates({
  extractedEntities = [], extractedFacts = [], assignments = [],
  canonicalEntities = [], evidenceId, jurisdiction
}) {
  const people = extractedEntities.filter(entity => entity.entity_kind === "person");
  const organizations = extractedEntities.filter(entity => entity.entity_kind === "organization");
  const canonicalById = new Map(canonicalEntities.map(item => [item.id, item]));
  return people.map(person => {
    const facts = sourceBackedFacts(extractedFacts, person.id);
    const name = text(person.raw_name || person.normalized_name).slice(0, 300);
    const roleFact = facts.find(fact => ROLE_FIELDS.has(keyOf(fact.field_name)) &&
      ROLE_FIELDS.get(keyOf(fact.field_name)) === "job_title");
    const role = normalizeProfessionalRole(roleFact ? valueOf(roleFact) : "");
    const employer = resolveEmployer(facts, organizations, assignments, canonicalEntities);
    const confidenceValues = [person.confidence, roleFact?.confidence, employer?.relationFact?.confidence]
      .filter(value => Number.isFinite(Number(value))).map(Number);
    const candidate = {
      extracted_person_id: person.id,
      person_name: name,
      normalized_person_name: normalizePersonName(name),
      canonical_entity_id: employer?.canonicalEntity.id || null,
      role_title: role,
      department: text(valueOf(facts.find(fact => ROLE_FIELDS.get(keyOf(fact.field_name)) === "department") || {})).slice(0, 160) || null,
      valid_from: text(valueOf(facts.find(fact => ROLE_FIELDS.get(keyOf(fact.field_name)) === "valid_from") || {})) || null,
      valid_to: text(valueOf(facts.find(fact => ROLE_FIELDS.get(keyOf(fact.field_name)) === "valid_to") || {})) || null,
      jurisdiction: text(jurisdiction) || null,
      evidence_id: evidenceId || null,
      source_span: {
        person: person.source_span || {},
        role: roleFact?.source_span || {},
        relationship: employer?.relationFact?.source_span || {}
      },
      confidence: confidenceValues.length ? Math.min(...confidenceValues) : 0,
      relationship_method: employer?.linkMethod || null,
      review_state: "pending_review",
      rationale: {
        role_source_backed: Boolean(roleFact),
        employer_link_source_backed: Boolean(employer),
        requires_human_review: true,
        auto_publish_permitted: false
      }
    };
    const missing = [];
    if (!name) missing.push("person_name");
    if (!role) missing.push("role_title");
    if (!employer) missing.push("reviewed_employer_link");
    if (!evidenceId) missing.push("evidence_id");
    candidate.missing_requirements = missing;
    candidate.candidate_state = missing.length ? "insufficient_evidence" : "pending_review";
    if (candidate.canonical_entity_id && !canonicalById.has(candidate.canonical_entity_id)) {
      candidate.canonical_entity_id = null;
      candidate.candidate_state = "insufficient_evidence";
      candidate.missing_requirements.push("active_canonical_entity");
    }
    return candidate;
  });
}
