# AXIVESTRA revised discovery roadmap — E05 to E16

**Purpose:** map the revised capability sequence onto the existing AXIVESTRA implementation without renumbering or rewriting historical migrations.

**Rule:** the E-numbers already used in committed migrations and stage documents are historical technical identifiers. The revised E05–E16 labels are capability-roadmap aliases. Where an alias points to an existing implementation with a different technical number, retain the technical number in code and use this crosswalk. New work takes the next unused technical stage number.

## Capability crosswalk

| Revised roadmap | Existing technical implementation | Assessment | Remaining work |
|---|---|---|---|
| E05 Extraction & Normalisation | Technical E05 — deterministic extraction | **Implemented foundation** | OCR for scanned PDFs is deliberately absent; parser/schema expansion is source-specific. End-to-end production activation is separate. |
| E06 Company Intelligence | Technical E06 — canonical entity intelligence | **Implemented foundation** | Live registry/source adapters and owner/admin operations are not activated; exact identifiers and jurisdiction remain required. |
| E07 People Intelligence | Technical E07 — professional role candidates and assignments | **Implemented, bounded** | It only resolves source-observed people/roles against reviewed companies; no broad profile search or private-person scraping. |
| E08 Contact Validation | Technical E08 — encrypted contact candidates, approved contact points and validation events | **Implemented, syntax-first** | Live Reacher/contracted provider checks, DNS/MX/SMTP reachability, real delivery/bounce event adapters and a complete operational review path remain pending. E05 raw-value-at-rest hardening before E08 encryption is also outstanding. |
| E09 Geo Intelligence | Technical E09 — address/coordinate normalisation and place candidates | **Implemented, bounded** | Map presentation, place-review integration across workspaces, parcel/cadastral resolution and routing/area context remain pending. Optional Photon is self-hosted and off by default. |
| E10 External Enrichment | Technical E10 — source-by-source attribute observations and conflict review | **Implemented foundation** | No independent external enrichment provider is connected or active. Provider-specific adapters require separate source/terms/purpose approvals. |
| E11 Evidence Management | Technical E04 raw evidence + technical E13 provenance ledger + **technical E21 evidence operations** | **Manager and pack workflow implemented; acceptance pending** | E21 adds an all-stage evidence catalogue, owner/admin evidence-pack curation and review, append-only activity receipts and an approved-only SHA-256 metadata/provenance export. Raw evidence stays in E04 and is never copied into the pack export. |
| E12 AI Matching | Technical E11 — deterministic explainable matching + **technical E22 advisory AI-matching core** | **Deterministic baseline and advisory/evaluation contracts implemented; provider and real-world validation deferred** | E22 adds an explicit opt-in model adapter contract (disabled by default), allow-listed/minimised inputs, strict evidence-bound suggestion validation, adjudicated evaluation metrics (FP/FN, precision/recall, abstention and business-segment checks), and immutable human-review constraints in the output contract. No provider is connected; no durable suggestion/review workspace exists yet; real adjudicated dataset, model performance, privacy/bias review and authenticated browser acceptance remain pending. |
| E13 Verification Confidence & workflow | Technical E19 — new cross-stage verification workflow | **Core CI/PostgreSQL acceptance passed; authenticated browser QA pending** | It opens cases from E13 provenance, links metadata-only evidence, computes a transparent confidence index, supports evidence classification and owner/admin decisions, and reopens cases when new provenance arrives. Core contract, PostgreSQL, regression, Edge Function type-check and build checks passed on the current accepted CI head. Authenticated browser acceptance remains pending the dedicated QA secrets and company fixture. |
| E14 Lead Management | Technical E15 — match review and lead pipeline | **Implemented foundation** | Match acceptance/rejection, company lead inbox, stage/priority/assignment/next-action history exist. External communications, underwriting and financial decisions are explicitly excluded. |
| E15 Audit & Governance | Technical E02 source governance + technical E13 provenance + technical E14 privacy controls + company RBAC/event histories | **Substantial controls implemented; governance experience partial** | A user-facing DSAR portal, identity-verification provider, portable export builder, cross-jurisdiction rules engine and scheduled retention/erasure automation are not complete. Current retention processing is explicit/manual. |
| E16 Agent Orchestration | Technical E20 — company-scoped orchestration control plane over existing E04–E12 stages | **Governed planning, source context and scoped worker lease foundation implemented; dispatch intentionally blocked** | Stage registry, workflow presets, dependency-linked plan steps, idempotent requests, owner/admin approval, OFF-by-default stage controls, append-only history and read-only preflight exist. E20.2 adds execution/lease schemas; E20.3 binds runs to a validated company profile, approved attached source, exact purpose and allow-listed fields with freshness checks. E20.4 adds short-lived company/stage-scoped worker identities, hashed credentials, bounded leases, heartbeat/release, expiry, pause/revocation and company-grant revocation propagation. Worker lease calls use a scoped-token Edge broker; the service-role key stays server-side and is never held by the worker process. Claim requires dispatch_permitted=true; preflight remains hard-coded false. No production adapter, dispatcher, queue bridge, retry engine or live execution is active. |

