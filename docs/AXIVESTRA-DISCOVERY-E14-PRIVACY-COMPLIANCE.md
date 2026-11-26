# AXIVESTRA E14 — Privacy & Compliance

**Branch:** `feat/discovery-e11-explainable-matching`  
**Stage:** policy register, privacy-request case management, scoped erasure and retention queue  
**Activation:** no scheduled worker or automatic erasure is enabled. Every request action and retention processing call requires an owner/admin actor.

## Audit findings and changes

E07 professional identities and E08 approved contact points already require a stated purpose and explicit `retention_until`. E04's existing retention worker removes private raw evidence only; it did not process expired professional identity or approved contact-point records. E14 adds a separate privacy retention queue and controlled processing path.

## Processing register

`discovery_privacy_processing_policies` records an owner/admin-reviewed data category, processing purpose, lawful-basis code/reference, maximum retention days, rationale, approval and policy review date. Expired records are only queued when the source record's purpose matches an active, in-date company policy.

## Privacy request workflow

Requests cover access, rectification, erasure, restriction, objection and portability. Intake stores the request classification, requester relationship and an optional keyed HMAC reference; it deliberately has no name, email, phone or identity-document fields.

The workflow is: owner/admin records request → identity verification → company-scoped subject references → per-subject action → completion with an immutable receipt. A request is not an erasure instruction until verified and explicitly approved. Rectification is represented as a new source-backed record rather than rewriting immutable evidence.

## Erasure and minimisation

E14 can restrict or erase approved contact points and professional identity records, as well as the associated E05 extracted person/entity/fact records. When a professional identity is erased, linked contact points are erased and role assignments/review records lose their person link while non-identifying role history remains. Encrypted contact-candidate payloads and linked extracted contact facts are erased; immutable E08 validation receipts retain only a non-identifying subject-erasure marker with both subject references detached.

E13's append-only provenance receipts remain as non-content lineage metadata (stable IDs, source/evidence references, hashes and structural locators). E14 adds separate immutable privacy events so an authorised reviewer can see that a data subject action occurred. Raw evidence retention remains governed by E04.

## Expiry queue

An owner/admin can queue expired E07/E08 records with `enqueue_expired_discovery_personal_data`, then explicitly process a bounded batch with `process_discovery_privacy_retention_queue`. No background worker is started, no company policy is auto-created, and no records are deleted by this migration.

## Boundaries

The E14 implementation is request intake, verification, subject scoping, restriction/erasure and expiry processing. It does not yet provide a user-facing DSAR portal, document-identity verification provider, automated legal-basis assessment, portable export package builder, or a cross-jurisdiction legal rules engine. Those require separate review and interface work; this stage does not assert legal compliance merely because controls exist.

## Verification

Contract tests cover owner/admin permissions, identity-verification gating, subject-company scoping, immutable events, minimisation-aware erasure, policy-matched retention and service-role-only RPC execution. PostgreSQL integration tests exercise request verification, scoped erasure, retention queueing, expiry processing and the preservation of E07 role history/E13 provenance.
