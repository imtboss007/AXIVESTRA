# AXIVESTRA E22 — Advisory AI Matching

**Revised roadmap capability:** E12 AI Matching  
**Technical stage:** E22  
**Status:** advisory core, synthetic evaluation contract, durable company-scoped suggestion ledger and owner/admin review desk implemented on the feature branch. Real model-provider integration, production adjudication and authenticated browser acceptance remain disabled/pending.

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

It requires the caller to assert that candidate facts have already been reviewed and workspace criteria approved. It strips contact values, personal attributes, raw source text, document bodies, URLs, unapproved criterion keys and unknown structured fields. It forwards only allow-listed structured facts and metadata-only provenance references (evidence ID, source ID, optional content hash and source/capture timestamps). No raw evidence body is copied to a model request.

The request carries E11's deterministic score, confidence and eligibility state as context. It does not allow an AI suggestion to override an E11 blocker or make an ineligible match eligible.

## Provider boundary

A model adapter must be explicitly injected by a caller and set \`enabled: true\`. Without that explicit injection, \`requestAiMatchingSuggestion\` returns \`provider_disabled\` without invoking anything.

Before an enabled adapter is called, E22 rechecks the minimised request's SHA-256 integrity hash, the reviewed-input assertions, the criterion allow-list and the exact provenance-ID list. A caller cannot silently mutate the request after it has been built. Any returned value is treated as untrusted. E22 validates:
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

## Durable suggestion and review layer

The feature branch adds migration `20261123270000_axivestra_e22_ai_matching_review.sql` and the `DiscoveryAiMatchingReviewWorkspace` in the existing Discovery Sources workspace. The migration stores validated structured E22 outputs, provider/model identifiers, request hash, E11 match reference and evidence identifiers. It does not store raw source bodies or free-text model rationale.

Suggestions are company-scoped and visible through security-invoker inbox views. The service-role-only recording RPC validates request integrity, JSON object/array shapes, required non-null schema flags, recommendation, integer advisory score, allowed reason codes and evidence-ID membership. Every cited evidence ID must be a UUID that resolves to an E04 evidence row under the same company. Missing or malformed criterion/code/evidenceIds fields fail closed. Idempotency is scoped by company, E11 result, request hash and provider/model version. Direct table writes are denied.

Owner/admin review is performed through a separate RPC. Decisions are limited to `accepted_for_review`, `needs_more_evidence` and `rejected`, with a required reason. Other company roles have read-only access. Review events are append-only. The review desk is mounted in the existing Discovery Sources workspace. E22 review does not mutate E11 match results, canonical entities or lead records.

PostgreSQL integration coverage verifies suggestion persistence/idempotency, invalid fractional score rejection, rejection of unregistered or cross-company evidence IDs, rejection of rationale objects missing required criterion fields, owner/admin review, viewer denial, immutable history, least-privilege grants and unchanged E11 state. At branch head `f8170bb2876bf5bb51dca0056d380bb3a3cf7356`, all three GitHub Actions workflows passed: Discovery governance run `45419849920`, WhatsApp Hub run `45419848651` and Cloud Worker run `45419848654`. The Discovery workflow also listed all eight E18/E19/E21/E22 Playwright cases successfully. Authenticated browser acceptance was skipped because QA account/company and Supabase credentials are not configured; a successful workflow shell with this skip notice is not an authenticated browser pass.

## Remaining acceptance work

1. Complete the new E22 authenticated browser acceptance with a configured QA company account. The browser spec also supports an optional pre-seeded pending QA suggestion via `AXIVESTRA_E2E_E22_SUGGESTION_ID`; it validates review-form gating without submitting a decision.
2. Assemble a company-authorised, privacy-reviewed, adjudicated evaluation set with sufficient positive and negative examples.
3. Select and separately approve a lawful, supported, preferably self-hosted/open-source model/runtime only if a real provider integration is required. Keep provider execution disabled until explicit approval.
4. Run offline evaluations and segment error reviews; document false positives, false negatives, abstention and data-quality limitations.
5. Complete authenticated browser/security acceptance and verify no AI path can bypass E11 review or E15 lead controls.

The provider remains disabled. No production migration has been applied, no deployment/merge has occurred, and no queue, dispatch or provider activation is part of E22.
