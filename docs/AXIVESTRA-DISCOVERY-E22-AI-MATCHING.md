# AXIVESTRA E22 — Advisory AI Matching

**Revised roadmap capability:** E12 AI Matching  
**Technical stage:** E22  
**Status:** advisory core and synthetic evaluation contract implemented; real model-provider integration and adjudicated production evaluation remain disabled/pending.

## Purpose

E22 adds a governed, model-agnostic advisory layer beside the existing deterministic E11 matcher. E11 remains the authoritative, explainable baseline. E22 may suggest that a candidate deserves closer review, but it cannot approve or reject a match, change a canonical entity, merge records, or promote a lead.

The implementation is in \`services/discovery-worker/ai-matching.mjs\`. It has no built-in provider SDK, network client, model download, environment-variable switch, worker, queue or automatic startup path.

## Data minimisation and evidence

The request builder accepts only the seven business criteria already used by E11:

- Geography
- Organization type
- Ticket range
- Instrument
- Collateral
- Stage
- Mandate

It strips contact values, personal attributes, raw source text, document bodies, URLs, unapproved criterion keys and unknown structured fields. It forwards only allow-listed structured facts and metadata-only provenance references (evidence ID, source ID, optional content hash and source/capture timestamps). No raw evidence body is copied to a model request.

The request carries E11's deterministic score, confidence and eligibility state as context. It does not allow an AI suggestion to override an E11 blocker or make an ineligible match eligible.

## Provider boundary

A model adapter must be explicitly injected by a caller and set \`enabled: true\`. Without that explicit injection, \`requestAiMatchingSuggestion\` returns \`provider_disabled\` without invoking anything.

Any returned value is treated as untrusted. E22 validates:
- the recommendation is one of \`possible_match\`, \`not_a_match\` or \`insufficient_evidence\`;
- the advisory score is an integer from 0 to 100 and is labelled ordinal, not a probability;
- rationale is expressed as allow-listed criteria and controlled reason codes;
- every evidence citation belongs to the request's supplied provenance IDs.

No model-generated free-text rationale is rendered or trusted. The output always declares human review required and all mutation/promotion permissions false.

## Evaluation and error measurement

\`evaluateAiMatching\` uses only examples explicitly marked \`adjudicated: true\` with a human label of \`match\` or \`no_match\`. It reports:
- true positives, false positives, true negatives and false negatives;
- precision, recall, false-positive rate and false-negative rate;
- coverage and abstentions;
- segment metrics for geography, industry and workspace type, with a segment false-positive-rate gap when measurable.

Unadjudicated or malformed examples are excluded and counted. Abstentions are reported separately; they are not silently counted as correct predictions. Default evaluation thresholds are at least 30 adjudicated examples, false-positive rate no greater than 5%, recall at least 90%, and segment false-positive-rate gap no greater than 10 percentage points.

A passed numeric evaluation gate is **not** permission to activate a provider or bypass human review. The evaluator always returns \`providerActivationAllowed: false\` and \`automaticDecisionAllowed: false\`. Real-world performance has not been measured because no provider is connected and no reviewed adjudication dataset is configured.

## Verification

The worker test suite includes E22 contract tests for:
- request minimisation and provenance binding;
- rejection of requests without a valid E11 baseline;
- disabled-by-default provider behaviour;
- strict model response validation and evidence-citation checking;
- confusion-matrix, false-positive/false-negative and abstention calculations;
- exclusion of unadjudicated examples and sensitive segment dimensions.

These tests use synthetic fixtures. They demonstrate contract behaviour, not model accuracy, production readiness or authenticated browser acceptance.

## Remaining acceptance work

1. Select and approve a lawful, supported, preferably self-hosted/open-source model and runtime; keep it disabled until the separate approval is given.
2. Assemble a company-authorised, privacy-reviewed, adjudicated evaluation set with sufficient positive and negative examples.
3. Run offline evaluations and segment error reviews; document false positives, false negatives, abstention and data-quality limitations.
4. Add durable company-scoped suggestion and review records plus an owner/admin review surface before any operational pilot.
5. Complete authenticated browser/security acceptance and verify no AI path can bypass existing E11 review or E15 lead controls.

No production migration, deployment, provider activation, queue activation, dispatch change or merge is part of E22.
