export function normalizeJurisdiction(value) {
  const text = String(value ?? "").normalize("NFKC").replace(/[._]/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
  if (!text) return null;
  const aliases = new Map([
    ["INDIA", "IN"], ["UNITED STATES", "US"], ["UNITED STATES OF AMERICA", "US"],
    ["UNITED KINGDOM", "GB"], ["GREAT BRITAIN", "GB"], ["UAE", "AE"],
    ["UNITED ARAB EMIRATES", "AE"]
  ]);
  return aliases.get(text) || text;
}
const LEGAL_SUFFIXES = [
  "private limited", "public limited", "limited liability partnership",
  "private ltd", "public ltd", "pvt ltd", "pty ltd", "limited", "ltd",
  "llp", "incorporated", "corporation", "corp", "company", "co",
  "plc", "llc", "gmbh", "sarl", "ag"
].sort((a, b) => b.length - a.length);
const NAME_FIELDS = new Map([
  ["legal_name", 0], ["registered_name", 1], ["company_name", 2],
  ["organization_name", 3], ["organisation_name", 3],
  ["institution_name", 4], ["entity_name", 5]
]);
const IDENTIFIER_SCHEMES = new Map([
  ["cin", "CIN"], ["company_identification_number", "CIN"],
  ["gstin", "GSTIN"], ["gst_number", "GSTIN"],
  ["lei", "LEI"], ["legal_entity_identifier", "LEI"],
  ["duns", "DUNS"], ["duns_number", "DUNS"],
  ["pan", "PAN"], ["tax_id", "TAX_ID"], ["ein", "EIN"],
  ["vat_id", "VAT_ID"], ["company_number", "COMPANY_NUMBER"],
  ["company_registration_number", "COMPANY_NUMBER"],
  ["registration_id", "REGISTRATION_ID"],
  ["registration_number", "REGISTRATION_ID"], ["registry_id", "REGISTRY_ID"],
  ["roc_number", "ROC_NUMBER"]
]);
const textOf = value => typeof value === "string" ? value.trim() : String(value ?? "").trim();

export function normalizeCompanyName(value) {
  let name = textOf(value).normalize("NFKC").toLocaleLowerCase("en")
    .replace(/&/g, " and ")
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  let changed = true;
  while (changed && name) {
    changed = false;
    for (const suffix of LEGAL_SUFFIXES) {
      if (name !== suffix && name.endsWith(" " + suffix)) {
        name = name.slice(0, -(suffix.length + 1)).trim();
        changed = true;
        break;
      }
    }
  }
  return name;
}

export function normalizeEntityIdentifier(value) {
  const normalized = textOf(value).normalize("NFKC").toUpperCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
  return normalized.length >= 4 && normalized.length <= 128 ? normalized : null;
}

export function identifierSchemeFromField(fieldName) {
  const key = textOf(fieldName).normalize("NFKC").toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return IDENTIFIER_SCHEMES.get(key) || null;
}

function trigrams(value) {
  const padded = "  " + value + "  ";
  const result = new Set();
  for (let index = 0; index < padded.length - 2; index += 1) result.add(padded.slice(index, index + 3));
  return result;
}

export function trigramDiceSimilarity(left, right) {
  const a = trigrams(normalizeCompanyName(left));
  const b = trigrams(normalizeCompanyName(right));
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const item of a) if (b.has(item)) overlap += 1;
  return (2 * overlap) / (a.size + b.size);
}

function getLegalName(entity, facts) {
  const candidates = facts
    .filter(fact => fact.extracted_entity_id === entity.id &&
      fact.validation_status === "valid" && NAME_FIELDS.has(fact.field_name))
    .sort((a, b) => NAME_FIELDS.get(a.field_name) - NAME_FIELDS.get(b.field_name));
  return textOf(candidates[0]?.normalized_value ?? candidates[0]?.raw_value ??
    entity.raw_name ?? entity.normalized_name);
}

function buildIdentifiers(facts, entityId, jurisdiction) {
  return facts.filter(fact =>
    fact.extracted_entity_id === entityId && fact.validation_status === "valid"
  ).map(fact => {
    const scheme = identifierSchemeFromField(fact.field_name);
    if (!scheme) return null;
    const raw = fact.normalized_value ?? fact.raw_value;
    const value = normalizeEntityIdentifier(typeof raw === "object" && raw !== null ? raw.value : raw);
    if (!value) return null;
    return {
      scheme, jurisdiction, normalized_value: value,
      raw_value: textOf(fact.raw_value).slice(0, 1000),
      field_name: fact.field_name, source_span: fact.source_span || {}
    };
  }).filter(Boolean).filter((item, index, all) =>
    all.findIndex(other => other.scheme === item.scheme &&
      other.jurisdiction === item.jurisdiction &&
      other.normalized_value === item.normalized_value) === index
  ).slice(0, 20);
}

function candidateRow(input, matchType, matchedEntityId, score, rationale) {
  return {
    extracted_entity_id: input.extracted_entity_id,
    match_type: matchType,
    matched_entity_id: matchedEntityId || null,
    proposed_name: input.proposed_name,
    normalized_name: input.normalized_name,
    jurisdiction: input.jurisdiction,
    identifier_proposals: input.identifier_proposals,
    match_score: Number(Math.max(0, Math.min(1, score)).toFixed(3)),
    rationale: { ...rationale, auto_link_permitted: false, human_review_required: true }
  };
}

