# AXIVESTRA E16 — Canonical Deal-Party Relationships

**Stage:** Gate 1 foundation → Gate 2 relationship intelligence  
**Migration:** `20261122310000_axivestra_deal_party_relationships.sql`  
**Status:** Additive backend foundation; not yet wired into every workspace editor or local/device sync.

## Purpose

AXIVESTRA previously stored most deal and counterparty links inside flexible record payloads. The relationship-intelligence view could read explicit contact IDs, but there was no normalized, transaction-specific party table. E16 introduces that stable link layer without rewriting legacy records.

## Data model

- `company_deal_parties` links an existing company-scoped `property` workspace record (deal/asset record) to an existing `contact` record by stable record keys.
- Each link has a transaction-specific role (buyer, seller, borrower, lender, guarantor, investor, owner, advisor, broker, tenant, developer, advocate, mediator, introducer, etc.).
- Responsibility, authority scope, effective dates, verification state and optional evidence metadata are stored on the relationship, not inferred from a person's master contact role.
- Evidence-supported and verified states require a linked `document_metadata` record.
- Company-scoped composite foreign keys prevent a deal, party or evidence record from another company being attached.
- Relationship identity (company, deal, party, role and effective-from date) is immutable. Correct a relationship by ending its effective period and creating a new link; do not silently rewrite history.
- `company_deal_party_events` records creation and updates to verification/effective period. Event rows are append-only.
- Active party links prevent the linked deal/contact from being soft-deleted. Evidence used by an active verified relationship is also protected from soft deletion.

## Security and data integrity

- Company members can read their company's links and event history.
- Owner, admin, manager and staff roles can create/update links; read-only members cannot.
- The database stamps the authenticated actor, rejects missing membership, blocks hard deletion and preserves the original creator.
- RLS and least-privilege grants are applied to both tables.
- Deleted deal/contact/evidence metadata cannot be used to create or verify an active relationship.
- No fuzzy-name matching, automatic identity merge or external contact action is performed.

## Integration boundary

This migration is a backend foundation only. Existing local-first record payloads and all 16 workspaces remain unchanged. E16 does not yet backfill legacy `moduleData` fields, update the device-sync collections, or expose a production editor/API. Those require a separately tested, explicit migration/reconciliation and UI stage. No production migration was applied and no deployment was performed.

## Verification

The PostgreSQL integration fixture exercises:
- valid stable-ID link creation and server-stamped actor;
- evidence requirement for verified state;
- evidence attachment and effective-period update;
- protection against soft deletion of active deal, party and verification evidence;
- immutable role identity and append-only event history;
- rejection of read-only member writes and hard deletion;
- rejection of cross-company party references.

Contract tests cover role vocabulary, company scope, evidence requirements, immutable identity, event capture and additive migration boundaries.
