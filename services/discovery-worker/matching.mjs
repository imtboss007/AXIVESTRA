import { createHash } from "node:crypto";

const DIMENSIONS = Object.freeze([
  "geography","type","ticket","instrument","collateral","stage","mandate","evidence_freshness"
]);
const CATEGORICAL = Object.freeze(["type","instrument","collateral","stage","mandate"]);
const MAX_LABELS = 100;

const text = value => typeof value === "string"
  ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim()
  : "";
const key = value => text(value).toLocaleLowerCase("en").replace(/[\s_-]+/g," ");
const list = value => {
  const items = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(items.map(key).filter(Boolean))];
};
const finite = value => typeof value === "number" && Number.isFinite(value);
const round = (value, places=2) => Number(value.toFixed(places));
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

function invalid(message) {
  const error = new Error("Invalid E11 match criteria: " + message);
  error.code = "E11_INVALID_CRITERIA";
  throw error;
}

export function validateMatchCriteria(criteria) {
  if (!isObject(criteria)) invalid("criteria must be an object.");
  if (criteria.schemaVersion !== 1) invalid("schemaVersion must be 1.");
  if (!isObject(criteria.weights) || !isObject(criteria.dimensions)) {
    invalid("weights and dimensions must be objects.");
  }
  if (Object.keys(criteria.weights).some(name => !DIMENSIONS.includes(name))) {
    invalid("weights contain an unsupported dimension.");
  }
  if (Object.keys(criteria.dimensions).some(name => !DIMENSIONS.includes(name))) {
    invalid("dimensions contain an unsupported dimension.");
  }

  const weights = {};
  for (const dimension of DIMENSIONS) {
    const weight = criteria.weights[dimension] ?? 0;
    if (!Number.isInteger(weight) || weight < 0 || weight > 100) {
      invalid("each dimension weight must be an integer from 0 to 100.");
    }
    weights[dimension] = weight;
    if (weight > 0 && !Object.hasOwn(criteria.dimensions,dimension)) {
      invalid("a positively weighted dimension needs an explicit rule: " + dimension);
    }
    if (weight === 0 && Object.hasOwn(criteria.dimensions,dimension)) {
      invalid("a configured dimension must have a positive weight: " + dimension);
    }
  }
  if (Object.values(weights).reduce((sum,value)=>sum+value,0) !== 100) {
    invalid("active dimension weights must sum to 100.");
  }
  if (!Object.keys(criteria.dimensions).length) invalid("at least one dimension is required.");

  for (const [dimension,rule] of Object.entries(criteria.dimensions)) {
    if (!isObject(rule)) invalid(dimension + " rule must be an object.");
    if (dimension === "geography") {
      const positive = ["countries","states","cities"];
      if (!positive.some(name => list(rule[name]).length)) {
        invalid("geography requires at least one country, state or city target.");
      }
      for (const name of [...positive,"excludedCountries"]) {
        if (list(rule[name]).length > MAX_LABELS) invalid("geography list is too large.");
      }
    } else if (CATEGORICAL.includes(dimension)) {
      if (!list(rule.anyOf).length) invalid(dimension + ".anyOf must contain at least one value.");
      if (list(rule.anyOf).length > MAX_LABELS || list(rule.exclude).length > MAX_LABELS) {
        invalid(dimension + " lists are too large.");
      }
    } else if (dimension === "ticket") {
      if (!/^[A-Z]{3}$/.test(text(rule.currency))) invalid("ticket currency must be a three-letter ISO-style code.");
      if (rule.minimum === undefined && rule.maximum === undefined) invalid("ticket requires minimum or maximum.");
      for (const bound of [rule.minimum,rule.maximum]) {
        if (bound !== undefined && (!finite(bound) || bound < 0)) invalid("ticket bounds must be non-negative finite numbers.");
      }
      if (rule.minimum !== undefined && rule.maximum !== undefined && rule.minimum > rule.maximum) {
        invalid("ticket minimum cannot exceed maximum.");
      }
    } else if (dimension === "evidence_freshness") {
      if (!Number.isInteger(rule.maxAgeDays) || rule.maxAgeDays < 1 || rule.maxAgeDays > 3650) {
        invalid("evidence_freshness.maxAgeDays must be 1–3650.");
      }
    }
  }

  const minimumCoverage = criteria.minimumCoverage ?? 0.6;
  if (!finite(minimumCoverage) || minimumCoverage < 0.1 || minimumCoverage > 1) {
    invalid("minimumCoverage must be between 0.1 and 1.");
  }
  return {
    schemaVersion:1,
    weights,
    dimensions:structuredClone(criteria.dimensions),
    minimumCoverage
  };
}

