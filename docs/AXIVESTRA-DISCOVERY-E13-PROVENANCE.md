# AXIVESTRA E13 — Evidence & Provenance Ledger

**Branch:** `feat/discovery-e11-explainable-matching`  
**Stage:** append-only provenance ledger and unified field-lineage read model  
**Activation:** migration only; no fetch source, external provider, worker or deployment is activated.

## Why E13 adds a ledger

E04 already stores immutable private evidence snapshots and immutable fetch events. E05 stores deterministic extraction runs, extracted entities, field facts and source spans. E06–E10 retain source/evidence identifiers, reviewed identity links, role/contact/location observations and source-by-source enrichment observations. E11 stores advisory match-score snapshots and E12 stores duplicate candidates plus immutable human review receipts. These structures remain authoritative; E13 does not create another raw evidence store or duplicate extracted values.

## Provenance event model

`discovery_provenance_events` adds append-only, company-scoped lineage events for:

- source registration/approval/pause/rejection events, original evidence capture and retention-purge receipts, extracted entity/field observations and extraction review decisions;
- canonical entity creation, entity assignments, identifiers, aliases and relationships;
- professional role candidates, assignments and owner/admin review;
- contact candidates and approved contact points (metadata only; no contact values or fingerprints);
- place candidates and location review;
- enrichment observations, observation review and both source sides of enrichment-conflict review; E11 match-score snapshots and E12 duplicate-candidate creation/review decisions;
- evidence retention-purge receipts.

Each event retains stable subject and origin IDs, source/evidence/extraction references, SHA-256 evidence content hash, captured/published timestamps, source name/domain/jurisdiction, attribution and licence snapshots, actor, timestamp and an allowlisted source locator. Evidence IDs deliberately have no foreign key so the ledger survives raw-evidence deletion. The company foreign key remains so company deletion cascades.

## Read model and privacy

`discovery_field_provenance` is a company-member-readable read model protected by the ledger's company RLS policy. It reports whether the raw evidence has a recorded retention-purge receipt. Source spans are allowlisted to structural locators (for example, HTML offsets or JSON pointers); arbitrary excerpt text is not copied.

The ledger does **not** copy extracted raw/normalized values, raw source bodies, storage object references, source URLs, email addresses, phone numbers, ciphertext or contact fingerprints. E10's existing source metadata snapshots are reused when source evidence has already expired.

## Integrity and retention

- Application roles receive no update/delete privilege on the ledger; updates are also blocked by a trigger.
- Insert capture is idempotent using company, origin table/record, event type and subject.
- Existing rows are backfilled at migration time; new source-backed rows are captured by insert triggers.
- Evidence-retention purge events are themselves recorded as provenance events. The read model then marks all field events tied to that evidence as no longer raw-retained while preserving the historical hash and citation metadata.
- No actual evidence blob is copied into or retained by the new ledger. Existing E04 retention policy remains authoritative.

## Verification

The E13 SQL contract test checks table/RLS/immutability, lineage event coverage, privacy boundaries, retention-aware status and the read model. PostgreSQL integration tests verify live trigger capture from evidence through extraction, E11 match scoring and E12 duplicate review, source hash/span snapshots, append-only behavior and lineage survival after evidence purge.
