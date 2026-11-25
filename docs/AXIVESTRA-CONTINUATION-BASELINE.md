# AXIVESTRA — Master Continuation Baseline

**Checkpoint:** 25 November 2026  
**Repository:** https://github.com/imtboss007/AXIVESTRA  
**Integrated development branch:** `feat/discovery-e11-explainable-matching`  
**Current integrated head:** `83b73483f07a0ee9164fa271ae32dc52f52ca7a5`  
**Base branch:** `feat/discovery-e10-enrichment`  
**Production/default branch:** `main`

**Owner instruction:** When the user says **“Continue AXIVESTRA”**, refresh this file and the live GitHub PR/CI state, then resume at the first incomplete release gate. Do not restart the project, create another repository, repeat the 123-entry inventory, or ask the user to restate established decisions.

## 1. Product objective and engineering rules

Continue the existing AXIVESTRA asset, capital, lender/customer, company, evidence and relationship-intelligence application. Preserve the existing React 18/Vite, Supabase, Dexie/local-first, ECharts, TanStack, React Hook Form and Zod stack.

The product spans property, loans, ventures, equity, funds, investor relations, litigation, compliance, financial movements, evidence, tasks, contacts, relationships and discovery. Use the original 123-entry repository inventory as a screened source catalogue, not an instruction to install all 123 projects. The authoritative inventory reconciliation is in [AXIVESTRA-123-ENTRY-INVENTORY-RECONCILIATION.md](AXIVESTRA-123-ENTRY-INVENTORY-RECONCILIATION.md).

Operating rules:
- Existing repository only: `imtboss007/AXIVESTRA`; do not create another repository.
- Free/open-source-first. Reuse existing code/dependencies where possible; verify licence, maintenance, security and compatibility before adding anything.
- No duplicate graph libraries, queues, stores, crawlers or provider adapters.
- Keep credentials out of source, logs, prompts and chat.
- No merge to `main`, production deployment, production migration execution, live external provider call, worker dispatch, official WhatsApp send, public release or paid spend without explicit approval.
- Report PASS, FAIL, SKIPPED and BLOCKED separately. Green CI does not mean authenticated product acceptance is complete.

## 2. Active staged discovery PR chain

These are deliberately nested feature branches. The active path is #74 → #75 → #76 → #77 → #78 → #80 → #81 → #83 → #84 → #85 → #86 → #88.

| PR | Base branch | Head branch | Purpose | Live state |
|---|---|---|---|---|
| #74 | `feature/axivestra-enterprise-experience` | `feat/discovery-source-governance` | E02 source governance and connector contracts | Open, draft |
| #75 | `feat/discovery-source-governance` | `feat/discovery-bounded-execution` | E04 bounded execution controls | Open, draft |
| #76 | `feat/discovery-bounded-execution` | `feat/discovery-durable-queue` | E04.2 durable queue and shared quotas | Open, draft |
| #77 | `feat/discovery-durable-queue` | `feat/discovery-job-enqueue` | E04.3 guarded enqueue and queue history | Open, draft |
| #78 | `feat/discovery-job-enqueue` | `feat/discovery-e04-complete` | E04 governed crawler and fetch workers | Open, draft |
| #80 | `feat/discovery-e04-complete` | `feat/discovery-e05-complete` | E05 deterministic extraction and normalization | Open, draft |
| #81 | `feat/discovery-e05-complete` | `feat/discovery-e06-entity-intelligence` | E06 company/entity intelligence | Open, draft |
| #83 | `feat/discovery-e06-entity-intelligence` | `feat/discovery-e07-professional-roles` | E07 professional-role intelligence | Open, draft |
| #84 | `feat/discovery-e07-professional-roles` | `feat/discovery-e08-contact-validation` | E08 contact validation | Open, draft |
| #85 | `feat/discovery-e08-contact-validation` | `feat/discovery-e09-geo-resolution` | E09 geo/spatial resolution | Open, draft |
| #86 | `feat/discovery-e09-geo-resolution` | `feat/discovery-e10-enrichment` | E10 enrichment and attribute validation | Open, draft |
| #88 | `feat/discovery-e10-enrichment` | `feat/discovery-e11-explainable-matching` | E11 matching plus revised E05–E16 and E19–E22 capabilities | Open, draft; integrated review path |

Alternative branches that must not be merged together with the active path:
- #79 is an alternative E05 consolidation branch; #80 is the active E05 path.
- #82 is an alternative E07 public-people branch; #83 is the active E07 professional-roles path.
- #87 is an alternative E11 matching/scoring branch; #88 is the active E11/E16/E19–E22 path.

The base/head SHAs above were checked on 25 November 2026; refresh them before any future merge/rebase. Do not assume an open draft is ready to merge.