function evidenceFor(candidate, dimension) {
  if (!Array.isArray(candidate.evidence)) return [];
  return candidate.evidence.filter(item =>
    isObject(item) && item.dimension === dimension && item.reviewState === "accepted" &&
    typeof item.sourceId === "string" && text(item.sourceId).length <= 160 &&
    typeof item.evidenceId === "string" && text(item.evidenceId).length <= 160 &&
    finite(item.sourceConfidence) && item.sourceConfidence >= 0 && item.sourceConfidence <= 1 &&
    (item.publishedAt == null || (typeof item.publishedAt === "string" && Number.isFinite(Date.parse(item.publishedAt)))) &&
    (item.capturedAt == null || (typeof item.capturedAt === "string" && Number.isFinite(Date.parse(item.capturedAt)))) &&
    (item.publishedAt || item.capturedAt)
  );
}

function missing(dimension, weight, reason) {
  return {
    dimension,weight,status:"unknown",score:null,factor:"unknown",
    reason,evidenceIds:[],sourceIds:[],evidenceConfidence:null
  };
}

function component({dimension,weight,score,reason,evidence,factor}) {
  const confidence = evidence.length
    ? evidence.reduce((sum,item)=>sum+item.sourceConfidence,0)/evidence.length
    : null;
  return {
    dimension,weight,status:"assessed",score:round(score),factor,reason,
    evidenceIds:[...new Set(evidence.map(item=>text(item.evidenceId)))],
    sourceIds:[...new Set(evidence.map(item=>text(item.sourceId)))],
    evidenceConfidence:confidence===null?null:round(confidence,4)
  };
}

function scoreGeography(rule,candidate,evidence,weight) {
  const actual = isObject(candidate.geography) ? candidate.geography : {};
  const checks = [
    ["countries",list(rule.countries),list(actual.countries ?? actual.country)],
    ["states",list(rule.states),list(actual.states ?? actual.state)],
    ["cities",list(rule.cities),list(actual.cities ?? actual.city)]
  ].filter(([,targets])=>targets.length);
  if (!checks.length) return missing("geography",weight,"No positive geography target was configured.");
  if (checks.some(([name,,values])=>!values.length)) {
    return missing("geography",weight,"One or more configured geography levels have no source-backed value.");
  }
  if (!evidence.length) return missing("geography",weight,"No source evidence is linked to the geography values.");
  const excluded = list(rule.excludedCountries);
  const countryValues = list(actual.countries ?? actual.country);
  const excludedMatch = excluded.some(value=>countryValues.includes(value));
  const failed = checks.filter(([,targets,values])=>!targets.some(value=>values.includes(value)));
  const score = !excludedMatch && !failed.length ? 100 : 0;
  const reason = excludedMatch
    ? "Candidate geography matches an explicitly excluded country."
    : failed.length
      ? "Candidate does not match the configured " + failed.map(item=>item[0]).join(", ") + " geography."
      : "Candidate matches every configured geography level.";
  return component({dimension:"geography",weight,score,reason,evidence,factor:score===100?"positive":"negative"});
}

function scoreCategorical(dimension,rule,candidate,evidence,weight) {
  const values = list(candidate[dimension]);
  if (!values.length) return missing(dimension,weight,"No source-backed " + dimension + " value is available.");
  if (!evidence.length) return missing(dimension,weight,"No source evidence is linked to the " + dimension + " value.");
  const allowed = list(rule.anyOf), excluded = list(rule.exclude);
  const excludedMatch = excluded.some(value=>values.includes(value));
  const allowedMatch = allowed.some(value=>values.includes(value));
  const score = !excludedMatch && allowedMatch ? 100 : 0;
  const reason = excludedMatch
    ? "Candidate matches an explicitly excluded " + dimension + "."
    : allowedMatch
      ? "Candidate matches at least one configured " + dimension + " value."
      : "Candidate does not match the configured " + dimension + " values.";
  return component({dimension,weight,score,reason,evidence,factor:score===100?"positive":"negative"});
}

