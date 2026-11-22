# AXIVESTRA E11 — Matching & Explainable Scoring

**Status:** Deterministic scoring engine and review persistence are implemented on \`feat/discovery-e11-explainable-scoring\`, based on E10. This stage is not merged or deployed.

## Matrix scope

The Lead & Customer Intelligence Matrix defines E11 as a configurable fit score against workspace criteria: geography, type, ticket, instrument, collateral, stage, mandate and evidence freshness. The required output is match-score components, rationale and confidence. Its selected approach is AXIVESTRA business rules first; optional AI suggestions may only be considered behind a schema and evaluation gate. No validated external lead-fit model was evidenced in the matrix.

## Implemented

- \`scoreWorkspaceFit\` evaluates all eight matrix dimensions using versioned deterministic rules.
- \`scoreWorkspaceCandidates\` produces stable, deterministic ordering for a candidate batch.
- Workspace criteria use a versioned schema with explicit weights that sum to 100 and an adjustable minimum evidence-coverage threshold.
- Geography supports country/state/city allow-lists and country exclusions. Categorical type, instrument, collateral, stage and mandate rules support positive and excluded values.
- Ticket range matching requires the same three-letter currency. Currency conversion is never attempted.
- A dimension is assessed only when a source-backed candidate value and its matching source/evidence references are present **and the underlying observation/place evidence has been owner/admin accepted**. Pending, conflict-review or rejected inputs are treated as unknown. Missing values remain unknown, reduce coverage and confidence, and are not guessed.
- Evidence freshness uses the oldest publication/capture date among evidence used in the score. Stale inputs reduce the freshness component and overall confidence; future or invalid evidence dates are not silently accepted.
- Each component includes its weight, score, status, positive/negative/unknown factor, written rationale, source/evidence references and source confidence.
- Overall fit score is normalized over assessed dimensions only. Coverage makes the share of configured weight that was actually assessed explicit. Confidence combines source confidence, coverage and freshness; it is not a statistical probability.
- Scores remain \`pending_review\`. Owner/admin decisions are recorded with a compact immutable review snapshot and audit event.

## Data contract

Profile-specific match criteria are stored in the existing \`discovery_profiles.criteria\` JSON object. The engine validates schema version 1:

\`\`\`json
{
  "schemaVersion": 1,
  "minimumCoverage": 0.6,
  "weights": {
    "geography": 15, "type": 10, "ticket": 20, "instrument": 10,
    "collateral": 10, "stage": 10, "mandate": 10, "evidence_freshness": 15
  },
  "dimensions": {
    "geography": {"countries": ["IN"], "states": ["Karnataka"]},
    "type": {"anyOf": ["manufacturer"], "exclude": ["broker"]},
    "ticket": {"currency": "INR", "minimum": 5000000, "maximum": 50000000},
    "instrument": {"anyOf": ["secured term loan"]},
    "collateral": {"anyOf": ["commercial property"]},
    "stage": {"anyOf": ["growth"]},
    "mandate": {"anyOf": ["working capital"]},
    "evidence_freshness": {"maxAgeDays": 365}
  }
}
\`\`\`

Candidate input values are source-backed normalized facts. Each evidence entry identifies its dimension, source ID, evidence ID, source confidence, accepted review state, and publication/capture timestamp. No unsupported value is synthesized. `buildMatchScoreRecord` checks for a persisted company-scoped LENDER/CUSTOMER profile and an assigned canonical organization, then creates a database-ready record with stable SHA-256 hashes. Its candidate snapshot is an explicit allow-list projection of the configured fit dimensions and accepted evidence references; contact details and free-form notes are not copied. The calling server remains responsible for authorizing the profile/candidate read and checking tenant ownership before insertion.

## Storage and access

- \`discovery_match_scores\` stores criteria/candidate hashes, score state, components, rationale, evidence references and review state.
- \`discovery_match_review_events\` stores the reviewer decision, reason and score snapshot; \`discovery_audit_events\` receives a review event.
- Only the server/service role can write score records. Company members have read-only access under company RLS. Only owner/admin can submit review decisions through the server-side review RPC.
- No raw personal contact data is a scoring dimension. The engine is for organization/workspace fit, not person scoring.

## Boundaries

E11 does not determine creditworthiness, borrower risk, property title/ownership, asset valuation or investment suitability. A match score is not a probability, recommendation, approval or lending decision. It does not create contacts/leads, merge entities, send communications, or auto-approve a candidate. UI/workspace linking remains subject to E15 human review. Optional AI scoring is not connected in this stage.

## Validation

Unit tests cover all eight dimensions, positive/negative factors, exclusions, missing or unreviewed evidence, confidence/coverage, stale evidence, incompatible currency, criteria validation, deterministic ordering, and privacy-minimised persistence snapshots. The PostgreSQL integration suite applies the E11 migration and checks the resulting tables and review function. The full governance workflow also runs the regression suite and application build.
