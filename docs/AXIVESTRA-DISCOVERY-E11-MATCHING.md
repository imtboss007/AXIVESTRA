# AXIVESTRA E11 — Matching & Explainable Scoring

**Status:** Deterministic scoring engine and an owner/admin-triggered, evidence-bound scoring workflow are staged on `feat/discovery-e11-explainable-matching`. It is not merged or deployed. No AI model, external scoring provider, production activation or deployment.

## Matrix scope

E11 scores fit against workspace-specific LENDER or CUSTOMER criteria: geography, type, sector, ticket, instrument, collateral, stage, mandate and evidence freshness. Ticket thresholds require an explicit three-letter currency code. Debt and equity instruments remain separate. It explains positive and negative factors. Output: match score components, rationale and confidence. The matrix directs business rules first; AI suggestions are optional and must be behind schema/evaluation. Priority: configurable and human-reviewable.

## Implemented

- Pure deterministic weighted rules; each workspace supplies its own criteria and weights.
- All nine deterministic criteria are supported. Ticket ranges are checked for overlap and matching currency; incomparable currencies remain unknown. Evidence freshness uses the newest available source publication/capture timestamp.
- Every criterion returns match, mismatch or unknown, a weighted component and an explanation.
- Missing facts remain unknown: they do not receive points and reduce confidence.
- Required criterion mismatches are explicit blockers; score and eligibility are separate.
- Positive factors, negative factors, unknown criteria, blockers, confidence and method version are returned together.
- Only configured matrix criteria are evaluated. No inferred facts, personal-profile scoring, external calls or AI scoring.
- Human review remains required; this score is decision support, not an approval, credit decision, valuation or legal conclusion.

## Input contract

`candidate` contains E10-reviewed candidate facts. `criteria` is workspace-owned configuration. For ordinary criteria use `{ value, weight, required? }`; for ticket use `{ value: { min?, max?, currencyCode }, weight, required? }` with a required three-letter currency code; for freshness use `{ maxAgeDays, weight, required? }`. `evidence` contains source/evidence IDs and publication or capture timestamps.

## Score and confidence

Score is the sum of weights for matching criteria divided by the total configured weight, expressed 0–100. Mismatches and unknowns earn zero. Confidence is weighted known-criteria coverage multiplied by a source-evidence coverage factor; it is not a probability of investment success. Required mismatches set `eligible=false` even if the numeric score remains high.

## Persisted review and activation boundary

E11 persists deterministic scores, criterion components and an audit receipt through a server-side owner/admin-only database function. The resulting match remains `pending_review`; the existing E15 review desk is still required before a lead is created. No automatic lead approval, investment execution, underwriting or outreach is introduced. The migration and Edge Function must be deployed to a non-production environment and tested before authenticated use. Production migration, source activation, worker activation, deployment and merge remain separately gated.

## Workspace profile and persisted scoring workflow

- Each of the 16 workspaces has separate LENDER and CUSTOMER profile defaults, target classes, required/preferred fields, source priorities and guardrails. Profile defaults do not invent match thresholds; `matchCriteria` starts empty until an owner/admin configures explicit values and weights.
- The supported criteria contract is `geography`, `type`, `sector`, `ticket`, `instrument`, `collateral`, `stage`, `mandate` and `evidence_freshness`. A configured ticket range must include `currencyCode` (ISO-style three-letter code), `min` and/or `max`, with non-negative finite bounds.
- The Discovery Intelligence Hub exposes an E11 scoring desk. It lists canonical organisations with owner-accepted E10 observations from sources attached to that exact profile and still approved for that profile's purpose. Pending/conflicting E10 observations do not enter the candidate snapshot.
- The shared deterministic matcher is used by both the Node test suite and the Supabase Edge Function. The score writer checks company owner/admin membership, profile scope, the exact stored criteria snapshot, active canonical entity and each accepted evidence/source reference before persisting.
- A score, factor components and an append-only audit receipt are saved atomically. Results preserve LENDER/CUSTOMER mode; a new score supersedes an earlier pending score for the same entity/workspace/mode without deleting history. The existing E15 review desk remains the human approval step before a lead is created.
- Personal Loan CUSTOMER and Litigation LENDER external discovery remain policy-restricted. Investor Relations LENDER is permitted only for an explicitly configured fund-finance workflow; investors remain distinct from debt lenders. No contact, outreach, lending approval, investment recommendation, legal conclusion or CRM lead is created by scoring.

## Activation boundary

This implementation is staged on the feature branch only. It needs the new migrations applied to a non-production test environment and the authenticated Edge Function deployed before an authenticated user can use it. E10 accepted observations, approved source registrations and enabled profiles are prerequisites. E03 SearXNG search remains optional and inactive unless its self-hosted endpoint and credentials are deliberately configured; E04/E05/E10 workers remain disabled by default and subject to their existing source and company permission gates. No production migration, source, worker, provider or deployment has been activated by this change.