## 3. Superseded integration branches

- **PR #90 — public API provider bridge:** closed and squash-merged into the #88 feature branch, merge commit `366e40d37627040a229321f430dcff07bb54e661`. No merge to `main`.
- **PR #91 — E17 interactive relationship network:** closed as superseded after its unique visual changes were manually ported to #88. Shared discovery contract/test changes were already identical. The integrated version additionally escapes untrusted labels in HTML tooltips.
- **PR #89 — Theme Studio + module improvements:** closed as superseded after its Theme Studio, local theme preferences, workspace fields, stable-ID cross-workspace navigation, chart token changes and follow-up mirror repair were ported to #88.
- **PR #92 — combined API/relationship integration:** closed as superseded after all 18 changed paths were reconciled against #88. Its public API/provider files, docs, tests, worker/enrichment changes, DiscoveryJobQueue and E17 implementation are already present on #88. The remaining differences were stale branch-specific CI triggers, older package/test lists, and older graph/style versions.
- **PR #66 — focused follow-up mirror repair:** remains open against `main` as a separate narrower fix. #88 contains the more complete follow-up mirror repair from #89; leave #66 open until the mainline release strategy is explicitly decided.

Other older application/website PRs (#70–#73, #67–#68, #57–#61, etc.) are separate workstreams. Do not fold them into the discovery branch blindly; inspect their scope and current base before action.

## 4. Latest integrated implementation on #88

### Discovery and intelligence
- E01–E15: workspace profiles, source governance, search preview, governed fetch/evidence, deterministic extraction, company/person/contact/geo/enrichment, explainable matching, provenance, privacy, review and lead workflows.
- E16–E17: normalized deal-party links and company-scoped relationship graph based only on explicit stable record IDs.
- E18: commitments workflow.
- E19: verification confidence ledger and owner/admin decisions.
- E20: governed orchestration, approvals, queue mapping, retry/recovery and execution console. Dispatch is hard-disabled; no scheduler, duplicate queue or external worker activation.
- E21: evidence catalogue, evidence packs, review lifecycle and metadata-only approved export.
- E22: advisory AI matching, minimised request contract, durable suggestion ledger and owner/admin review. No model provider is configured or called.

### E17 interactive relationship network
- Uses the existing ECharts dependency; no D3/Cytoscape duplicate.
- Force-directed deal/contact network, explicit E16 relationship edges, verification-state styling, node selection and focus filtering.
- Node selection only filters the evidence/review cards; it does not write relationship state.
- Dynamic record labels are HTML-escaped before tooltip rendering.
- Detailed relationship cards remain the audit/review surface.

### E16.1 legacy relationship backfill
- Added migration: `supabase/migrations/20261125110000_axivestra_legacy_relationship_backfill.sql`.
- Added operator guide: `docs/AXIVESTRA-E16-LEGACY-LINK-BACKFILL.md`.
- Added contract test: `services/discovery-engine/tests/deal-party-backfill-contract.test.mjs`, included in `npm run test:discovery`.
- The migration only installs an owner/admin-only RPC. It does **not** run a backfill at migration time.
- `p_apply` defaults to false (dry run). Only explicit `primaryContactId`, `moduleData.__linkedContactIds` and `moduleData.__contact_*` IDs are considered; IDs must resolve to active contacts in the same company.
- It does not use names, phone numbers, email, fuzzy matching or follow-up-only IDs. Backfilled links are always unverified, idempotent and do not alter source payloads.
- The migration has passed PostgreSQL integration in CI but has **not** been deployed or executed against a production database. Any actual backfill requires separate deployment approval, a reviewed dry run and explicit owner/admin apply approval.

### App and workspace completion
- Theme Studio: nine presets plus custom, dark/light/system modes, HEX and colour-picker controls, live preview, apply/cancel/reset; preferences are local-device only.
- Expanded 16-workspace field coverage with 52 additive fields.
- Stable-ID cross-workspace links between module records, contacts, tasks, documents and financial records.
- Follow-up date-mirror repair prevents unrelated legacy dates from being overwritten or counted as duplicate assignments.
- Portfolio and module analytics charts use theme tokens.
- Device-sync reconciliation and deletion-protection tests remain in the regression suite.

### Public API catalogue and provider boundaries
- Catalogue includes India-relevant candidates and global candidates such as SearchPinCode, SEC EDGAR, OpenCorporates and OpenSanctions with distinct review/legal restrictions.
- data.gov.in provider bridge is code-only and disabled by default. It requires an exact approved resource URL, E02 source registration, private `DATA_GOV_IN_API_KEY` configuration and owner/admin approval.
- No data.gov.in key has been supplied or configured; no provider request has been made.
- SearXNG remains off until an approved endpoint and server-side configuration are supplied.
- OpenCorporates, OpenSanctions, SEC EDGAR and postal lookup entries are catalogue/review candidates, not activated adapters.

### External execution
- E20 dispatch remains disabled.
- Official WhatsApp Cloud sending and autonomous outreach remain disabled.
- No production migration, deployment or public release has occurred.

## 5. Latest integrated-head CI — 25 November 2026

Code-bearing integrated #88 head: `83b73483f07a0ee9164fa271ae32dc52f52ca7a5`. The subsequent CI/workflow-only branch commit is `523f085cd896d33acb97add31fb4b4d6817ea60f`.

| Workflow | Run | Result |
|---|---:|---|
| Discovery Governance | 45549606659 | **PASS** |
| WhatsApp Hub | 45549606740 | **PASS** |
| Cloud Worker | 45549606683 | **PASS** |

Verified Discovery Governance steps:
- Discovery policy/contract tests — passed, including E16.1 backfill and E17 tooltip safety contracts.
- Worker and PostgreSQL integration tests — passed, including migration application/integration.
- E05 deterministic parser benchmark — passed.
- Full regression suite — passed.
- Discovery Edge Function type-check — passed.
- AXIVESTRA web application build — passed.

Verified WhatsApp Hub steps:
- `npm test` — passed, including Theme Studio, module field coverage, cross-workspace navigation and device-sync tests.
- `npm run check` — passed.
- Hosted sender Docker image — passed.
- Electron WhatsApp service syntax — passed.
- Supabase invitation Edge Function type-check — passed.
- Company isolation, RBAC, secret-handling and visual-system contracts — passed.
- Web application build — passed.

Authenticated E18/E19/E21/E22 browser acceptance was **SKIPPED**, not passed, because the dedicated QA account/company, Supabase credentials and required fixtures are not configured. E18 also lacks its dedicated deal/party fixtures. This remains a release blocker.

These checks validate the integrated feature branch, not the production release or authenticated multi-user acceptance. Refresh CI before relying on these statuses.

## 6. Release blockers and next engineering sequence

1. **Authenticated QA:** create a dedicated non-production QA company/account and the E18 deal/party, E19, E21 provenance-event and E22 pending-suggestion fixtures. Store credentials only in private GitHub/Supabase secrets; never paste them into chat or source.
2. **Browser acceptance:** run authenticated E18/E19/E21/E22 browser acceptance, including owner/admin review, viewer denial, tenant isolation, immutable history, evidence pack lifecycle and metadata-only export. Do not describe fixture-gated tests as passed.
3. **E16 reconciliation:** after a separately approved deployment of E16.1, run a dry-run preview on a non-production company, review the candidate count/sample, then apply only with explicit owner/admin approval. Inspect the resulting E17 graph and verify links with existing document metadata.
4. **Device acceptance:** logic tests for bidirectional PC/Android sync and deletion protection pass. Actual paired Android/Windows device acceptance remains unverified; perform it on test devices before release.
5. **Platform builds:** the integrated web app build passes. The existing Windows/Android workflow now includes `feat/discovery-e11-explainable-matching` in its push filter, but no fresh Windows installer/Android APK run was surfaced in the current CI results. The earlier Theme Studio branch passed both builds; obtain a fresh integrated-head artifact build before release.
6. **Independent review:** complete security, privacy/retention, licence/provenance, tenant isolation and accessibility review.
7. Keep #88 and the staged discovery PR chain open/draft until authenticated acceptance and independent release review are complete. Do not merge to `main` or deploy without explicit approval.

## 7. Configuration blockers — do not invent credentials

Potential server-side settings, only after owner approval and exact source review:
- `DISCOVERY_SEARXNG_ENABLED`
- `DISCOVERY_SEARXNG_URL`
- optional `DISCOVERY_SEARXNG_BEARER_TOKEN`
- `DATA_GOV_IN_API_KEY`
- exact approved data.gov.in dataset/resource ID and E02 source registration

No API key or provider credentials have been supplied. Never ask the user to paste secrets into chat; use the appropriate private secret manager after explicit authorisation. Provider terms, licence, publisher, fields, purpose, quotas, freshness and retention must be reviewed before any external call.

## 8. Continuation command

When the user says **“Continue AXIVESTRA”**:
1. Read this file and the 123-entry inventory reconciliation.
2. Refresh PR #88, the staged #74–#86 chain, alternative branches and all current CI statuses from GitHub.
3. Resume at the first incomplete item in Section 6.
4. Continue on the existing feature branch/repository; preserve all safeguards.
5. Report exact files, commits, tests, PASS/FAIL/SKIPPED/BLOCKED results and remaining release blockers. Do not restart or ask for already documented requirements.
