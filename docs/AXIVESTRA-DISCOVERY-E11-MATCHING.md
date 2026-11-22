# AXIVESTRA E11 — Matching & Explainable Scoring

**Status:** Deterministic scoring engine implemented on `feat/discovery-e11-explainable-matching`, based on E10. No AI model, external scoring provider, production activation or deployment.

## Matrix scope

E11 scores fit against workspace criteria: geography, type, ticket, instrument, collateral, stage, mandate and evidence freshness. It explains positive and negative factors. Output: match score components, rationale and confidence. The matrix directs business rules first; AI suggestions are optional and must be behind schema/evaluation. Priority: configurable and human-reviewable.

## Implemented

- Pure deterministic weighted rules; each workspace supplies its own criteria and weights.
- All eight matrix criteria are supported. Ticket ranges are checked for overlap; evidence freshness uses the newest available source publication/capture timestamp.
- Every criterion returns match, mismatch or unknown, a weighted component and an explanation.
- Missing facts remain unknown: they do not receive points and reduce confidence.
- Required criterion mismatches are explicit blockers; score and eligibility are separate.
- Positive factors, negative factors, unknown criteria, blockers, confidence and method version are returned together.
- Only configured matrix criteria are evaluated. No inferred facts, personal-profile scoring, external calls or AI scoring.
- Human review remains required; this score is decision support, not an approval, credit decision, valuation or legal conclusion.

## Input contract

`candidate` contains E10-reviewed candidate facts. `criteria` is workspace-owned configuration. For ordinary criteria use `{ value, weight, required? }`; for ticket use `{ value: { min?, max? }, weight, required? }`; for freshness use `{ maxAgeDays, weight, required? }`. `evidence` contains source/evidence IDs and publication or capture timestamps.

## Score and confidence

Score is the sum of weights for matching criteria divided by the total configured weight, expressed 0–100. Mismatches and unknowns earn zero. Confidence is weighted known-criteria coverage multiplied by a source-evidence coverage factor; it is not a probability of investment success. Required mismatches set `eligible=false` even if the numeric score remains high.

## Not activated

No workspace database schema, scoring queue, AI provider, automatic lead approval or investment execution is introduced in this first E11 engine slice. Persisted review workflow remains an E15 gate; E16 should evaluate synthetic cases and false-match rates before any model suggestion is considered.
