const ACTIVE = new Set(["active"]);
const ACCEPTED_OR_REVIEWABLE = new Set(["owner_accepted", "needs_verification"]);
const norm = value => typeof value === "string"
  ? value.normalize("NFKC").trim().toLocaleLowerCase("en").replace(/\s+/g, " ")
  : "";
const idOf = value => typeof value === "string" ? value.trim() : "";
const pair = (a, b) => {
  const [left, right] = [a, b].sort((x, y) => x.localeCompare(y));
  return left && right && left !== right ? [left, right] : null;
};
const validFingerprint = value => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);

function addGroup(groups, key, record) {
  if (!key) return;
  const group = groups.get(key) || new Map();
  group.set(record.id, record);
  groups.set(key, group);
}
function addGroupPairs(output, candidateKind, matchRule, strength, groups, evidenceField, rationale) {
  for (const group of groups.values()) {
    const records = [...group.values()].sort((a, b) => a.id.localeCompare(b.id));
    for (let i = 0; i < records.length; i += 1) {
      for (let j = i + 1; j < records.length; j += 1) {
        const ids = pair(records[i].id, records[j].id);
        if (!ids) continue;
        const key = [candidateKind, matchRule, ...ids].join("|");
        const current = output.get(key) || {
          candidate_kind: candidateKind,
          match_rule: matchRule,
          left_record_id: ids[0],
          right_record_id: ids[1],
          strength,
          rationale,
          evidence_refs: [],
          human_review_required: true,
          automatic_merge_permitted: false
        };
        for (const item of [records[i][evidenceField], records[j][evidenceField]]) {
          if (item && !current.evidence_refs.includes(item)) current.evidence_refs.push(item);
        }
        output.set(key, current);
      }
    }
  }
}
function addDirectPair(output, candidateKind, matchRule, strength, left, right, refs, rationale) {
  const ids = pair(left, right);
  if (!ids) return;
  const key = [candidateKind, matchRule, ...ids].join("|");
  const current = output.get(key) || {
    candidate_kind: candidateKind,
    match_rule: matchRule,
    left_record_id: ids[0],
    right_record_id: ids[1],
    strength,
    rationale,
    evidence_refs: [],
    human_review_required: true,
    automatic_merge_permitted: false
  };
  for (const ref of refs || []) if (ref && !current.evidence_refs.includes(ref)) current.evidence_refs.push(ref);
  output.set(key, current);
}
function overlaps(a, b) {
  const startA = a.valid_from ? Date.parse(a.valid_from) : Number.NEGATIVE_INFINITY;
  const endA = a.valid_to ? Date.parse(a.valid_to) : Number.POSITIVE_INFINITY;
  const startB = b.valid_from ? Date.parse(b.valid_from) : Number.NEGATIVE_INFINITY;
  const endB = b.valid_to ? Date.parse(b.valid_to) : Number.POSITIVE_INFINITY;
  if ([startA, endA, startB, endB].some(Number.isNaN)) return false;
  return startA <= endB && startB <= endA;
}

/**
 * E12 creates deterministic, review-only duplicate suggestions.
 * Exact identifiers, scoped names, reviewed aliases, same-employer roles and
 * keyed contact fingerprints are compared; fuzzy names never produce merges.
 * Raw contact values and contact fingerprints are never returned.
 */
