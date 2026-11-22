# AXIVESTRA E12 — Deduplication & Relationship Graph

**Implementation:** feat/discovery-e11-explainable-matching  
**Stage:** deterministic duplicate candidate engine and reviewed graph read model implemented; CI verification pending.  
**Activation:** candidate generation is an explicit server-side RPC; no background worker or automatic merge is enabled.

## Matrix scope

E12 covers duplicate organizations, professional people and contact points while preserving source-specific record identifiers and explicit legal-group relationships.

## Duplicate rules

- Organizations: exact same registry scheme/value/jurisdiction, exact normalized legal name within the same jurisdiction, or the same owner-reviewed alias within the same jurisdiction.
- Professional people: exact normalized name, same owner-reviewed employer and same role, with overlapping role dates.
- Contact points: identical keyed HMAC fingerprint and contact type attached to the same owner record. Contact values and fingerprints are never returned in candidate payloads.
- Fuzzy-name similarity is not used to merge records. E06 can still provide fuzzy review suggestions, but E12 does not treat them as identity proof.
- Every candidate retains both original record IDs and evidence/reference IDs. Candidate generation is idempotent and company-scoped.

## Review and graph boundaries

- Candidate generation writes suggestions only. It does not rewrite references, delete records, change canonical identity, or merge entities.
- Only a company owner/admin can record confirmed_duplicate, not_duplicate or escalated, with a mandatory reason and immutable review receipt.
- A confirmed_duplicate decision records the human conclusion only; an actual merge is deliberately not executed in E12 because it requires a separate migration/impact review across all dependent records.
- discovery_entity_graph_nodes exposes active canonical organizations to company members.
- discovery_entity_graph_edges exposes only owner_accepted E06 legal-group relationships. needs_verification and rejected links are not graph edges. No transitive relationship is inferred.
- No third-party service, AI model, provider or network call is used.

## Verification

deduplication.test.mjs covers exact jurisdiction-scoped company matches, registry identifiers, aliases, professional-role overlap, contact fingerprint privacy, no automatic merge, and bounded results. The SQL contract test checks company scope, owner/admin review, immutable receipts and accepted-edge graph semantics.

## Not yet complete

The E12 RPC is not yet wired to an automatic queue/worker or review UI. Merge execution, cross-workspace relationship presentation, full Postgres runtime migration test and production activation remain pending. Do not treat candidate generation as active until the server explicitly invokes the RPC under its authenticated company scope.


## Queue and worker integration (E12.1)

- Reviewed canonical entities, identifiers, aliases, professional records/assignments and active contact points enqueue one coalesced job per company.
- A change arriving during a running pass requests one rerun instead of creating concurrent duplicate jobs.
- A dedicated leased worker performs idempotent database candidate generation. It makes no external network calls.
- Claims, heartbeats and completion require the existing one-hour owner/admin company worker grant. No grant is created by this migration.
- The worker is opt-in through DISCOVERY_DEDUPLICATION_WORKER_ENABLED=true and remains disabled by default.
- Human review remains owner/admin-only. A confirmed duplicate still does not merge, rewrite or delete records.
- PostgreSQL tests cover enqueue, claim, concurrent-change rerun, idempotent rerun and kill-switch rejection.