function scoreTicket(rule,candidate,evidence,weight) {
  const ticket = candidate.ticket;
  if (!isObject(ticket) || !finite(ticket.amount) || ticket.amount < 0) {
    return missing("ticket",weight,"No valid source-backed ticket amount is available.");
  }
  if (!evidence.length) return missing("ticket",weight,"No source evidence is linked to the ticket amount.");
  const currency = text(ticket.currency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return missing("ticket",weight,"Candidate ticket currency is missing or invalid.");
  if (currency !== rule.currency) {
    return missing("ticket",weight,"Currency differs from workspace criteria; no conversion is performed.");
  }
  const below = rule.minimum !== undefined && ticket.amount < rule.minimum;
  const above = rule.maximum !== undefined && ticket.amount > rule.maximum;
  const score = below || above ? 0 : 100;
  const range = (rule.minimum === undefined ? "no minimum" : rule.minimum) +
    " to " + (rule.maximum === undefined ? "no maximum" : rule.maximum) + " " + rule.currency;
  const reason = score===100
    ? "Candidate ticket is within the configured range (" + range + ")."
    : "Candidate ticket is outside the configured range (" + range + ").";
  return component({dimension:"ticket",weight,score,reason,evidence,factor:score===100?"positive":"negative"});
}

function dateOf(item) {
  const value=item.publishedAt || item.capturedAt;
  return value ? Date.parse(value) : NaN;
}

function scoreFreshness(rule,allEvidence,asOf,weight) {
  if (!allEvidence.length) return missing("evidence_freshness",weight,"No source-backed evidence dates are available.");
  const now=Date.parse(asOf);
  if (!Number.isFinite(now)) throw new Error("E11 asOf must be a valid ISO date.");
  const dates=allEvidence.map(dateOf);
  if (dates.some(value=>!Number.isFinite(value)||value>now)) {
    return missing("evidence_freshness",weight,"Evidence contains an invalid or future publication/capture date.");
  }
  const oldest=Math.min(...dates);
  const ageDays=Math.max(0,(now-oldest)/86_400_000);
  const maxAge=rule.maxAgeDays;
  const score=ageDays<=maxAge?100:Math.max(0,100*(2*maxAge-ageDays)/maxAge);
  const stale=ageDays>maxAge;
  const reason=stale
    ? "Oldest evidence used is " + round(ageDays,1) + " days old; configured freshness window is " + maxAge + " days."
    : "All evidence used is within the " + maxAge + "-day freshness window.";
  return component({
    dimension:"evidence_freshness",weight,score,reason,evidence:allEvidence,
    factor:stale?"warning":"positive"
  });
}

export function scoreWorkspaceFit({criteria,candidate,asOf}={}) {
  const rules=validateMatchCriteria(criteria);
  if (!isObject(candidate)) throw new Error("E11 candidate must be an object.");
  const timestamp=asOf || new Date().toISOString();
  if (!Number.isFinite(Date.parse(timestamp))) throw new Error("E11 asOf must be a valid ISO date.");

  const components=[];
  for (const dimension of DIMENSIONS) {
    const weight=rules.weights[dimension];
    if (!weight) continue;
    const evidence=evidenceFor(candidate,dimension);
    const rule=rules.dimensions[dimension];
    let result;
    if (dimension==="geography") result=scoreGeography(rule,candidate,evidence,weight);
    else if (CATEGORICAL.includes(dimension)) result=scoreCategorical(dimension,rule,candidate,evidence,weight);
    else if (dimension==="ticket") result=scoreTicket(rule,candidate,evidence,weight);
    else {
      const freshnessEvidence=components
        .filter(item=>item.status==="assessed")
        .flatMap(item=>evidenceFor(candidate,item.dimension));
      result=scoreFreshness(rule,freshnessEvidence,timestamp,weight);
    }
    components.push(result);
  }

  const assessed=components.filter(item=>item.status==="assessed");
  const assessedWeight=assessed.reduce((sum,item)=>sum+item.weight,0);
  const totalWeight=components.reduce((sum,item)=>sum+item.weight,0);
  const weightedScore=assessed.reduce((sum,item)=>sum+item.score*item.weight,0);
  const fitScore=assessedWeight?round(weightedScore/assessedWeight):null;
  const coverage=round(assessedWeight/totalWeight*100);
  const evidenceQuality=assessedWeight
    ? assessed.reduce((sum,item)=>sum+(item.evidenceConfidence??0)*item.weight,0)/assessedWeight
    : 0;
  const freshness=components.find(item=>item.dimension==="evidence_freshness"&&item.status==="assessed");
  const freshnessModifier=freshness?freshness.score/100:1;
  const confidence=round(evidenceQuality*coverage*freshnessModifier);
  const state=!assessedWeight||coverage < rules.minimumCoverage*100
    ? "insufficient_data" : "review_required";
  const positives=components.filter(item=>item.factor==="positive").map(item=>({dimension:item.dimension,reason:item.reason}));
  const negatives=components.filter(item=>item.factor==="negative").map(item=>({dimension:item.dimension,reason:item.reason}));
  const warnings=components.filter(item=>item.factor==="warning"||item.factor==="unknown").map(item=>({dimension:item.dimension,reason:item.reason}));

  return {
    ruleVersion:"deterministic-rules-v1",
    matchScore:fitScore,
    confidence,
    coverage,
    assessedWeight,
    totalWeight,
    state,
    reviewState:"pending_review",
    components,
    rationale:{positive:positives,negative:negatives,unknown:warnings},
    evidenceRefs:{
      evidenceIds:[...new Set(components.flatMap(item=>item.evidenceIds))],
      sourceIds:[...new Set(components.flatMap(item=>item.sourceIds))]
    }
  };
}

export function scoreWorkspaceCandidates({criteria,candidates=[],asOf}={}) {
  if (!Array.isArray(candidates)) throw new Error("E11 candidates must be an array.");
  return candidates.map(candidate=>({
    candidateId:candidate.id || null,
    canonicalEntityId:candidate.canonicalEntityId || null,
    ...scoreWorkspaceFit({criteria,candidate,asOf})
  })).sort((a,b)=>
    (b.matchScore??-1)-(a.matchScore??-1) ||
    b.confidence-a.confidence ||
    String(a.canonicalEntityId||a.candidateId||"").localeCompare(String(b.canonicalEntityId||b.candidateId||""))
  );
}


function canonicalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("E11 snapshot contains a non-finite number.");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isObject(value)) {
    const output={};
    for (const name of Object.keys(value).sort()) {
      if (value[name] === undefined) throw new Error("E11 snapshot contains an undefined property.");
      output[name]=canonicalize(value[name]);
    }
    return output;
  }
  throw new Error("E11 snapshots must contain JSON-compatible values only.");
}

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function safeCandidateSnapshot(candidate,criteria) {
  const snapshot={
    entityKind:"organization",
    canonicalEntityId:text(candidate.canonicalEntityId)
  };
  const configured=criteria.dimensions;
  if (configured.geography) {
    const geo=isObject(candidate.geography)?candidate.geography:{};
    snapshot.geography={
      countries:list(geo.countries ?? geo.country),
      states:list(geo.states ?? geo.state),
      cities:list(geo.cities ?? geo.city)
    };
  }
  for (const dimension of CATEGORICAL) {
    if (configured[dimension]) snapshot[dimension]=list(candidate[dimension]);
  }
  if (configured.ticket) {
    const ticket=isObject(candidate.ticket)?candidate.ticket:{};
    snapshot.ticket={
      amount:finite(ticket.amount)?ticket.amount:null,
      currency:/^[A-Z]{3}$/.test(text(ticket.currency).toUpperCase())
        ? text(ticket.currency).toUpperCase() : null
    };
  }
  const dimensions=Object.keys(configured).filter(name=>name!=="evidence_freshness");
  snapshot.evidence=dimensions.flatMap(dimension=>
    evidenceFor(candidate,dimension).map(item=>({
      dimension,
      sourceId:text(item.sourceId),
      evidenceId:text(item.evidenceId),
      sourceConfidence:item.sourceConfidence,
      publishedAt:item.publishedAt || null,
      capturedAt:item.capturedAt || null,
      reviewState:"accepted"
    }))
  ).sort((a,b)=>
    a.dimension.localeCompare(b.dimension) ||
    a.sourceId.localeCompare(b.sourceId) ||
    a.evidenceId.localeCompare(b.evidenceId)
  );
  return snapshot;
}