export function buildDeduplicationCandidates({
  canonicalEntities = [],
  identifiers = [],
  aliases = [],
  professionalPeople = [],
  roleAssignments = [],
  contactPoints = [],
  maxCandidates = 5000
} = {}) {
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 20000) {
    throw new TypeError("E12 maxCandidates must be an integer between 1 and 20000.");
  }
  const entities = new Map(canonicalEntities
    .filter(item => item && ACTIVE.has(item.status))
    .map(item => [idOf(item.id), item]).filter(([id]) => id));
  const people = new Map(professionalPeople
    .filter(item => item && ACTIVE.has(item.status))
    .map(item => [idOf(item.id), item]).filter(([id]) => id));
  const output = new Map();

  const identifierGroups = new Map();
  for (const item of identifiers) {
    if (!item || !ACCEPTED_OR_REVIEWABLE.has(item.review_state)) continue;
    const entityId = idOf(item.canonical_entity_id);
    if (!entities.has(entityId)) continue;
    const scheme = String(item.scheme || "").trim().toUpperCase();
    const jurisdiction = norm(item.jurisdiction);
    const value = String(item.normalized_value || "").normalize("NFKC")
      .replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (!scheme || !jurisdiction || value.length < 4) continue;
    const key = JSON.stringify([scheme, jurisdiction, value]);
    addGroup(identifierGroups, key, { id: entityId, evidence: idOf(item.id) });
  }
  addGroupPairs(output, "organization", "exact_registry_identifier", "strong",
    identifierGroups, "evidence", "The same scheme, jurisdiction and normalized registry identifier is recorded for both organizations. Verify the source records before treating them as one entity.");

  const nameGroups = new Map();
  for (const entity of entities.values()) {
    const name = norm(entity.normalized_name || entity.legal_name);
    const jurisdiction = norm(entity.jurisdiction);
    if (name && jurisdiction) addGroup(nameGroups, JSON.stringify([jurisdiction, name]), { id: entity.id });
  }
  addGroupPairs(output, "organization", "exact_legal_name", "medium",
    nameGroups, "evidence", "The same normalized legal name appears in the same jurisdiction. A name match alone does not establish legal identity.");

  const aliasGroups = new Map();
  for (const alias of aliases) {
    if (!alias || !ACCEPTED_OR_REVIEWABLE.has(alias.review_state)) continue;
    const entityId = idOf(alias.canonical_entity_id);
    const entity = entities.get(entityId);
    const value = norm(alias.normalized_alias || alias.alias);
    const jurisdiction = norm(entity?.jurisdiction);
    if (value && jurisdiction) addGroup(aliasGroups, JSON.stringify([jurisdiction, value]), {
      id: entityId, evidence: idOf(alias.id)
    });
  }
  addGroupPairs(output, "organization", "exact_alias", "medium",
    aliasGroups, "evidence", "The same owner-reviewed alias is attached to different organizations in the same jurisdiction. Review alias provenance and legal-group context.");

  const personGroups = new Map();
  for (const assignment of roleAssignments) {
    if (!assignment) continue;
    const personId = idOf(assignment.professional_person_id);
    const person = people.get(personId);
    const employerId = idOf(assignment.canonical_entity_id);
    if (!person || !entities.has(employerId)) continue;
    const name = norm(person.normalized_name || person.full_name);
    const role = norm(assignment.role_title);
    if (!name || !role) continue;
    const key = JSON.stringify([employerId, name, role]);
    addGroup(personGroups, key, {
      id: personId,
      roleAssignmentId: idOf(assignment.id),
      valid_from: assignment.valid_from || null,
      valid_to: assignment.valid_to || null
    });
  }
  for (const group of personGroups.values()) {
    const records = [...group.values()].sort((a, b) => a.id.localeCompare(b.id));
    for (let i = 0; i < records.length; i += 1) {
      for (let j = i + 1; j < records.length; j += 1) {
        if (records[i].id === records[j].id ||
            !overlaps(records[i], records[j])) continue;
        addDirectPair(output, "professional_person", "same_employer_role", "medium",
          records[i].id, records[j].id,
          [records[i].roleAssignmentId, records[j].roleAssignmentId],
          "The same normalized professional name has overlapping assignments for the same employer and role. This is a review candidate, not proof of identity.");
      }
    }
  }

  const contactGroups = new Map();
  for (const contact of contactPoints) {
    if (!contact || contact.status !== "active" || !validFingerprint(contact.value_fingerprint)) continue;
    const contactType = String(contact.contact_type || "").trim().toLowerCase();
    if (!["email", "phone"].includes(contactType)) continue;
    const fingerprint = contact.value_fingerprint.toLowerCase();
    const ownerKeys = [];
    const entityId = idOf(contact.canonical_entity_id);
    const personId = idOf(contact.professional_person_id);
    if (entityId && entities.has(entityId)) ownerKeys.push("entity:" + entityId);
    if (personId && people.has(personId)) ownerKeys.push("person:" + personId);
    for (const ownerKey of ownerKeys) {
      const key = JSON.stringify([ownerKey, contactType, fingerprint]);
      addGroup(contactGroups, key, { id: idOf(contact.id) });
    }
  }
  addGroupPairs(output, "contact_point", "exact_contact_fingerprint", "strong",
    contactGroups, "evidence", "The same keyed contact fingerprint is attached to the same owner record. The contact value remains encrypted and is not exposed by E12.");

  return [...output.values()]
    .sort((a, b) => [a.candidate_kind, a.match_rule, a.left_record_id, a.right_record_id]
      .join("|").localeCompare([b.candidate_kind, b.match_rule, b.left_record_id, b.right_record_id].join("|")))
    .slice(0, maxCandidates)
    .map(item => ({ ...item, evidence_refs: [...new Set(item.evidence_refs)].slice(0, 20) }));
}
