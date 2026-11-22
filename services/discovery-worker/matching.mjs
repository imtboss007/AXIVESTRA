const CRITERIA = Object.freeze([
  "geography","type","ticket","instrument","collateral","stage","mandate","evidence_freshness"
]);
const clean = value => typeof value === "string"
  ? value.normalize("NFKC").trim().toLowerCase().replace(/\\s+/g," ")
  : value;
const finite = value => typeof value === "number" && Number.isFinite(value);
const asList = value => Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];

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
    if(result!==null) return {status:result?"match":"mismatch",reason:result?"Ticket range overlaps the workspace range.":"Ticket range does not overlap the workspace range."};
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