function matchExistingEntity(input, existingEntities) {
  const scoped = existingEntities.filter(entity =>
    entity.entity_kind === "organization" && entity.status === "active" &&
    normalizeJurisdiction(entity.jurisdiction) === input.jurisdiction
  );
  const idHits = new Map();
  for (const proposed of input.identifier_proposals) {
    for (const entity of scoped) {
      for (const current of entity.identifiers || []) {
        if (current.scheme === proposed.scheme &&
          normalizeJurisdiction(current.jurisdiction) === proposed.jurisdiction &&
          normalizeEntityIdentifier(current.normalized_value || current.value) === proposed.normalized_value) {
          idHits.set(entity.id, (idHits.get(entity.id) || 0) + 1);
        }
      }
    }
  }
  if (idHits.size === 1) {
    const [[entityId, count]] = [...idHits.entries()];
    return candidateRow(input, "exact_identifier", entityId, 1, {
      method: "exact_identifier",
      explanation: "An approved identifier matches one active canonical entity in the same jurisdiction.",
      exact_identifier_hits: count,
      candidate_entities: [{ entity_id: entityId, matching_identifiers: count }]
    });
  }
  if (idHits.size > 1) {
    return candidateRow(input, "ambiguous_identifier", null, 1, {
      method: "exact_identifier_conflict",
      explanation: "The source identifier matched multiple canonical entities. No automatic selection is permitted.",
      candidate_entities: [...idHits.entries()].map(([entityId, count]) => ({
        entity_id: entityId, matching_identifiers: count
      })).slice(0, 10)
    });
  }
  const normalized = input.normalized_name;
  const exactHits = new Map();
  for (const entity of scoped) {
    if (normalizeCompanyName(entity.normalized_name || entity.legal_name) === normalized) {
      exactHits.set(entity.id, "exact_legal_name");
    }
    for (const alias of entity.aliases || []) {
      if (normalizeCompanyName(alias.normalized_alias || alias.alias) === normalized &&
        !exactHits.has(entity.id)) exactHits.set(entity.id, "exact_alias");
    }
  }
  if (exactHits.size === 1) {
    const [[entityId, type]] = [...exactHits.entries()];
    return candidateRow(input, type, entityId, type === "exact_legal_name" ? 0.99 : 0.97, {
      method: type,
      explanation: "A normalised legal name or owner-accepted alias matched one active entity in the same jurisdiction.",
      candidate_entities: [{ entity_id: entityId, match_type: type }]
    });
  }
  if (exactHits.size > 1) {
    return candidateRow(input, "ambiguous_name", null, 0.99, {
      method: "exact_name_conflict",
      explanation: "The normalised name matched multiple canonical names or aliases.",
      candidate_entities: [...exactHits.entries()].map(([entityId, type]) => ({
        entity_id: entityId, match_type: type
      })).slice(0, 10)
    });
  }
  const fuzzy = scoped.map(entity => {
    const names = [entity.normalized_name || entity.legal_name,
      ...(entity.aliases || []).map(alias => alias.normalized_alias || alias.alias)].filter(Boolean);
    return {
      entity_id: entity.id,
      score: Math.max(0, ...names.map(name => trigramDiceSimilarity(normalized, name)))
    };
  }).filter(item => item.score >= 0.84).sort((a, b) => b.score - a.score).slice(0, 5);
  if (fuzzy.length) {
    const clearLeader = fuzzy.length === 1 || fuzzy[0].score - fuzzy[1].score >= 0.04;
    return candidateRow(input, clearLeader ? "name_similarity" : "ambiguous_name_similarity",
      clearLeader ? fuzzy[0].entity_id : null, fuzzy[0].score, {
        method: "trigram_name_similarity",
        explanation: clearLeader
          ? "Name similarity generated a review candidate; it does not establish identity."
          : "Several canonical entities have similar names. No candidate was selected automatically.",
        threshold: 0.84, candidate_entities: fuzzy
      });
  }
  return candidateRow(input, "new_entity_proposal", null, 0, {
    method: "no_scoped_match",
    explanation: "No active canonical entity matched the source-backed name or identifiers in this jurisdiction."
  });
}

export function buildEntityResolutionCandidates({
  extractedEntities, extractedFacts, existingEntities = [], jurisdiction
}) {
  const orgs = (extractedEntities || []).filter(entity => entity.entity_kind === "organization");
  const sourceJurisdiction = normalizeJurisdiction(jurisdiction);
  return orgs.map(entity => {
    const proposedName = getLegalName(entity, extractedFacts || []);
    const normalizedName = normalizeCompanyName(proposedName || entity.normalized_name || entity.raw_name);
    const entityJurisdiction = sourceJurisdiction || normalizeJurisdiction(entity.jurisdiction);
    const input = {
      extracted_entity_id: entity.id,
      proposed_name: (proposedName || textOf(entity.raw_name)).slice(0, 1000),
      normalized_name: normalizedName.slice(0, 1000),
      jurisdiction: entityJurisdiction,
      identifier_proposals: buildIdentifiers(extractedFacts || [], entity.id, entityJurisdiction)
    };
    if (!input.proposed_name || !input.normalized_name || !input.jurisdiction) {
      return candidateRow(input, "insufficient_identity_data", null, 0, {
        method: "insufficient_identity_data",
        explanation: "A source-backed name or jurisdiction is missing. No cross-jurisdiction matching was attempted."
      });
    }
    return matchExistingEntity(input, existingEntities || []);
  });
}
