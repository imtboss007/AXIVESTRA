const FIELD_TYPES = new Map([
  ["address","formatted"],["formatted_address","formatted"],["full_address","formatted"],
  ["address_line","line1"],["address_line_1","line1"],["address1","line1"],
  ["street_address","line1"],["premise","line1"],
  ["street","street"],["street_name","street"],["road","street"],
  ["house_number","house_number"],["housenumber","house_number"],["building_number","house_number"],
  ["locality","locality"],["neighbourhood","locality"],["neighborhood","locality"],
  ["suburb","locality"],["district","district"],["county","district"],
  ["city","city"],["town","city"],["municipality","city"],["village","city"],
  ["state","state"],["state_name","state"],["province","state"],["region","region"],
  ["postal_code","postcode"],["postcode","postcode"],["zip","postcode"],["zip_code","postcode"],
  ["country","country"],["country_name","country"],["country_code","country_code"],["countrycode","country_code"],
  ["latitude","latitude"],["lat","latitude"],["longitude","longitude"],["lon","longitude"],["lng","longitude"]
]);

const clean = value => typeof value === "string"
  ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()
  : String(value ?? "").trim();

const keyOf = value => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

function factValue(fact) {
  const value = fact.normalized_value ?? fact.raw_value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value.value ?? value.id ?? "";
  }
  return value;
}

function validCoordinate(value, minimum, maximum) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) return null;
  const number = Number(raw);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

function validCountryCode(value) {
  const code = clean(value).toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  try {
    const name = new Intl.DisplayNames(["en"], { type: "region" }).of(code);
    return name && name !== code && !/unknown region/i.test(name) ? code : null;
  } catch {
    return null;
  }
}

function normalizeText(value, upper = false) {
  const normalized = clean(value);
  return normalized ? (upper ? normalized.toUpperCase() : normalized) : null;
}

export function normalizePlaceAddress(fields = {}) {
  const result = {
    formatted: normalizeText(fields.formatted),
    line1: normalizeText(fields.line1),
    street: normalizeText(fields.street),
    house_number: normalizeText(fields.house_number),
    locality: normalizeText(fields.locality),
    district: normalizeText(fields.district),
    city: normalizeText(fields.city),
    state: normalizeText(fields.state),
    region: normalizeText(fields.region),
    postcode: normalizeText(fields.postcode, true),
    country: normalizeText(fields.country),
    country_code: fields.country_code ? validCountryCode(fields.country_code) : null
  };
  if (!result.formatted) {
    const localityParts = [
      result.line1 || [result.house_number, result.street].filter(Boolean).join(" "),
      result.locality, result.district, result.city, result.state || result.region,
      result.postcode, result.country
    ].filter(Boolean);
    result.formatted = localityParts.length ? localityParts.join(", ") : null;
  }
  return result;
}

function fieldValueMap(facts, allowedFields, fieldSchema) {
  const values = {};
  const spans = {};
  const confidence = {};
  for (const fact of facts) {
    if (fact.validation_status !== "valid" || !fact.source_span ||
        typeof fact.source_span !== "object" || Array.isArray(fact.source_span)) continue;
    const field = String(fact.field_name || "");
    if (!allowedFields.includes(field) || !fieldSchema?.[field]) continue;
    const target = FIELD_TYPES.get(keyOf(field));
    if (!target) continue;
    const value = factValue(fact);
    if (value === null || value === undefined || value === "") continue;
    if (values[target] === undefined) {
      values[target] = value;
      spans[target] = fact.source_span;
      if (Number.isFinite(Number(fact.confidence))) confidence[target] = Number(fact.confidence);
    }
  }
  return { values, spans, confidence };
}

