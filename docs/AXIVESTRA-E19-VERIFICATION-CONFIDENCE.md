# AXIVESTRA technical E19 — Verification Confidence & Workflow

**Revised roadmap alias:** E13 — Verification Confidence and verification workflow  
**Depends on:** E05 extraction, E06 company identity, E07 professional roles, E08 contact validation, E09 geo resolution, E10 enrichment and technical E13 provenance ledger  
**Migration:** \`20261123110000_axivestra_verification_confidence.sql\`

## Purpose

Earlier stages already produced their own confidence values and review states. They did not provide a single cross-stage verification queue in which an owner/admin could inspect independent source lineage, classify supporting or contradicting evidence, record a reasoned verification decision and see a prior decision reopened when fresh provenance arrives.

E19 adds that workflow without replacing the authoritative stage-specific records.

## Implemented

- Cases are created from eligible source-backed technical E13 provenance subjects: extracted facts/entities, canonical company records, entity assignments/identifiers/aliases/relationships, professional-role candidates/assignments, approved contact points, place candidates and enrichment observations.
- Existing eligible provenance is backfilled. New eligible provenance automatically attaches to the corresponding company-scoped case.
- Evidence links reference the immutable provenance event and retain only its source ID, source name/domain snapshot, content hash, timestamps and event type. No raw source body, URL, extracted value, contact value, ciphertext or fingerprint is copied.
- Evidence can be classified as \`supporting\`, \`contradicting\` or \`context\`. Every classification requires an owner/admin and a reason.
- The inbox derives an explainable 0–100 confidence index from:
  - independent source-domain coverage (maximum contribution 50);
  - content-hash coverage (maximum contribution 30);
  - supporting-versus-contradicting evidence balance (maximum contribution 20).
- The confidence index is not a statistical probability, not a universal source-reliability score and not an automatic truth decision.
- Owner/admin reviewers can move a case through in-review, verified, partially verified, disputed, rejected or insufficient-evidence states with a mandatory reason.
- A verified decision requires supporting evidence, an index of at least 40 and more supporting than contradicting references. The reviewer remains accountable for the decision.
- New source-backed provenance reopens a previously resolved case to pending review and records an immutable event. A past verification therefore cannot silently remain final after new information arrives.
- Company members can read the verification inbox and history; only owners/admins can classify evidence and make verification decisions.
- The AXIVESTRA Discovery Sources workspace exposes the case inbox and evidence review controls.

## Deliberate boundaries

- E19 does not run a third-party verification provider, call an AI model or make network requests.
- It does not rewrite E05–E10 observations or their individual review states.
- It does not turn E08 syntax validation into mailbox reachability, phone activity or contact consent.
- It does not verify property title, ownership, encumbrance, legal rights, creditworthiness or investment suitability.
- It does not automatically accept a company, contact, location, enrichment fact, match or lead.
- E19 uses the E13 provenance ledger as its source of lineage; it is not a second evidence blob store.

## Validation

The E19 contract suite checks automatic case creation/backfill, evidence minimisation, the confidence formula, owner/admin gates, append-only history and reopen-on-new-evidence behaviour. The PostgreSQL integration suite applies the migration after E18 and tests the live trigger, evidence classification, verification decision, audit receipts, role rejection and case reopening.

A complete successful GitHub Actions governance run is required before E19 is called validated. No production migration, provider, worker or deployment is activated by this implementation.