export function buildMatchScoreRecord({profile,candidate,criteria,asOf}={}) {
  if (!isObject(profile) || !text(profile.id) || !text(profile.company_id) ||
      !text(profile.workspace_key) || !["LENDER","CUSTOMER"].includes(text(profile.discovery_mode).toUpperCase())) {
    throw new Error("E11 requires a persisted company-scoped LENDER/CUSTOMER workspace profile.");
  }
  if (!isObject(candidate) || candidate.entityKind !== "organization" ||
      !text(candidate.canonicalEntityId)) {
    throw new Error("E11 scoring persistence is limited to an assigned canonical organization.");
  }
  const normalizedCriteria=validateMatchCriteria(criteria);
  const result=scoreWorkspaceFit({criteria:normalizedCriteria,candidate,asOf});
  const candidateSnapshot=safeCandidateSnapshot(candidate,normalizedCriteria);
  return {
    company_id:text(profile.company_id),
    profile_id:text(profile.id),
    canonical_entity_id:text(candidate.canonicalEntityId),
    workspace_key:text(profile.workspace_key),
    discovery_mode:text(profile.discovery_mode).toUpperCase(),
    criteria_hash:sha256(normalizedCriteria),
    candidate_hash:sha256(candidateSnapshot),
    rule_version:result.ruleVersion,
    match_score:result.matchScore,
    confidence:result.confidence,
    coverage:result.coverage,
    score_state:result.state,
    score_components:result.components,
    rationale:result.rationale,
    evidence_refs:result.evidenceRefs,
    criteria_snapshot:normalizedCriteria,
    candidate_snapshot:candidateSnapshot,
    review_state:"pending_review"
  };
}
