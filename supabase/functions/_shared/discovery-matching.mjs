const CRITERIA = Object.freeze([
  "geography","type","sector","ticket","instrument","collateral","stage","mandate","evidence_freshness"
]);
const clean = value => typeof value === "string"
  ? value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g," ")
  : value;
const finite = value => typeof value === "number" && Number.isFinite(value);
const asList = value => Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];

const DIMENSION_ATTRIBUTES = Object.freeze({
  geography: ["geography","country","state","city","district"],
  type: ["entity_type","business_type","institution_type","lender_category","borrower_type","counterparty_type","investor_type"],
  sector: ["industry","industry_sector","sector","business_sector"],
  instrument: ["capital_instrument","funding_instrument","debt_equity_instrument","facility_type"],
  collateral: ["collateral_type","eligible_collateral","security_type"],
  stage: ["startup_stage","funding_stage","project_stage","development_stage"],
  mandate: ["mandate","investment_mandate","lending_mandate","funding_mandate","investment_thesis"]
});

function valueTextList(value) {
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap(item => {
    if (typeof item !== "string") return [];
    const normal = item.normalize("NFKC").trim();
    if (!normal || normal.length > 300) return [];
    return normal.split(/[,;|]/).map(part => part.trim()).filter(Boolean).slice(0, 20);
  });
}

function numericAmount(value) {
  if (finite(value)) return value;
  if (value && typeof value === "object" && finite(value.amount)) return value.amount;
  return null;
}

/**
 * Build a scoring candidate only from E10 observations explicitly accepted
 * by a human reviewer. No pending/conflicting observation is used.
 */
export function buildE11CandidateFromAcceptedObservations({
  canonicalEntity = {},
  observations = []
} = {}) {
  const accepted = observations.filter(item =>
    item && item.review_state === "accepted" &&
    typeof item.attribute_key === "string" && item.evidence_id && item.source_id
  );
  const candidate = {};
  const evidenceById = new Map();
  const snapshot = { canonicalEntityId: canonicalEntity.id || null, dimensions: {}, evidenceReferences: [] };

  if (typeof canonicalEntity.entity_type === "string" && canonicalEntity.entity_type.trim()) {
    candidate.type = [canonicalEntity.entity_type.trim()];
  }
  const collect = key => accepted
    .filter(item => DIMENSION_ATTRIBUTES[key]?.includes(item.attribute_key))
    .flatMap(item => valueTextList(item.normalized_value));

  for (const key of ["geography","type","sector","instrument","collateral","stage","mandate"]) {
    const values = [...new Set([...asList(candidate[key]).flatMap(valueTextList), ...collect(key)])];
    if (values.length) candidate[key] = values;
  }

  const ticketRows = accepted.filter(item =>
    ["ticket_size","minimum_ticket_size","maximum_ticket_size","min_ticket","max_ticket"].includes(item.attribute_key)
  );
  const ticketNumbers = ticketRows.map(item => ({
    key: item.attribute_key,
    amount: numericAmount(item.normalized_value),
    currencyCode: typeof item.currency_code === "string" ? item.currency_code.toUpperCase() : null
  })).filter(item => item.amount !== null);
  const minRow = ticketNumbers.find(item => ["minimum_ticket_size","min_ticket"].includes(item.key));
  const maxRow = ticketNumbers.find(item => ["maximum_ticket_size","max_ticket"].includes(item.key));
  const singleRow = ticketNumbers.find(item => item.key === "ticket_size");
  if (minRow || maxRow || singleRow) {
    const currencyCodes = [...new Set(ticketNumbers.map(item => item.currencyCode).filter(Boolean))];
    candidate.ticket = {
      ...(minRow ? { min: minRow.amount } : {}),
      ...(maxRow ? { max: maxRow.amount } : {}),
      ...(!minRow && !maxRow && singleRow ? { amount: singleRow.amount } : {}),
      ...(currencyCodes.length === 1 ? { currencyCode: currencyCodes[0] } : {})
    };
  }

  for (const item of accepted) {
    if (!evidenceById.has(item.evidence_id)) {
      evidenceById.set(item.evidence_id, {
        evidence_id: item.evidence_id,
        source_id: item.source_id,
        source_published_at: item.source_published_at || null,
        evidence_captured_at: item.evidence_captured_at || null
      });
    }
  }
  const evidence = [...evidenceById.values()];
  for (const key of [...Object.keys(candidate)]) snapshot.dimensions[key] = candidate[key];
  snapshot.evidenceReferences = evidence.map(item => ({ ...item }));
  return { candidate, evidence, snapshot, acceptedObservationIds: accepted.map(item => item.id).filter(Boolean) };
}


