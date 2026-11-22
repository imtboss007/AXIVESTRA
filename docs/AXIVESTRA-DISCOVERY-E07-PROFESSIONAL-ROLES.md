# AXIVESTRA E07 — People & Decision-Maker Intelligence

**Status:** Engineering stage on \`feat/discovery-e07-professional-roles\`, based on E06. The worker is disabled by default. No production migration, external source activation, provider account, outreach or deployment is performed.

## Source contract

E07 follows the AXIVESTRA Lead & Customer Intelligence Matrix: it maps public professional roles to canonical companies only when necessary and lawfully sourced; minimises personal data; and stores role and evidence rather than scraped profiles.

Inputs are completed E05 extraction runs, source-backed person mentions and facts, and E06 owner-reviewed company assignments. The E07 worker does not search the internet or scrape professional profiles. It does not use LinkedIn scraping, guessed email patterns, phone discovery, social-profile enrichment or contact validation.

## Matching and association

A person-to-company association is accepted as a candidate only when:
1. A source-backed person mention exists in the completed E05 run.
2. A source-backed role/title fact exists for that person.
3. The employer is explicitly referenced by a source fact and resolves to an E06 owner-reviewed company assignment, or the source's employer name exactly matches one uniquely assigned canonical company.
4. The source, profile, evidence hash and company scope remain eligible.

No fuzzy person matching or fuzzy employer linking is performed. If employer identity is missing or ambiguous, the candidate remains \`insufficient_evidence\` and cannot be promoted.

## Data minimisation and review

- \`discovery_professional_role_candidates\`: source-backed role candidate, source span, evidence reference, confidence, missing requirements and review state.
- \`discovery_professional_people\`: minimal professional name record, created only after explicit company owner/admin review for a stated purpose.
- \`discovery_professional_role_assignments\`: reviewed role-to-company relationship and effective dates.
- \`discovery_professional_role_review_events\`: append-only decision and reviewer receipt.
- \`discovery_professional_role_jobs\`: bounded queue, leases, heartbeat, capped retries and source/profile rechecks.

No email, phone, home address, personal financial attributes, consent status, social profile or outreach fields are created in E07. Contact points and validation are reserved for E08. Discovery or public availability is not consent to contact.

## Execution

Server-side only, after source approval and an explicit operational decision:

\`\`\`sh
DISCOVERY_PROFESSIONAL_ROLE_WORKER_ENABLED=true npm --prefix services/discovery-worker run start:professional-roles
\`\`\`

Required server-only environment: \`SUPABASE_URL\` and \`SUPABASE_SERVICE_ROLE_KEY\`. The worker is disabled by default and performs no external network calls.

## Validation and exclusions

Unit tests cover role normalisation, exact reviewed-employer association, missing/ambiguous evidence, and absence of contact data. Contract tests cover source/profile gates, E06 assignment dependency, worker separation and owner/admin review. PostgreSQL integration applies the E07 migration.

This stage does not implement contact validation, contact discovery, automated outreach, person-level mass scraping, personal-loan lead harvesting, litigation-person enrichment, KYC, suitability decisions, legal conclusions or automated approval. Any later person-level processing must pass purpose, jurisdiction, source terms, privacy and retention review.
