# AXIVESTRA E21 — Evidence Manager, Review Packs and Export

**Revised capability alias:** E11 — Evidence Management  
**Depends on:** technical E04 immutable private evidence/fetch events and technical E13 append-only provenance.  
**Status:** implementation is committed on the existing feature branch; E21 contract tests, PostgreSQL integration, full regression and application build passed on current-head CI. Authenticated workspace/browser acceptance remains pending QA credentials/company fixtures.

## Purpose

E04 remains the only raw evidence store. E13 remains the all-stage, append-only provenance ledger. E21 adds the missing user-facing operations layer: browse source-backed citations from across the E04–E13 pipeline, curate them into a named evidence pack, submit the pack for owner/admin review, preserve every decision, and export a hash-stamped portable citation/provenance manifest.

E21 does not create a second evidence blob store or copy extracted values into a new table.

## Implemented surface

- Company-scoped candidate catalogue built from E13 provenance events that reference an E04 evidence ID.
- Stage/subject/field/source/capture metadata display, including source attribution, licence reference and source-span locator.
- Retention-aware citation state: raw evidence retained vs purged/unavailable, while the historical evidence ID and SHA-256 remain traceable.
- Evidence packs with title, intended purpose, draft/in-review/approved/rejected state, and item/event counts.
- Owner/admin-only pack creation, item inclusion/removal, submission, approval/rejection and reopening after rejection.
- One active inclusion per pack/provenance event; repeated inclusion is idempotent. Submitted packs are immutable through the curation functions.
- Append-only pack event history for create, item add/remove, submit, approve/reject, reopen and export.
- Approved-only JSON export with a SHA-256 manifest hash and a durable export receipt. The manifest contains pack/reviewer details, provenance IDs, subject/field metadata, source name/domain/jurisdiction, attribution/licence snapshots, content hashes, timestamps, allow-listed source spans and current raw-retention status.

## Privacy, permissions and retention

- All tables are company-scoped with RLS. Read access is through safe views; writes use authenticated, role-checked SECURITY DEFINER functions. Only owner/admin can curate, review or export.
- Event history is append-only. Pack items are soft-removed so the review history remains intact.
- No source URL, raw source body, extracted raw/normalized value, contact value/ciphertext/fingerprint, private storage object reference, credential or signed download URL is included in the pack catalogue or export manifest.
- The export is a citation/provenance manifest, **not a copy of raw evidence files**. The original private E04 object remains governed by its existing licence and retention rules. A citation whose raw evidence has been purged stays in the manifest with its historical content hash and `evidenceRetained=false`.
- No retention policy is extended by creating a pack, and E21 does not download, copy, restore or bypass a purged raw evidence object.

## Validation

The E21 contract test checks RLS, company scope, owner/admin function boundaries, draft-only curation, submission/review/reopen transitions, approved-only export and raw-data exclusions. Current-head PostgreSQL integration verifies idempotent evidence inclusion, viewer denial, submitted-pack immutability, owner approval, export receipt integrity, event immutability and retention-aware pack citations after E04 evidence purge. The discovery governance CI run also passed full regression, E05 benchmark, both discovery Edge Function type-checks and the AXIVESTRA application build. Authenticated browser acceptance remains a separate QA prerequisite until a configured QA account/company and Supabase credentials are available.

## Browser acceptance

A dedicated authenticated Playwright spec lives at `tests/browser/axivestra-evidence-pack-workspace.spec.ts`. It checks that the Discovery Sources screen exposes the company-scoped evidence catalogue and safe-export notice. With a dedicated eligible QA provenance-event UUID, it creates a new QA pack, adds one existing provenance citation, submits and approves the pack, downloads the metadata/provenance manifest and checks for the export receipt. It deliberately leaves the approved QA pack and immutable history in place; it does not alter or copy raw E04 evidence.

The spec runs once on desktop Chromium alongside E18/E19/E22 browser acceptance when the authenticated QA account/company and Supabase build credentials are configured. Optional test-time fixture: `AXIVESTRA_E2E_E21_PROVENANCE_EVENT_ID`. A successful CI job with absent QA credentials is a skip notice, not browser acceptance.

## Release boundary

This is an additive schema/UI/API implementation on the existing AXIVESTRA feature branch. It does not apply migrations to production, deploy the edge function, change source approvals, activate a fetch worker or change any E20 dispatch/queue gate.

---

## Current authenticated acceptance status — 26 November 2026

The authenticated browser workflow creates a disposable local Supabase stack and seeds a synthetic E13 provenance event with linked E04 evidence metadata. The seed script exports that provenance-event ID to the browser test. In the post-merge Discovery Governance run 45826453426, the authenticated E18–E22 browser job completed successfully. The E21 spec creates a QA evidence pack, includes the seeded citation, submits and approves the pack, downloads the metadata/provenance manifest, and verifies the export receipt and history. The approved synthetic QA pack is intentionally retained within the disposable CI stack, which is stopped after the run.

This does not copy or export real evidence, test a hosted company, apply a hosted migration or waive the separate independent security/privacy review.
