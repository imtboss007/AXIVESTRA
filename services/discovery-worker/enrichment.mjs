const ATTRIBUTE_REGISTRY = new Map();

function define(category, valueTypes, keys) {
  for (const key of keys) ATTRIBUTE_REGISTRY.set(key, { attributeKey:key, category, valueTypes });
}

define("business",["string","date","boolean","identifier","array"],[
  "company_status","status","legal_status","operating_status","industry","industry_sector",
  "business_description","business_model","founded_date","incorporation_date","registration_date",
  "products","services","website","business_type","entity_type","sector","business_sector",
  "institution_type","lender_category","borrower_type","counterparty_type","investor_type",
  "capital_instrument","funding_instrument","debt_equity_instrument","facility_type","product_type",
  "collateral_type","eligible_collateral","security_type","startup_stage","funding_stage",
  "project_stage","development_stage","mandate","investment_mandate","lending_mandate",
  "funding_mandate","investment_thesis","geography","country","state","city","district"
]);
define("finance",["currency","number","percentage","date","string","identifier"],[
  "revenue","annual_revenue","turnover","annual_turnover","ebitda","profit","net_profit",
  "net_income","total_assets","total_liabilities","total_debt","assets_under_management","aum",
  "valuation","funding_amount","paid_up_capital","net_worth","ticket_size","interest_rate",
  "profit_margin","revenue_growth","debt_to_equity","financial_year","reporting_period",
  "minimum_ticket_size","maximum_ticket_size","min_ticket","max_ticket"
]);
define("property",["number","currency","string","date","boolean","identifier"],[
  "land_area","plot_area","site_area","built_up_area","carpet_area","floor_area","property_area",
  "land_value","property_value","assessed_value","property_type","zoning","occupancy_status",
  "building_count","floor_count","property_class","construction_year","property_condition",
  "land_use","development_status"
]);
define("operating",["number","percentage","currency","string","date","boolean"],[
  "employee_count","headcount","production_capacity","annual_production_capacity",
  "capacity_utilization","utilization_rate","operating_sites","plant_count","facility_count",
  "operating_hours","export_volume","import_volume","export_ratio","production_volume",
  "annual_production_volume","manufacturing_capacity","operating_since","factory_count",
  "branch_count","warehouse_count"
]);

const clean = value => typeof value === "string"
  ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim()
  : String(value ?? "").trim();
const keyOf = value => clean(value).toLowerCase()
  .replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");

function jsonValue(fact) {
  return fact.normalized_value === undefined || fact.normalized_value === null
    ? fact.raw_value : fact.normalized_value;
}

function safeSchemaMetadata(definition, key) {
  const value = definition?.[key];
  if (typeof value !== "string") return null;
  const normal = clean(value);
  return normal && normal.length <= 40 ? normal : null;
}

export function getEnrichmentAttribute(fieldName) {
  return ATTRIBUTE_REGISTRY.get(keyOf(fieldName)) || null;
}

export function buildEnrichmentCandidates({
  extractedEntities = [], extractedFacts = [], assignments = [], canonicalEntities = [],
  allowedFields = [], fieldSchema = {}, evidenceId, sourceId, sourceName, sourceDomain,
  sourceJurisdiction, sourceAttribution, sourceLicenseRef, sourcePublishedAt,
  evidenceCapturedAt, evidenceContentHash, extractionCompletedAt
}) {
  const assignmentMap = new Map(assignments.map(item => [
    item.extracted_entity_id, item.canonical_entity_id
  ]));
  const canonicalById = new Map(canonicalEntities
    .filter(item => item.entity_kind === "organization" && item.status === "active")
    .map(item => [item.id, item]));
  const entityById = new Map(extractedEntities
    .filter(item => item.entity_kind === "organization")
    .map(item => [item.id,item]));
  const candidates = [];

  for (const fact of extractedFacts) {
    if (fact.validation_status !== "valid" ||
        !fact.source_span || typeof fact.source_span !== "object" || Array.isArray(fact.source_span)) continue;
    const fieldName = String(fact.field_name || "");
    if (!allowedFields.includes(fieldName) || !Object.hasOwn(fieldSchema,fieldName)) continue;
    const attribute = getEnrichmentAttribute(fieldName);
    if (!attribute) continue;
    const valueType = String(fact.value_type || "").toLowerCase();
    if (!attribute.valueTypes.includes(valueType) || fieldSchema[fieldName]?.type !== valueType) continue;
    const entity = entityById.get(fact.extracted_entity_id);
    if (!entity) continue;
    const canonicalId = assignmentMap.get(entity.id);
    const canonical = canonicalById.get(canonicalId);
    if (!canonical) continue;
    const raw = clean(fact.raw_value);
    if (!raw || raw.length > 20000) continue;
    const normalized = jsonValue(fact);
    if (normalized === null || normalized === undefined) continue;
    let serialized;
    try { serialized = JSON.stringify(normalized); } catch { continue; }
    if (!serialized || serialized.length > 20000) continue;
    const confidence = Number(fact.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) continue;

    const definition = fieldSchema[fieldName];
    candidates.push({
      extracted_fact_id:fact.id,
      extracted_entity_id:entity.id,
      canonical_entity_id:canonical.id,
      entity_kind:"organization",
      attribute_key:attribute.attributeKey,
      attribute_category:attribute.category,
      source_field_name:fieldName,
      value_type:valueType,
      raw_value:raw,
      normalized_value:normalized,
      source_unit:safeSchemaMetadata(definition,"unit"),
      currency_code:safeSchemaMetadata(definition,"currencyCode"),
      source_confidence:confidence,
      source_id:sourceId,
      source_name:clean(sourceName).slice(0,160),
      source_domain:clean(sourceDomain).slice(0,253),
      source_jurisdiction:clean(sourceJurisdiction).slice(0,80),
      source_attribution:clean(sourceAttribution).slice(0,500),
      source_license_ref:clean(sourceLicenseRef).slice(0,300),
      source_published_at:sourcePublishedAt || null,
      evidence_captured_at:evidenceCapturedAt || null,
      extraction_completed_at:extractionCompletedAt || null,
      evidence_id:evidenceId,
      evidence_content_hash:evidenceContentHash,
      source_span:fact.source_span,
      review_state:"pending_review",
      conflict_state:"none"
    });
  }
  return candidates;
}

export function detectPotentialEnrichmentConflicts(candidate, existingObservations) {
  if (!candidate || !Array.isArray(existingObservations)) return [];
  return existingObservations.filter(existing =>
    existing.canonical_entity_id === candidate.canonical_entity_id &&
    existing.attribute_key === candidate.attribute_key &&
    existing.source_id !== candidate.source_id &&
    JSON.stringify(existing.normalized_value) !== JSON.stringify(candidate.normalized_value)
  ).map(existing => ({
    candidate_id:candidate.id || null,
    conflicting_candidate_id:existing.id || null,
    canonical_entity_id:candidate.canonical_entity_id,
    attribute_key:candidate.attribute_key,
    first_source_id:existing.source_id,
    second_source_id:candidate.source_id,
    first_published_at:existing.source_published_at || null,
    second_published_at:candidate.source_published_at || null,
    first_captured_at:existing.evidence_captured_at || null,
    second_captured_at:candidate.evidence_captured_at || null,
    conflict_kind:"potential_value_disagreement",
    requires_human_review:true
  }));
}

const attributeCounts = {};
for (const item of ATTRIBUTE_REGISTRY.values()) {
  attributeCounts[item.category] = (attributeCounts[item.category] || 0) + 1;
}
export const ENRICHMENT_ATTRIBUTE_COUNTS = Object.freeze(attributeCounts);
