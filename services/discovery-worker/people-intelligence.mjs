const ROLE_FIELDS = new Set([
  "role","role_title","professional_role","designation","designation_in_company",
  "position","position_title","office","job_title","board_position",
  "director_designation","officer_title","public_office"
]);

const textOf = value => typeof value === "string" ? value.trim() : String(value ?? "").trim();

export function normalizePublicRoleTitle(value) {
  return textOf(value).normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, 200);
}

export function isApprovedRoleField(fieldName) {
  const key = textOf(fieldName).normalize("NFKC").toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return ROLE_FIELDS.has(key);
}

// A source row is a conservative association boundary. We deliberately do not
// infer person/company links from names, page-wide proximity or generic text.
export function sourceRowGroupKey(span) {
  if (!span || typeof span !== "object") return null;
  if (span.kind === "html-table-cell") {
    const match = textOf(span.locator).match(/table:nth-of-type\((\d+)\)\s+tr:nth-of-type\((\d+)\)/);
    return match ? "html:" + match[1] + ":" + match[2] : null;
  }
  if (span.kind === "csv-cell" && Number.isInteger(span.row) && span.row > 1) {
    return "csv:" + span.row;
  }
  if (span.kind === "json-pointer" && typeof span.locator === "string") {
    const locator = span.locator.replace(/^\$\.jsonld\[\d+\]/, "$");
    const parts = locator.split("/");
    const arrayIndex = parts.findIndex((part, index) => index > 0 && /^\d+$/.test(part));
    return arrayIndex > 0 ? "json:" + parts.slice(0, arrayIndex + 1).join("/") : null;
  }
  return null;
}

function distinctCanonicalIds(assignments) {
  return [...new Set((assignments || []).map(item => item.canonical_entity_id).filter(Boolean))];
}

function buildCandidate(person, roleFact, canonicalEntityId, method, jurisdiction) {
  const name = textOf(person.raw_name || person.normalized_name);
  const roleTitle = normalizePublicRoleTitle(roleFact.normalized_value || roleFact.raw_value);
  if (!name || !roleTitle) return null;
  const confidence = Number(person.confidence);
  return {
    extracted_person_id: person.id,
    canonical_entity_id: canonicalEntityId,
    person_name: name.slice(0, 250),
    role_title: roleTitle,
    jurisdiction: textOf(jurisdiction) || null,
    person_source_span: person.source_span || {},
    role_source_span: roleFact.source_span || {},
    association_method: method,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5,
    rationale: {
      method,
      explanation: method === "same_source_row"
        ? "The person mention, explicit public role title and owner-approved company assignment share one source row."
        : "The extraction run has exactly one owner-approved company assignment; the role is still presented for human confirmation.",
      auto_link_permitted: false,
      human_review_required: true,
      personal_contact_details_collected: false
    }
  };
}

/**
 * Creates role candidates only when the person-to-company relationship can be
 * bounded to the same source row, or the run contains exactly one approved
 * company assignment. The result is always a review suggestion, never a
 * canonical person profile or a contact record.
 */
export function buildPublicPersonRoleCandidates({
  personMentions = [],
  extractedFacts = [],
  companyAssignments = [],
  targetCanonicalEntityId
}) {
  const targetAssignments = (companyAssignments || []).filter(item =>
    item.canonical_entity_id === targetCanonicalEntityId
  );
  if (!targetCanonicalEntityId || !targetAssignments.length) return [];

  const people = (personMentions || []).filter(item => item.entity_kind === "person");
  const allRoleFacts = (extractedFacts || []).filter(fact =>
    fact.validation_status === "valid" &&
    isApprovedRoleField(fact.field_name) &&
    normalizePublicRoleTitle(fact.normalized_value || fact.raw_value)
  );
  const allCompanies = distinctCanonicalIds(companyAssignments);
  const targetOnlyCompany = allCompanies.length === 1 && allCompanies[0] === targetCanonicalEntityId;
  const output = [];
  const seen = new Set();

  for (const person of people) {
    const personGroup = sourceRowGroupKey(person.source_span);
    const peersInSameRow = personGroup
      ? people.filter(other => sourceRowGroupKey(other.source_span) === personGroup)
      : [];
    if (personGroup && peersInSameRow.length !== 1) continue;

    const roleFacts = allRoleFacts.filter(fact => {
      if (fact.extracted_entity_id === person.id) return true;
      return Boolean(personGroup && sourceRowGroupKey(fact.source_span) === personGroup);
    });
    if (!roleFacts.length) continue;

    const rowAssignments = personGroup
      ? targetAssignments.filter(item => sourceRowGroupKey(item.source_span) === personGroup)
      : [];
    let method = null;
    if (rowAssignments.length === 1) method = "same_source_row";
    else if (rowAssignments.length > 1) continue;
    else if (targetOnlyCompany) method = "unique_company_run";
    else continue;

    for (const roleFact of roleFacts) {
      const candidate = buildCandidate(person, roleFact, targetCanonicalEntityId,
        method, targetAssignments[0].jurisdiction);
      if (!candidate) continue;
      const key = [
        candidate.extracted_person_id,
        candidate.canonical_entity_id,
        normalizePublicRoleTitle(candidate.role_title).toLowerCase(),
        JSON.stringify(candidate.person_source_span),
        JSON.stringify(candidate.role_source_span)
      ].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(candidate);
    }
  }
  return output.slice(0, 500);
}
