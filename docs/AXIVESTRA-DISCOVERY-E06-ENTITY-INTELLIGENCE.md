# AXIVESTRA E06 — Company & Entity Intelligence

**Status:** Engineering stage on \`feat/discovery-e06-entity-intelligence\`. It builds on the E05 extraction stage. No migration is applied to production, no worker is enabled, and no canonical entity is created until a company owner/admin reviews a candidate.

## Purpose and source contract

E06 consumes immutable, completed E05 extraction runs. It canonicalises organisation names, registry identifiers, aliases, jurisdictions and source-backed legal-entity relationships. Its output is a canonical entity proposal or a candidate link to an existing canonical entity, always tied to the E05 evidence snapshot.

The supplied AXIVESTRA discovery blueprint requires canonical company identity, exact registry identifiers, jurisdiction and legal entity relationships. It explicitly directs exact identifiers before fuzzy matching and prohibits automatic merges based only on fuzzy names.

E06 handles organisation/company identity only. People and professional-role intelligence remain E07; contact validation remains E08. Locations, property title, ownership, encumbrance, solvency and creditworthiness are not inferred by this stage.

## Matching order

1. Restrict the comparison set to active canonical organisations in the same jurisdiction.
2. Compare approved identifier tuples: \`(scheme, jurisdiction, normalized_value)\`.
3. Compare normalised legal names.
4. Compare owner-accepted aliases.
5. Generate bounded trigram-similarity suggestions for remaining names.

Legal-form suffix normalization (for example Pvt Ltd / Private Limited) is only a comparison aid. The original source name and its source locator remain preserved. Jurisdiction is never guessed; when it is missing, E06 does not compare the mention across jurisdictions.

Exact identifier collisions across multiple canonical entities are marked ambiguous. Fuzzy name matches are suggestions only. Every candidate has \`auto_link_permitted: false\` and \`human_review_required: true\`.

## Storage and review

- \`discovery_canonical_entities\`: stable, company-scoped canonical organisation identity, created only after owner/admin approval.
- \`discovery_entity_identifiers\`: scheme- and jurisdiction-scoped source-backed identifiers.
- \`discovery_entity_aliases\`: reviewed legal/trading/previous/source-observed names.
- \`discovery_entity_match_candidates\`: immutable E05 evidence reference, match tier, score, rationale and proposed identifier values.
- \`discovery_entity_assignments\`: reviewed link from an E05 mention to its canonical entity.
- \`discovery_entity_relationships\`: evidence-linked parent/subsidiary/holding/branch/affiliate/JV/successor relationship records; not inferred from a name alone.
- \`discovery_entity_review_events\`: append-only owner/admin decisions and audit receipts.
- \`discovery_entity_resolution_jobs\`: durable, bounded worker queue, enqueued after completed E05 runs with organisation mentions.

The worker can only produce pending candidates. The review RPC rechecks company membership, candidate state, evidence, jurisdiction and identifier conflicts. No candidate is silently promoted, and E05 extracted facts are never rewritten.

## Execution

Run in a secured server environment only:

\`\`\`sh
DISCOVERY_ENTITY_RESOLUTION_WORKER_ENABLED=true npm --prefix services/discovery-worker run start:entity-resolution
\`\`\`

Required server-only variables: \`SUPABASE_URL\` and \`SUPABASE_SERVICE_ROLE_KEY\`. The worker performs no external network calls and is disabled unless explicitly enabled. The database queue uses leases, heartbeats, capped retries and \`FOR UPDATE SKIP LOCKED\`.

## Validation

- Pure unit tests cover suffix normalization, jurisdiction boundaries, identifier scheme/value normalization, exact identifier precedence, alias/name matching, fuzzy ambiguity and person/location exclusion.
- PostgreSQL 16 integration verifies the E06 queue, company isolation, source/evidence linkage, candidate creation, owner/admin review, canonical entity creation, identifiers, assignments and audit receipts.
- E06 contract tests ensure E05 outputs remain immutable and no worker-side canonical entity creation is possible.
- Full discovery CI, worker tests, PostgreSQL integration, application regression, Edge Function type-check and web build must pass before this stage is called validated.

## Explicit exclusions

No search, crawl or provider activation is added. No sanctions dataset is bundled. OpenSanctions code/data licence distinctions remain as recorded in the 111-entry inventory; the free CC BY-NC dataset is not used for commercial screening. No private-person scraping, automated outreach, legal conclusion, loan/investment approval, ownership or title inference, auto-merge, production migration, merge to \`main\` or deployment is performed.