export function buildPlaceCandidates({
  extractedEntities = [], extractedFacts = [], allowedFields = [],
  fieldSchema = {}, evidenceId
}) {
  const results = [];
  const factsByEntity = new Map();
  for (const fact of extractedFacts) {
    if (!factsByEntity.has(fact.extracted_entity_id)) factsByEntity.set(fact.extracted_entity_id, []);
    factsByEntity.get(fact.extracted_entity_id).push(fact);
  }

  for (const entity of extractedEntities) {
    if (!["organization", "location"].includes(entity.entity_kind)) continue;
    const { values, spans, confidence } = fieldValueMap(
      factsByEntity.get(entity.id) || [], allowedFields, fieldSchema
    );
    const address = normalizePlaceAddress(values);
    const latitude = validCoordinate(values.latitude, -90, 90);
    const longitude = validCoordinate(values.longitude, -180, 180);
    const hasAnyAddress = Object.entries(address)
      .some(([key, value]) => key !== "country_code" && Boolean(value)) || Boolean(address.country_code);
    const coordinateFactConfidence = [
      confidence.latitude, confidence.longitude
    ].filter(value => Number.isFinite(value));
    const coordinatePairPresent = values.latitude !== undefined && values.longitude !== undefined;
    const coordinatesValid = latitude !== null && longitude !== null;
    const sourceCoordinates = coordinatesValid ? { latitude, longitude } : null;
    const incompleteCoordinates = coordinatePairPresent && !coordinatesValid;
    if (!hasAnyAddress && !sourceCoordinates && !incompleteCoordinates) continue;

    const requiredAddressComponents = [
      address.formatted, address.city, address.state, address.postcode, address.country
    ].filter(Boolean);
    const addressFactConfidence = Object.entries(confidence)
      .filter(([key]) => key !== "latitude" && key !== "longitude")
      .map(([, value]) => value);
    const allEvidenceConfidence = [
      ...coordinateFactConfidence, ...addressFactConfidence
    ].filter(value => Number.isFinite(value) && value >= 0 && value <= 1);
    results.push({
      extracted_entity_id: entity.id,
      entity_kind: entity.entity_kind,
      place_label: clean(entity.raw_name || entity.normalized_name).slice(0, 300),
      address,
      source_coordinates: sourceCoordinates,
      coordinate_state: sourceCoordinates ? "source_coordinates" :
        incompleteCoordinates ? "invalid_or_incomplete_source_coordinates" : "not_supplied",
      source_coordinate_confidence: coordinateFactConfidence.length === 2
        ? Math.min(...coordinateFactConfidence) : null,
      source_confidence: allEvidenceConfidence.length ? Math.min(...allEvidenceConfidence) : null,
      confidence_method: sourceCoordinates ? "minimum_source_lat_lon_fact_confidence" :
        allEvidenceConfidence.length ? "minimum_observed_fact_confidence" : null,
      address_completeness: {
        has_formatted_address: Boolean(address.formatted),
        component_count: requiredAddressComponents.length,
        country_code_validated: Boolean(address.country_code)
      },
      provider: null,
      provider_candidates: [],
      provider_attribution: null,
      source_span: { entity: entity.source_span || {}, fields: spans },
      evidence_id: evidenceId || null,
      candidate_state: incompleteCoordinates ? "needs_coordinate_review" :
        sourceCoordinates ? "source_coordinates_available" :
        hasAnyAddress ? "address_ready_for_geocoding" : "insufficient_location_data",
      rationale: {
        no_person_entities: true,
        source_field_allowlist_enforced: true,
        coordinates_not_inferred: true,
        geocoding_is_not_ownership_evidence: true,
        requires_human_review: true
      }
    });
  }
  return results;
}

function normalizedCompare(value) {
  return clean(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

export function scorePhotonAddressMatch(address, properties = {}) {
  const pairs = [
    [address.house_number, properties.housenumber],
    [address.street, properties.street],
    [address.postcode, properties.postcode],
    [address.city, properties.city],
    [address.district, properties.district || properties.county],
    [address.state, properties.state],
    [address.country, properties.country],
    [address.country_code, properties.countrycode]
  ].filter(([expected]) => Boolean(expected));
  if (!pairs.length) return { score: null, matched: 0, supplied: 0, method: "no_comparable_address_components" };
  const matched = pairs.filter(([expected, actual]) =>
    Boolean(actual) && normalizedCompare(expected) === normalizedCompare(actual)
  ).length;
  return {
    score: Number((matched / pairs.length).toFixed(3)),
    matched,
    supplied: pairs.length,
    method: "exact_address_component_overlap_v1"
  };
}