function comparable(value) {
  if (typeof value === "string") return clean(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  return value;
}
function overlap(actual, expected) {
  const a=asList(actual).map(comparable);
  const e=asList(expected).map(comparable);
  if (!a.length || !e.length) return null;
  return e.some(item=>a.includes(item));
}
function evaluateRange(actual, expected) {
  if (!actual || typeof actual!=="object" || !expected || typeof expected!=="object") return null;
  const min=expected.min, max=expected.max;
  const low=actual.min ?? actual.amount ?? actual.value;
  const high=actual.max ?? actual.amount ?? actual.value;
  if ((!finite(low)&&!finite(high)) || (!finite(min)&&!finite(max))) return null;
  const actualCurrency = typeof actual.currencyCode === "string" ? actual.currencyCode.toUpperCase() : null;
  const expectedCurrency = typeof expected.currencyCode === "string" ? expected.currencyCode.toUpperCase() : null;
  if ((actualCurrency || expectedCurrency) && actualCurrency !== expectedCurrency) return null;
  if (finite(max)&&finite(low)&&low>max) return false;
  if (finite(min)&&finite(high)&&high<min) return false;
  return true;
}
function evaluateCriterion(key, actual, expected, now) {
  if (key==="evidence_freshness") {
    const timestamp=actual?.latestEvidenceAt || actual?.latest_evidence_at;
    const maxAge=expected?.maxAgeDays ?? expected?.max_age_days;
    if (!timestamp || !finite(maxAge) || maxAge<0) return {status:"unknown",reason:"No usable evidence timestamp or freshness limit."};
    const time=Date.parse(timestamp);
    if (!Number.isFinite(time)) return {status:"unknown",reason:"Evidence timestamp is invalid."};
    const ageDays=Math.max(0,(now-time)/86400000);
    const passed=ageDays<=maxAge;
    return {status:passed?"match":"mismatch",actual:ageDays,expected:maxAge,
      reason:passed?(`Evidence is ${Math.floor(ageDays)} day(s) old; within the ${maxAge}-day limit.`):(`Evidence is ${Math.floor(ageDays)} day(s) old; exceeds the ${maxAge}-day limit.`)};
  }
  if (actual===undefined || actual===null || expected===undefined || expected===null)
    return {status:"unknown",reason:"Candidate or workspace criterion is missing."};
  if (key==="ticket") {
    const result=evaluateRange(actual,expected);
    if(result===null) return {status:"unknown",reason:"Ticket ranges or currencies are not comparable."};
    return {status:result?"match":"mismatch",reason:result?"Ticket range overlaps the workspace range.":"Ticket range does not overlap the workspace range."};
  }
  const matched=overlap(actual,expected);
  if(matched===null) return {status:"unknown",reason:"Candidate or workspace criterion is not comparable."};
  return {status:matched?"match":"mismatch",reason:matched?"Candidate aligns with the workspace criterion.":"Candidate does not align with the workspace criterion."};
}

/**
 * Deterministic E11 scoring. Only workspace-supplied criteria are evaluated.
 * Unknown criteria do not receive points and reduce confidence; no AI or
 * inferred values are used. Candidate facts must already be E10-reviewed.
 */
export function scoreDiscoveryMatch({candidate={},criteria={},evidence=[],now=Date.now()}={}) {
  const instant=typeof now==="string"?Date.parse(now):Number(now);
  if(!Number.isFinite(instant)) throw new TypeError("E11 now must be a valid timestamp.");
  if(!criteria || typeof criteria!=="object" || Array.isArray(criteria))
    throw new TypeError("E11 workspace criteria must be an object.");
  const components=[];
  for(const key of CRITERIA){
    const rule=criteria[key];
    if(rule===undefined || rule===null) continue;
    const weight=typeof rule==="object" && !Array.isArray(rule) ? rule.weight ?? 1 : 1;
    if(!finite(weight)||weight<0) throw new TypeError(`E11 ${key} weight must be a non-negative number.`);
    if(weight===0) continue;
    const expected=typeof rule==="object" && !Array.isArray(rule) ? rule : {value:rule};
    const target=key==="evidence_freshness"
      ? {latestEvidenceAt:evidence.map(x=>x?.source_published_at||x?.sourcePublishedAt||x?.evidence_captured_at||x?.capturedAt)
          .filter(Boolean).sort((a,b)=>Date.parse(b)-Date.parse(a))[0]}
      : candidate[key];
    const wanted=key==="evidence_freshness"?expected:expected.value;
    const result=evaluateCriterion(key,target,wanted,instant);
    const required=Boolean(expected.required);
    components.push({
      criterion:key,weight,status:result.status,required,
      points:result.status==="match"?weight:0,
      reason:result.reason
    });
  }
  const totalWeight=components.reduce((sum,item)=>sum+item.weight,0);
  const earned=components.reduce((sum,item)=>sum+item.points,0);
  const knownWeight=components.filter(item=>item.status!=="unknown").reduce((sum,item)=>sum+item.weight,0);
  const score=totalWeight?Math.round(earned/totalWeight*10000)/100:0;
  const coverage=totalWeight?knownWeight/totalWeight:0;
  const evidenceCoverage=evidence.length?Math.min(1,evidence.filter(item=>
    item && (item.evidence_id||item.evidenceId) &&
    (item.source_id||item.sourceId) &&
    (item.source_published_at||item.sourcePublishedAt||item.evidence_captured_at||item.capturedAt)
  ).length/evidence.length):0;
  const confidence=Math.round(coverage*(0.5+0.5*evidenceCoverage)*10000)/10000;
  const blockers=components.filter(item=>item.required&&item.status==="mismatch").map(item=>item.criterion);
  const positives=components.filter(item=>item.status==="match").map(item=>({criterion:item.criterion,reason:item.reason}));
  const negatives=components.filter(item=>item.status==="mismatch").map(item=>({criterion:item.criterion,required:item.required,reason:item.reason}));
  const unknown=components.filter(item=>item.status==="unknown").map(item=>item.criterion);
  return {
    score,confidence,eligible:blockers.length===0&&components.length>0,
    totalWeight,earnedWeight:earned,components,positives,negatives,unknown,
    blockers,method:"deterministic_weighted_rules_v1",
    requiresHumanReview:true
  };
}
export const E11_MATCH_CRITERIA=CRITERIA;
