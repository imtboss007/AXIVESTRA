import { createHash } from "node:crypto";

export const E22_AI_MATCHING_POLICY = Object.freeze({
  version: "e22_advisory_matching_v1",
  outputSchema: "axivestra.ai-match-suggestion.v1",
  providerEnabledByDefault: false,
  automaticDecisionAllowed: false,
  canonicalMutationAllowed: false,
  leadPromotionAllowed: false,
  allowedCriteria: Object.freeze([
    "geography", "type", "ticket", "instrument", "collateral", "stage", "mandate"
  ]),
  allowedEvaluationSegments: Object.freeze(["geography", "industry", "workspace_type"])
});

const CRITERIA = new Set(E22_AI_MATCHING_POLICY.allowedCriteria);
const SEGMENTS = new Set(E22_AI_MATCHING_POLICY.allowedEvaluationSegments);
const RECOMMENDATIONS = new Set(["possible_match", "not_a_match", "insufficient_evidence"]);
const REASON_CODES = new Set(["aligned", "misaligned", "unknown", "needs_verification"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function shortString(value, limit = 120) {
  if (typeof value !== "string") return null;
  const clean = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  return clean && clean.length <= limit ? clean : null;
}
function safeScalar(value) {
  if (typeof value === "string") return shortString(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  return null;
}
function safeCriterionValue(value) {
  const scalar = safeScalar(value);
  if (scalar !== null) return scalar;
  if (Array.isArray(value)) {
    const items = value.slice(0, 20).map(safeScalar).filter(item => item !== null);
    return items.length ? [...new Set(items)] : null;
  }
  if (!isRecord(value)) return null;
  const result = {};
  for (const key of ["min", "max", "amount", "currency", "value"]) {
    if (value[key] === undefined) continue;
    const item = safeScalar(value[key]);
    if (item !== null) result[key] = item;
  }
  return Object.keys(result).length ? result : null;
}
function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
function canonicalJson(value) {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (isRecord(value)) {
    return "{" + Object.keys(value).sort().map(key =>
      JSON.stringify(key) + ":" + canonicalJson(value[key])
    ).join(",") + "}";
  }
  return JSON.stringify(value);
}
function assertValidRequest(request) {
  if (!isRecord(request) || request.schemaVersion !== E22_AI_MATCHING_POLICY.outputSchema) {
    throw new TypeError("E22 request schema is invalid.");
  }
  const { requestHash, evidenceIds, ...payload } = request;
  if (!Array.isArray(payload.provenance) || !Array.isArray(evidenceIds) ||
      !isRecord(payload.candidateFacts) || !isRecord(payload.workspaceCriteria) ||
      payload.reviewAssertions?.candidateFactsReviewed !== true ||
      payload.reviewAssertions?.workspaceCriteriaApproved !== true) {
    throw new TypeError("E22 request is missing approved inputs or provenance.");
  }
  if (Object.keys(payload.candidateFacts).some(key => !CRITERIA.has(key)) ||
      Object.keys(payload.workspaceCriteria).some(key => !CRITERIA.has(key))) {
    throw new TypeError("E22 request contains a criterion outside the approved allow-list.");
  }
  const provenanceIds = payload.provenance.map(item => item?.evidenceId);
  if (JSON.stringify(provenanceIds) !== JSON.stringify(evidenceIds)) {
    throw new TypeError("E22 request evidence IDs do not match its provenance list.");
  }
  if (typeof requestHash !== "string" || sha256(canonicalJson(payload)) !== requestHash) {
    throw new TypeError("E22 request integrity hash does not match its payload.");
  }
}

/**
 * Builds a deliberately small model input from reviewed, structured facts.
 * Raw source text, canonical URLs, contact data and personal attributes are
 * never forwarded. E11's deterministic score remains the authoritative base.
 */
export function buildAiMatchingRequest({
  candidate = {},
  criteria = {},
  evidence = [],
  deterministicResult,
  candidateFactsReviewed = false,
  workspaceCriteriaApproved = false,
  workspaceKey = "default"
} = {}) {
  if (!isRecord(candidate) || !isRecord(criteria) || !Array.isArray(evidence)) {
    throw new TypeError("E22 candidate, criteria and evidence have invalid shapes.");
  }
  if (candidateFactsReviewed !== true || workspaceCriteriaApproved !== true) {
    throw new TypeError("E22 requires reviewed candidate facts and approved workspace criteria.");
  }
  if (!isRecord(deterministicResult) ||
      deterministicResult.method !== "deterministic_weighted_rules_v1" ||
      !Number.isFinite(deterministicResult.score) ||
      deterministicResult.score < 0 || deterministicResult.score > 100) {
    throw new TypeError("E22 requires a valid E11 deterministic baseline.");
  }
  const facts = {};
  for (const key of E22_AI_MATCHING_POLICY.allowedCriteria) {
    if (candidate[key] === undefined) continue;
    const value = safeCriterionValue(candidate[key]);
    if (value !== null) facts[key] = value;
  }
  const workspaceCriteria = {};
  for (const key of Object.keys(criteria)) {
    if (!CRITERIA.has(key)) continue;
    const rule = isRecord(criteria[key]) ? criteria[key].value : criteria[key];
    const value = safeCriterionValue(rule);
    if (value !== null) workspaceCriteria[key] = value;
  }
  const provenance = evidence.slice(0, 30).flatMap(item => {
    if (!isRecord(item)) return [];
    const evidenceId = shortString(item.evidence_id || item.evidenceId, 80);
    const sourceId = shortString(item.source_id || item.sourceId, 80);
    if (!evidenceId || !sourceId) return [];
    const contentHash = shortString(item.content_hash || item.contentHash, 128);
    const publishedAt = shortString(item.source_published_at || item.sourcePublishedAt, 40);
    const capturedAt = shortString(item.evidence_captured_at || item.capturedAt, 40);
    return [{
      evidenceId,
      sourceId,
      ...(contentHash ? { contentHash } : {}),
      ...(publishedAt ? { publishedAt } : {}),
      ...(capturedAt ? { capturedAt } : {})
    }];
  });
  const request = {
    schemaVersion: E22_AI_MATCHING_POLICY.outputSchema,
    policyVersion: E22_AI_MATCHING_POLICY.version,
    purpose: "Advisory comparison of reviewed organization facts against workspace criteria.",
    reviewAssertions: {
      candidateFactsReviewed: true,
      workspaceCriteriaApproved: true
    },
    constraints: {
      advisoryOnly: true,
      neverApproveOrReject: true,
      neverCreateOrMergeEntities: true,
      neverPromoteLeads: true,
      citeOnlySuppliedEvidenceIds: true,
      missingFactsMustRemainUnknown: true
    },
    workspaceKey: shortString(workspaceKey, 100) || "default",
    candidateFacts: facts,
    workspaceCriteria,
    deterministicBaseline: {
      method: deterministicResult.method,
      score: deterministicResult.score,
      confidence: Number.isFinite(deterministicResult.confidence)
        ? Math.max(0, Math.min(1, deterministicResult.confidence)) : null,
      eligible: deterministicResult.eligible === true
    },
    provenance
  };
  const canonical = canonicalJson(request);
  return Object.freeze({
    ...request,
    requestHash: sha256(canonical),
    evidenceIds: Object.freeze(provenance.map(item => item.evidenceId))
  });
}

/** Validate an untrusted model response against the supplied request. */
export function validateAiMatchingSuggestion({ suggestion, request } = {}) {
  assertValidRequest(request);
  if (!isRecord(suggestion) || !RECOMMENDATIONS.has(suggestion.recommendation)) {
    throw new TypeError("E22 model recommendation is invalid.");
  }
  const score = suggestion.advisoryScore;
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    throw new TypeError("E22 advisoryScore must be an integer from 0 to 100.");
  }
  if (!Array.isArray(suggestion.reasons) || suggestion.reasons.length > 7) {
    throw new TypeError("E22 reasons must be a bounded array.");
  }
  const allowedEvidence = new Set(request.evidenceIds || []);
  const reasons = suggestion.reasons.map((item, index) => {
    if (!isRecord(item) || !CRITERIA.has(item.criterion) ||
        !REASON_CODES.has(item.code) || !Array.isArray(item.evidenceIds)) {
      throw new TypeError("E22 reason " + index + " has an invalid shape.");
    }
    const evidenceIds = [...new Set(item.evidenceIds)];
    if (evidenceIds.length > 10 || evidenceIds.some(id => !allowedEvidence.has(id))) {
      throw new TypeError("E22 reason " + index + " cites evidence outside the request.");
    }
    return Object.freeze({
      criterion: item.criterion,
      code: item.code,
      evidenceIds
    });
  });
  return Object.freeze({
    schemaVersion: E22_AI_MATCHING_POLICY.outputSchema,
    policyVersion: E22_AI_MATCHING_POLICY.version,
    requestHash: request.requestHash,
    recommendation: suggestion.recommendation,
    advisoryScore: score,
    scoreMeaning: "ordinal advisory score; not a probability or approval",
    reasons,
    requiresHumanReview: true,
    automaticDecisionAllowed: false,
    canonicalMutationAllowed: false,
    leadPromotionAllowed: false
  });
}

/**
 * Provider injection is explicit. No default provider, network client or
 * environment-variable activation exists in this module.
 */
export async function requestAiMatchingSuggestion({ adapter, request } = {}) {
  if (!adapter || adapter.enabled !== true || typeof adapter.propose !== "function") {
    return Object.freeze({
      status: "provider_disabled",
      policyVersion: E22_AI_MATCHING_POLICY.version,
      providerInvoked: false,
      automaticDecisionAllowed: false
    });
  }
  assertValidRequest(request);
  const raw = await adapter.propose(Object.freeze({
    requestHash: request?.requestHash,
    schemaVersion: request?.schemaVersion,
    candidateFacts: request?.candidateFacts,
    workspaceCriteria: request?.workspaceCriteria,
    deterministicBaseline: request?.deterministicBaseline,
    provenance: request?.provenance,
    constraints: request?.constraints
  }));
  const validated = validateAiMatchingSuggestion({ suggestion: raw, request });
  return Object.freeze({
    status: "suggestion_ready",
    providerInvoked: true,
    providerId: shortString(adapter.providerId, 80) || "unidentified-adapter",
    modelVersion: shortString(adapter.modelVersion, 120) || "unversioned",
    suggestion: validated,
    automaticDecisionAllowed: false
  });
}

function ratio(numerator, denominator) {
  return denominator ? Math.round((numerator / denominator) * 10000) / 10000 : null;
}
function emptyCounts() {
  return { truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0, abstained: 0 };
}
function scoreCounts(counts) {
  const { truePositive: tp, falsePositive: fp, trueNegative: tn, falseNegative: fn } = counts;
  const decided = tp + fp + tn + fn;
  const total = decided + counts.abstained;
  return {
    ...counts,
    adjudicated: total,
    decided,
    coverage: ratio(decided, total),
    precision: ratio(tp, tp + fp),
    recall: ratio(tp, tp + fn),
    falsePositiveRate: ratio(fp, fp + tn),
    falseNegativeRate: ratio(fn, fn + tp)
  };
}
function classify(recommendation) {
  if (recommendation === "possible_match") return "match";
  if (recommendation === "not_a_match") return "no_match";
  return "abstain";
}

/**
 * Evaluates only explicitly adjudicated examples. Abstentions are reported
 * separately, while false-positive/false-negative counts remain visible.
 * Segment analysis is limited to non-sensitive, business-relevant dimensions.
 */
export function evaluateAiMatching({ examples = [], minExamples = 30,
  maxFalsePositiveRate = 0.05, minRecall = 0.9, maxSegmentFprGap = 0.1 } = {}) {
  if (!Array.isArray(examples)) throw new TypeError("E22 examples must be an array.");
  if (!Number.isInteger(minExamples) || minExamples < 1) {
    throw new TypeError("E22 minExamples must be a positive integer.");
  }
  for (const [key, value] of Object.entries({ maxFalsePositiveRate, minRecall, maxSegmentFprGap })) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new TypeError("E22 " + key + " must be between zero and one.");
    }
  }
  const counts = emptyCounts();
  const segments = new Map();
  let excluded = 0;
  for (const example of examples) {
    if (!isRecord(example) || example.adjudicated !== true ||
        !["match", "no_match"].includes(example.label) ||
        !isRecord(example.suggestion) ||
        !RECOMMENDATIONS.has(example.suggestion.recommendation)) {
      excluded += 1;
      continue;
    }
    const actual = example.label;
    const predicted = classify(example.suggestion.recommendation);
    if (predicted === "abstain") counts.abstained += 1;
    else if (actual === "match" && predicted === "match") counts.truePositive += 1;
    else if (actual === "no_match" && predicted === "match") counts.falsePositive += 1;
    else if (actual === "no_match" && predicted === "no_match") counts.trueNegative += 1;
    else counts.falseNegative += 1;

    const segment = example.segment;
    if (isRecord(segment) && SEGMENTS.has(segment.dimension)) {
      const key = segment.dimension + ":" + (shortString(segment.value, 80) || "unknown");
      const bucket = segments.get(key) || { dimension: segment.dimension, value: shortString(segment.value, 80) || "unknown", ...emptyCounts() };
      if (predicted === "abstain") bucket.abstained += 1;
      else if (actual === "match" && predicted === "match") bucket.truePositive += 1;
      else if (actual === "no_match" && predicted === "match") bucket.falsePositive += 1;
      else if (actual === "no_match" && predicted === "no_match") bucket.trueNegative += 1;
      else bucket.falseNegative += 1;
      segments.set(key, bucket);
    }
  }
  const aggregate = scoreCounts(counts);
  const segmentMetrics = [...segments.values()].map(bucket => ({
    dimension: bucket.dimension,
    value: bucket.value,
    ...scoreCounts(bucket)
  })).sort((a, b) => (a.dimension + ":" + a.value).localeCompare(b.dimension + ":" + b.value));
  const fprs = segmentMetrics.map(item => item.falsePositiveRate).filter(value => value !== null);
  const segmentFprGap = fprs.length > 1 ? Math.round((Math.max(...fprs) - Math.min(...fprs)) * 10000) / 10000 : null;
  const gateReasons = [];
  if (aggregate.adjudicated < minExamples) gateReasons.push("insufficient_adjudicated_examples");
  if (aggregate.falsePositiveRate === null || aggregate.falsePositiveRate > maxFalsePositiveRate) gateReasons.push("false_positive_rate_outside_limit");
  if (aggregate.recall === null || aggregate.recall < minRecall) gateReasons.push("recall_below_limit");
  if (segmentFprGap !== null && segmentFprGap > maxSegmentFprGap) gateReasons.push("segment_false_positive_gap_outside_limit");
  return Object.freeze({
    policyVersion: E22_AI_MATCHING_POLICY.version,
    evaluationVersion: "e22_adjudicated_eval_v1",
    metrics: aggregate,
    excludedUnadjudicatedOrInvalid: excluded,
    segmentMetrics,
    segmentFalsePositiveRateGap: segmentFprGap,
    gate: {
      passed: gateReasons.length === 0,
      reasons: gateReasons,
      advisoryOnly: true,
      humanApprovalRequired: true,
      providerActivationAllowed: false,
      automaticDecisionAllowed: false,
      canonicalMutationAllowed: false
    }
  });
}