## Existing capabilities beyond the revised list

These are already implemented as separate technical stages and must not be lost while adopting the revised roadmap:

| Existing technical stage | Capability | Current boundary / pending items |
|---|---|---|
| E12 | Deterministic deduplication and legal-entity graph suggestions | Candidate generation, queue and owner/admin review exist. No automatic merges. Review UI, safe merge/impact workflow and broader cross-workspace presentation remain pending. |
| E16 | Canonical deal-party relationships | Additive company-scoped deal/contact relationship table, evidence requirements and append-only events. Backfill, local/device-sync integration and universal workspace editors remain pending. |
| E17 | Relationship graph intelligence | Explicit E16 graph projection, as-of query and Overview panel exist. It does not infer transitive or name-derived relationships; graph completeness depends on explicit legacy-link reconciliation. |
| E18 | Commitments and operational action workspace | Create/edit, due-state inbox, member assignment, E16 links, immutable history and explicit legacy task linking are implemented. Scheduler, recurring reminders, messaging and a live authenticated QA browser run remain pending. |

## Verification and activation policy

- “Implemented” means the schema/code/contract exists; it does **not** mean a source, worker, provider, production migration or deployment is active.
- E04–E10 worker processes remain disabled by default and require approved sources, explicit company grants and server-only secrets where specified.
- Confidence values are method-specific evidence indicators, not universal probabilities, and never automatically approve a company, contact, place, lead or transaction.
- All human verification, entity acceptance, matching review and lead workflow decisions remain role-gated and auditable.
- Never merge, deploy, apply a production migration, activate an external source/provider or enable a worker without the separate required approval.

## Remaining work package estimate

The current crosswalk contains approximately **12 major acceptance packages** for the full intended roadmap. This is a planning estimate, not a fixed release count; several packages can progress in parallel and some advanced capabilities can be deferred for an initial internal pilot.

| Package | Remaining acceptance scope |
|---|---|
| 1 | **E19 verification acceptance:** current-head CI, PostgreSQL governance migration and authenticated QA fixture. |
| 2 | **E20.4 worker identity and lease lifecycle acceptance:** verify scoped grants, hashed one-time credentials, atomic lease boundary, heartbeat/release, bounded expiry, immediate pause/revoke and company-grant revocation in PostgreSQL CI. No worker dispatch. |
| 3 | **E20.5 adapter and scheduler:** reviewed adapters and dependency-aware bridge to existing E04–E12 queues. |
| 4 | **E20.6 retry and recovery:** concurrency enforcement, retry/backoff, expired-lease recovery and cancellation/failure propagation. |
| 5 | **E20.7 execution acceptance:** operational console, end-to-end observability and authenticated security/worker QA. |
| 6 | **Revised E11 evidence operations:** technical E21 provides the all-stage manager, owner/admin evidence-pack review and SHA-256 metadata/provenance export; CI/PostgreSQL and authenticated browser acceptance remain to be completed. |
| 7 | **Revised E12 AI matching — technical E22:** advisory core and synthetic contract tests are implemented. Remaining: approved model/runtime adapter, privacy-reviewed adjudicated dataset, real false-positive/false-negative and segment evaluation, durable suggestion/review records and authenticated owner/admin workspace acceptance. |
| 8 | **Revised E15 governance experience:** DSAR portal, portable export, jurisdiction-aware rules and scheduled retention/erasure. |
| 9 | **Technical E12 deduplication UX:** review UI, safe merge-impact workflow and broader workspace presentation; no automatic merges. |
| 10 | **Technical E16 relationship completion:** legacy backfill, local/device sync and universal relationship editors. |
| 11 | **Technical E18 operational reminders:** scheduler, recurring reminders and delivery controls. |
| 12 | **E05/E06/E08/E09/E10 integration hardening:** raw-value-at-rest hardening, registry adapters, approved contact reachability, map/place workflow and independent enrichment sources. |

OCR, broad personal-profile discovery, autonomous outreach and automatic merging remain deliberately out of scope unless separately approved.

## Next implementation sequence

1. **Technical E19 — Verification Confidence & Workflow (revised E13):** core CI and PostgreSQL acceptance passed. Run authenticated browser acceptance when the dedicated QA account/company and Supabase secrets are configured.
2. **Technical E20 — Agent Orchestration (revised E16):** E20.1–E20.7 implementation is present; dispatch remains hard-disabled. Authenticated E18/E19 browser QA is still a release prerequisite.
3. **Revised E11 Evidence Management — technical E21:** all-stage evidence manager, evidence-pack curation/review and metadata/provenance export are implemented on the existing feature branch; complete CI/PostgreSQL and authenticated QA before release sign-off.
4. **Technical E22 — Revised E12 AI Matching:** advisory request/response contract and synthetic evaluation suite are implemented; provider activation, durable review workspace and real adjudicated evaluation remain gated. Continue with revised E15 governance UX and the remaining technical E12/E16/E18 packages. Do not merge, deploy or activate providers without separate approval.
