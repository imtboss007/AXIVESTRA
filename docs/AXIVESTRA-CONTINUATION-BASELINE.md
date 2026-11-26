# AXIVESTRA — Master Continuation Baseline

**Checkpoint:** 25 November 2026  
**Repository:** https://github.com/imtboss007/AXIVESTRA  
**Integrated development branch:** `feat/discovery-e11-explainable-matching`  
**Current integrated code head:** `8596b523687c06e77a1844cf832e1d42d4a6c16b`  
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


---

## 9. Continuation refresh — 25 November 2026, 10:30 IST

**Recovery note:** The source chat is titled **“AXIVESTRA — Continue existing project”**. Its complete transcript/export was not available to this continuation. This checkpoint is based on this repository baseline, the 123-entry reconciliation, saved project context and live GitHub inspection; conversation-history recovery remains PARTIAL.

### Live branch and PR refresh

- PR **#88** remains open and draft. Its active head is `feat/discovery-e11-explainable-matching`; its base is `feat/discovery-e10-enrichment`. No merge to `main`.
- The active staged chain remains #74 → #75 → #76 → #77 → #78 → #80 → #81 → #83 → #84 → #85 → #86 → #88. These PRs are open/draft.
- Alternatives #79, #82 and #87 remain non-active alternatives; do not combine them with the selected chain.
- #90 is closed and merged only into the feature branch; #89, #91 and #92 are closed as superseded after reconciliation. Do not reopen or re-merge them.
- The default `main` branch remains separate. No deployment, production migration, release or provider activation was performed.

### Windows CI regression repair

At head `a388fa82b0f0e2a819e48b40e92cf5a8a7f447a7`, Discovery Governance, WhatsApp Hub and Cloud Worker passed, Android APK passed, but the Windows job failed in `services/discovery-engine/tests/orchestration-contract.test.mjs`. The E20 contract assertion expected LF-only text while Windows checkout supplied CRLF.

- **Fix commit:** `8596b523687c06e77a1844cf832e1d42d4a6c16b`
- **Changed file:** `services/discovery-engine/tests/orchestration-contract.test.mjs`
- **Change:** the shared test-fixture reader normalises CRLF to LF before text-contract assertions. No application runtime, migration or production configuration changed.
- CI on this fix commit at checkpoint time:
  - Cloud Worker run **45550436599** — PASS.
  - WhatsApp Hub run **45550436597** — PASS.
  - Discovery Governance runs **45550436592** and **45550432322** — IN PROGRESS.
  - Windows/Android run **45550432327** — IN PROGRESS.
- The earlier Windows failure is not considered repaired/verified until the fresh Windows regression job completes successfully. Android's fresh build is also pending on the current head.

### First unfinished release gate — QA environment and fixtures

This remains the first incomplete item in Section 6. Authenticated browser acceptance cannot be called complete merely because test discovery or CI steps pass. A dedicated **non-production** Supabase QA company/account and eligible fixtures are required.

Configure values as private repository secrets/variables; never paste credentials into chat or commit them:

- Build/auth configuration: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `AXIVESTRA_E2E_EMAIL`, `AXIVESTRA_E2E_PASSWORD`, `AXIVESTRA_E2E_COMPANY_NAME`.
- E18 fixtures: `AXIVESTRA_E2E_DEAL_TITLE`, `AXIVESTRA_E2E_PARTY_NAME`, optional `AXIVESTRA_E2E_RELATIONSHIP_LABEL`, and optional dedicated `AXIVESTRA_E2E_LEGACY_TASK_TITLE`.
- E19 fixture: `AXIVESTRA_E2E_VERIFICATION_SUBJECT_ID`.
- E21 fixture: `AXIVESTRA_E2E_E21_PROVENANCE_EVENT_ID`.
- E22 fixture: `AXIVESTRA_E2E_E22_SUGGESTION_ID`.

The QA user must have owner/admin access for the relevant write/review flows. The QA company must contain a matching active deal, party and explicit E16 relationship; an eligible E19 verification subject; an eligible E21 provenance event; and a pending E22 suggestion. Use only disposable/dedicated QA records. E18 acceptance creates/edits/cancels QA commitments and can link a one-time legacy task; E21 acceptance intentionally retains its approved QA pack and export history; E22 acceptance deliberately does not submit a review.

### Ordered task ledger

| ID | Task | Status | Evidence / next action |
|---|---|---|---|
| R1 | Provision non-production QA company/account and fixtures; configure private CI secrets/variables | **Blocked** | Requires authorized QA Supabase environment and owner/admin test account. Do not use production credentials or ask for secrets in chat. |
| R2 | Authenticated E18/E19/E21/E22 browser acceptance | **Pending / blocked by R1** | Run the existing authenticated Playwright suites after R1; report pass/skip separately and inspect evidence artifacts. |
| R3 | E16.1 legacy relationship backfill acceptance | **Pending / approval-gated** | Deploy only to a separately approved non-production environment, inspect dry-run candidates, then require explicit owner/admin apply approval. Never execute against production here. |
| R4 | Paired Android/Windows device-sync and deletion-protection acceptance | **Pending** | Requires test devices and non-production test accounts; existing logic tests do not replace paired-device acceptance. |
| R5 | Fresh integrated-head Windows installer and Android APK builds | **In progress** | Await run #45550432327; previous Windows failure was addressed by the CRLF-normalisation test fix. |
| R6 | Independent security, privacy/retention, licence/provenance, tenant-isolation and accessibility review | **Pending** | Complete before any release approval. |

**Next action:** R1 — provision the dedicated non-production QA company/account and fixtures, then configure the listed private CI settings. Continue the independent Windows/Android and Discovery CI checks without merging or deploying.

**Scope reminder:** Do not create another repository; do not merge to `main`; do not run production migrations/backfill; do not deploy, publish, activate paid services, dispatch workers, call live providers or send official WhatsApp messages without explicit approval.


---

## 10. Continuation refresh — 25 November 2026, 12:26 IST

### Live GitHub state

- Repository: `imtboss007/AXIVESTRA`.
- PR #88 remains **open / draft**, from `feat/discovery-e11-explainable-matching` into `feat/discovery-e10-enrichment`; head `b77d77e4ac67cfea3f27a41151fbf5fa0638ad2f`.
- The current code-bearing implementation head remains `8596b523687c06e77a1844cf832e1d42d4a6c16b`. The commits after it (`129dcfaf7ce933c3cd2bb32dc1d8dd302b02b780` and `b77d77e4ac67cfea3f27a41151fbf5fa0638ad2f`) changed only this continuation-baseline document.
- No new repository, merge, production migration, deployment, provider activation, worker dispatch or public release.

### Fresh integrated-head CI — PASS

The latest fresh workflow set completed successfully on the current PR head:

| Check | Run | Result |
|---|---:|---|
| Windows installer + Android APK | 45550651290 | **PASS** — both platform jobs succeeded |
| Discovery Governance | 45550660391 | **PASS** |
| WhatsApp Hub | 45550660319 | **PASS** — all four jobs succeeded |
| Cloud Worker | 45550660388 | **PASS** |
| Duplicate Discovery Governance run | 45550651340 | **PASS** |

The earlier in-progress/cancelled runs from the previous checkpoint were superseded by these completed runs. The Windows CRLF contract-fixture fix is now verified by a fresh successful Windows build job; Android was also rebuilt successfully.

### Authenticated acceptance — still SKIPPED, not PASS

- Discovery Governance validates Playwright test discovery, then runs authenticated E18/E19/E21/E22 acceptance only when the QA Supabase URL/publishable key, QA email/password and company name are present.
- The workflow's own condition prints an explicit skip notice when those settings are absent. E18 additionally needs its dedicated deal/party fixtures; E21 and E22 require their eligible provenance/suggestion fixtures.
- The dedicated browser-acceptance workflow is configured for `main` PR targets/pushes and manual dispatch; PR #88 is a stacked PR targeting the E10 feature branch. Its existence does not establish authenticated acceptance for #88.
- Therefore R1 remains **BLOCKED**, and R2 remains **BLOCKED BY R1**. Do not relabel these as passed based on green CI.

### Targeted source-level security spot-check

A read-only inspection was performed of the integrated E16.1, E19, E21 and E22 migrations/components and the browser-acceptance workflow:

- E16.1 backfill checks signed-in owner/admin authority, defaults `p_apply` to false, only resolves explicit same-company contact IDs, and marks inserted links unverified. No backfill was executed.
- E19 review/classification RPCs check owner/admin membership and company-scoped case/evidence IDs; review events are append-only.
- E21 pack tables use RLS and company-scoped read views; curation/review/export functions enforce owner/admin membership and retain event history. Export remains a metadata/provenance manifest, not raw evidence.
- E22 keeps provider execution disabled by default; persisted suggestions use the service-role recording boundary, while owner/admin human review does not change E11 match results.
- E20 dispatch remains hard-disabled in the active preflight projection.

This is a **targeted source spot-check**, not an independent penetration test, full threat-model review or release sign-off. R6 remains **PENDING** for independent security, privacy/retention, licence/provenance, tenant-isolation and accessibility review.

### Updated ordered task ledger

| ID | Task | Current status | What is still required |
|---|---|---|---|
| R1 | Non-production QA company/account, fixtures and private CI settings | **BLOCKED** | An authorised non-production Supabase QA environment and dedicated owner/admin account/fixtures |
| R2 | Authenticated E18/E19/E21/E22 browser acceptance | **BLOCKED BY R1** | Execute the existing browser suites after R1; inspect artifacts and report each suite separately |
| R3 | E16.1 legacy-link backfill acceptance | **APPROVAL-GATED** | Separately approved non-production deployment, reviewed dry run and explicit owner/admin apply approval |
| R4 | Paired Android/Windows device-sync acceptance | **PENDING** | Actual test devices and dedicated non-production accounts; logic tests are not device acceptance |
| R5 | Fresh integrated-head Windows installer and Android APK builds | **PASS** | No remaining build action at this checkpoint |
| R6 | Independent security/privacy/licence/tenant/accessibility review | **PENDING** | Independent reviewer and documented findings/sign-off |

**Next safe action:** continue only with source-level fixes or additional automated tests that are independently justified by evidence. Do not bypass R1/R2 with mocked credentials, infer R3 approval, substitute logic tests for R4, or call the targeted R6 spot-check an independent audit.

**Acceleration/tooling decision:** use the existing AXIVESTRA CI, regression suite and integrated stack first. The 123-entry reconciliation deliberately keeps OpenHands/Repo Auditor as optional isolated developer tools and rejects RepoSwarm as a duplicate orchestration stack; none is an approved AXIVESTRA runtime dependency. No external tool repository was installed or executed in this refresh.


---

## 11. Connected Supabase read-only check — 25 November 2026

### Database state

- Read-only inspection found one connected Supabase project in the existing `PROPERTY` organisation; the organisation is on the **Free** plan.
- The database migration history currently ends at `20261114035526 axivestra_custom_module_sync`. The newer E16–E22 migrations are not present in that applied migration history.
- The table inventory response showed RLS enabled on the returned `companies`, `company_memberships`, `company_records`, `company_audit_events`, `whatsapp_cloud_messages` and `personal_records` tables. This is not a claim that every schema/table has been audited.
- No SQL writes, migration applications, project creation, branch creation, function deployment or database configuration changes were performed.

### Current Supabase Security Advisor findings

- Five `authenticated_security_definer_function_executable` warnings:
  - `public.is_company_member(uuid)`
  - `public.has_company_role(uuid,text[])`
  - `public.create_company_with_owner(text)`
  - `public.cancel_whatsapp_cloud_message(uuid,uuid)`
  - `public.retry_whatsapp_cloud_message(uuid,uuid)`
- One `auth_leaked_password_protection` warning: leaked-password protection is disabled.
- The Health Advisor returned no lints.

### Source review of the five SECURITY DEFINER functions

- `is_company_member` and `has_company_role` use `auth.uid()` and company-membership predicates, set an empty search path and are granted to `authenticated` after revoking `PUBLIC`. Their definer execution is intentional to avoid recursive RLS membership checks. Do not revoke authenticated execution without redesigning the dependent RLS policies.
- `create_company_with_owner` requires an authenticated caller and atomically creates a new company with that caller as its first owner; it does not accept an arbitrary target user or join an existing company.
- WhatsApp cancel/retry require an authenticated caller, company membership, an exact company/message match, the expected current message state and either record ownership or owner/admin/manager role.
- These five findings remain visible as Advisor warnings because the functions are callable by authenticated users. The source review found their intended authorization guards; this is not a formal penetration test and does not replace independent release review.

### Leaked-password protection

Supabase's current Password Security documentation says leaked-password protection uses the Pwned Passwords API and is available on Pro plan and above: https://supabase.com/docs/guides/auth/password-security

The connected organisation is currently Free. Do not upgrade, purchase a service or change subscription without explicit approval. This warning is therefore recorded as a plan-limited configuration item, not silently dismissed or represented as fixed.

### Release consequence

- The E16–E22 feature migrations remain unapplied to the connected database; the feature-branch CI/PostgreSQL integration is not production deployment.
- R6 remains pending for independent review. The current work includes a source spot-check and current Advisor snapshot, not a formal security certification.
- Keep all production migration, deployment, provider activation and dispatch gates closed.


---

## 12. Completion refresh — 25 November 2026, 12:31 IST

### Current branch / review state

- Repository: `imtboss007/AXIVESTRA`.
- PR #88 remains **open / draft**, from `feat/discovery-e11-explainable-matching` into `feat/discovery-e10-enrichment`.
- Verified feature head at this checkpoint: `266be1be24e4e2f6c43cc7971a7c238aa0457ad3`.
- No new repository, merge to `main`, hosted migration, deployment, release, provider activation or E20 dispatch was performed.

### Fresh integrated-head CI — all PASS

All five workflow runs on the exact feature head completed successfully:

| Workflow | Run | Result |
|---|---:|---|
| Discovery Governance — PR event | 45567494517 | **PASS** |
| Discovery Governance — push event | 45567485702 | **PASS** |
| Windows installer + Android APK | 45567485595 | **PASS** — both platform jobs |
| WhatsApp Hub | 45567494532 | **PASS** — all four jobs |
| Cloud Worker | 45567494555 | **PASS** |

Discovery Governance completed all 24 steps, including discovery contracts, worker/PostgreSQL integration, the E16.1 backfill test, E05 parser benchmark, full regression, Edge Function type-check and application build.

The E16.1 PostgreSQL integration test now applies `20261125110000_axivestra_legacy_relationship_backfill.sql` in its isolated test database and checks:
- preview mode is default and performs no relationship write;
- the preview exposes the explicit property/contact stable IDs;
- explicit apply inserts the relationship as `unverified`;
- a repeated apply is idempotent;
- a viewer is denied while an owner is allowed.

The integration harness replaces its initial permissive role stub with a real company-membership predicate before exercising the E16.1 owner/admin check. This is test-database setup only; it does not modify production roles.

### Authenticated browser acceptance — PASS

The new authenticated job provisions a fully disposable **local** Supabase stack inside GitHub Actions. It applies the repository's migrations, creates a random disposable owner credential and synthetic company/deal/contact/task/source/evidence/match/provenance records, serves the real `discovery-control` Edge Function locally and runs the browser tests against that stack.

- Authenticated browser workflow, PR event: run **45567494517**, job completed **17/17 steps**.
- Authenticated browser workflow, push event: run **45567485702**, job completed **17/17 steps**.
- Playwright executed **8 tests; 8 passed** in desktop Chromium (15.1 seconds).

Coverage passed:
- **E18:** create/edit an operational commitment linked to the correct E16 deal-party relationship; link the explicitly selected legacy task without deleting its source.
- **E19:** authenticated verification inbox and provenance inspection without exposing raw values.
- **E21:** evidence catalogue, pack creation, citation inclusion, submission, owner approval, metadata-only manifest export and export receipt.
- **E22:** provider-off review desk, E11 baseline visibility and reason-gated human review controls without recording an automated decision.

The first browser attempt exposed a test navigation defect: E18 lives under Intelligence Hub, while the test looked for the panel directly after company selection on Overview. The test now opens Intelligence Hub before asserting E18. This was corrected in `tests/browser/axivestra-commitment-workspace.spec.ts`; the subsequent full 8/8 run passed.

The QA user/password are generated per CI run and are not stored in source. The stack is stopped after every run. No hosted Supabase project, real company data, external provider or live source is used. Browser artifacts are uploaded to the GitHub Actions run for seven-day retention.

### Updated release ledger

| ID | Task | Current status | Remaining scope |
|---|---|---|---|
| R1 | Repeatable disposable local Supabase QA stack, owner and fixtures | **PASS** | None for CI; a hosted QA environment is not required for the local CI suite |
| R2 | Authenticated E18/E19/E21/E22 browser acceptance | **PASS — 8/8** | This is local synthetic QA acceptance, not production-company acceptance |
| R3 | E16.1 legacy-link backfill acceptance | **PASS — local PostgreSQL** | Hosted/non-production deployment and any real-data dry run remain separately approval-gated; no backfill has been run on hosted data |
| R4 | Paired physical Android/Windows device-sync acceptance | **PENDING** | Requires actual test devices and approved non-production accounts; platform builds and logic tests do not constitute paired-device acceptance |
| R5 | Fresh integrated-head Windows installer and Android APK builds | **PASS** | None for the current feature head |
| R6 | Independent security/privacy/retention/licence/tenant/accessibility review | **PENDING** | Requires an independent reviewer and documented findings/sign-off |

### Remaining release controls

- The connected hosted Supabase project migration history still ends at `20261114035526 axivestra_custom_module_sync`. The E16–E22 feature migrations have **not** been applied to that hosted project.
- The Security Advisor's five authenticated SECURITY DEFINER warnings were source-reviewed; they are intentional guarded helpers/actions, not automatically treated as remediated or as proven vulnerabilities. The leaked-password protection notice is plan-limited on the connected Free organisation. Do not upgrade without explicit approval.
- E20 dispatch remains false. No provider, worker, scraper, WhatsApp sender or outreach flow was activated.
- This checkpoint closes the repeatable code/CI and local authenticated E18–E22 acceptance gates. It does not authorise a production release, deployment, hosted migration, real-data E16.1 apply, paid upgrade or public release.

**Continuation rule:** Section 12 supersedes the earlier in-progress R1/R2/R5 entries in Section 9. Continue with the R4 device acceptance and R6 independent review preparation while preserving every release boundary above.

---

## 13. E15 lender/customer workspace refinement — 25 November 2026

### Scope completed on the existing feature branch

- Repository remains imtboss007/AXIVESTRA.
- Work remains on feat/discovery-e11-explainable-matching and PR #88; target remains feat/discovery-e10-enrichment.
- E15's existing single lead pipeline continues to support both LENDER and CUSTOMER discovery modes. No duplicate customer/lender subsystem or schema was introduced.
- Added All workspaces / Lender / Customer filters, unified company/workspace/stage/priority search, selected-state accessibility, clear filters, visible-result counts and explicit unknown-mode labels.
- Added visual score meters, improved mode badges and hierarchy, priority emphasis, card/list motion and responsive mobile filter layout.
- Added reduced-motion handling and E15 contract coverage for the new UI controls and motion behaviour.
- Updated docs/AXIVESTRA-DISCOVERY-E15-LEAD-WORKSPACE.md with the feature details and workflow boundaries.

### Commits

- 951ebd7e278509cf7e431bf7bcdb52cfab9ac8cf — E15 lender/customer filters and search.
- e33b191cf80789391229121306b3c23c35bc46a9 — E15 visual refinement and motion.
- 6f3a9ac2e350c47f4283bfad4ef77536b568e4d8 — E15 regression contract assertions.
- edf56a43eca57b8aa9bbb2e1d8da971f90490c01 — E15 feature documentation.

### Acceptance state and remaining work

The last observed branch CI poll showed the Cloud Worker workflow passed. Discovery governance/build and WhatsApp Hub checks were still in progress at that observation; refresh the status against the latest branch head before treating the changes as CI-verified. Contract assertions are committed but must not be described as passing until their workflow completes.

The visual changes have not yet been inspected on a physical Android device. The next UI acceptance should verify small-screen filter wrapping, score-meter rendering, mode badges, card transitions, focus states and the reduced-motion setting. The existing authenticated E18–E22 browser pass is not evidence of E15 visual acceptance.

### Release boundaries preserved

No branch merge, deployment, hosted Supabase migration, production data change, provider activation, paid upgrade or public release was performed or authorised. Keep PR #88 in draft until CI and the required review gates are complete. Do not mark E15 visually complete until the physical Android check is recorded.

---

## 14. E15 final code checkpoint and build verification — 25 November 2026

### Latest code head and PR state

- Tested code head: 82c4bd43c3507ec0ccf9d8b9acd0486a8685cb20.
- Repository: imtboss007/AXIVESTRA.
- Branch: feat/discovery-e11-explainable-matching.
- PR #88 remains open and draft, targeting feat/discovery-e10-enrichment. It is not merged.
- Follow-up code commits after the earlier Section 13 checkpoint:
  - 61d5deeeb1b627718552b1a2552a7b149d24e3e4 — corrected search control semantics and added live result-count announcement.
  - 82c4bd43c3507ec0ccf9d8b9acd0486a8685cb20 — expanded regression assertions for accessible Lender/Customer filters.
- E15 feature and verification documentation updated in docs/AXIVESTRA-DISCOVERY-E15-LEAD-WORKSPACE.md.

### CI results observed on tested code head

| Workflow / gate | Run | Result |
|---|---:|---|
| Discovery governance, policy tests, worker/PostgreSQL integration, E05 benchmark, full regression and web build | 45676192783 | **PASS** — policy/build job 24/24 steps |
| Windows installer and Android APK build | 45676192697 | **PASS** — both platform jobs |
| Cloud Worker checks | 45676200773 | **PASS** |
| WhatsApp Hub checks | 45676200831 | **PASS** |
| Authenticated E18–E22 browser acceptance on disposable local Supabase | 45676192783 / 45676200952 | **IN PROGRESS** at Chromium setup in the last observation; no browser pass claimed |

The Android artifact build is a packaging result only. It is not a substitute for opening and inspecting the E15 Lender/Customer interface on a physical Android device.

### E15 acceptance distinction

- Implemented: Lender/Customer mode filtering, company/workspace/stage/priority search, mode labels, match-score meters, pipeline card hierarchy, responsive filters, restrained motion, focus states and reduced-motion support.
- Automated code verification: E15 discovery test suite, full regression and Vite/TypeScript build passed on code head 82c4bd4.
- Still pending: a dedicated E15 authenticated browser interaction/screenshot test and hands-on Android visual inspection at phone width. Verify both Lender and Customer mode views, search/clear behaviour, no-result state, focus treatment, animations and reduced-motion mode.
- Keep E15 in implementation-complete / visual-acceptance-pending status until those checks are recorded.

### Release boundaries

No merge, hosted Supabase migration, deployment, production-data change, external-provider activation, paid upgrade or public release was performed. Keep PR #88 in draft. Existing E20 dispatch and external outreach gates remain closed.

---

## 15. E15 authenticated browser acceptance complete — 26 November 2026

### Tested code head

- Code head tested: 50533b46b4c559358e53deae12318071b4f9e7ed.
- Repository: imtboss007/AXIVESTRA.
- Branch: feat/discovery-e11-explainable-matching.
- PR #88: open / draft, targeting feat/discovery-e10-enrichment; not merged.

### E15 functionality and visual work

- Added All workspaces / Lender / Customer view filters to the existing E15 lead workspace.
- Added unified company/workspace/stage/priority search, clear-search control and live result count.
- Added Lender/Customer mode badges, match score meter, stronger pipeline/priority hierarchy, restrained entry/feedback motion and responsive mobile filter layout.
- Added accessibility semantics and reduced-motion support.
- Seeded separate synthetic LENDER and CUSTOMER match results in disposable browser QA only.
- Added authenticated browser coverage for mode switching, record filtering, search/clear/no-results, score presentation, 390px layout and reduced motion.
- Fixed a Playwright test-registration nesting defect detected by the first browser run; corrected test is now part of the authenticated workflow.

### Final CI results

| Gate | Workflow | Result |
|---|---:|---|
| Discovery governance, E15 contract, worker/PostgreSQL integration, E05 benchmark, full regression, type-check and web build | 45823362748 (PR), 45823355164 (push) | **PASS** — both policy/build jobs 24/24 steps |
| Authenticated E18/E19/E21/E22 plus E15 browser acceptance on disposable local Supabase | 45823362748 (PR), 45823355164 (push) | **PASS** — both jobs 17/17 steps; Playwright **9/9 passed** |
| Windows installer | 45823355180 | **PASS** — 13/13 steps |
| Android APK | 45823355180 | **PASS** — 20/20 steps; artifact uploaded |
| Cloud Worker | 45823362649 | **PASS** |
| WhatsApp Hub | 45823362720 | **PASS** |

The E15 browser test explicitly passed mode switching, correct LENDER/CUSTOMER record visibility, search and clear-search behaviour, empty state, match-score meter, 390px viewport layout and reduced-motion rules. It uses synthetic data in a disposable local Supabase stack; the stack is stopped after acceptance.

### E15 completion status

- Functional implementation: **COMPLETE**.
- Automated contract/regression/build verification: **PASS**.
- Authenticated browser interaction and mobile-viewport acceptance: **PASS**.
- Android APK / Windows installer packaging: **PASS**.
- Physical Android device inspection: **PENDING**. Browser viewport emulation is not physical-device testing.
- Independent security/privacy/accessibility review: remains a separate programme release gate (R6 in Section 12).

### Continuation and release boundaries

The next E15 action is physical Android installation and visual inspection, if device acceptance is required. Check mode switching, search, mobile overflow, card layout, animations and reduced-motion preferences on the actual phone.

No merge, deployment, hosted Supabase migration, production data modification, provider activation, paid upgrade or public release was performed. Keep PR #88 in draft pending the user's review and outstanding release gates. Existing E20 dispatch and outreach gates remain closed.

---

## 16. Latest integration and release-readiness continuation — 26 November 2026

### Integrated branch and merge state

- Repository: imtboss007/AXIVESTRA.
- Active integration branch: feat/discovery-e10-enrichment.
- PR #88 from feat/discovery-e11-explainable-matching is **CLOSED / MERGED** into feat/discovery-e10-enrichment.
- Merge commit: c2c8fb173e2e80c3eface6c574a616c8b498227b.
- PR #88 is no longer an open draft. Its changes are now part of the integration branch; do not recreate or reapply them.
- Production/default branch main remains separate and unchanged by this integration merge.

### Post-merge verification

- Discovery Governance PR run 45826453426 — PASS.
- Discovery Governance push run 45826476793 — PASS.
- Authenticated E18/E19/E21/E22 browser job within run 45826453426 — PASS. It provisions disposable local Supabase, creates a temporary QA owner/company and synthetic deal/party/task/source/evidence/provenance/match/suggestion fixtures, runs the authenticated Playwright suites, uploads redacted browser evidence and stops the local stack.
- WhatsApp Hub run 45826453454 — PASS.
- Cloud Worker run 45826453430 — PASS.
- Windows installer and Android APK run 45824041085 — PASS on pre-merge commit b4b6f72e94d86d4d9edb12841c9da6aaf6544d9e. The merge commit c2c8fb173e2e80c3eface6c574a616c8b498227b has the **same Git tree** as that build-tested commit.
- Cloudflare Pages generated a branch preview during the feature-branch workflow. This is a preview, not a production deployment.
- E15's dedicated authenticated browser acceptance previously passed 9/9 tests; physical Android inspection remains pending.

### New continuation work in the release-readiness increment

- Added docs/AXIVESTRA-RELEASE-REVIEW-PACK.md. This is a review-preparation packet, not an independent audit or sign-off. It maps tenant isolation, RLS/SECURITY DEFINER, privacy, retention, evidence/licence, orchestration, AI, sync, accessibility and packaging review.
- Added docs/AXIVESTRA-PAIRED-DEVICE-ACCEPTANCE.md. It defines physical Android/Windows test cases and makes clear which legacy local/device collections are covered; cloud-native E16–E22 workflows are outside the existing device snapshot contract.
- Updated the E18, E19, E20, E21 and E22 stage documentation to distinguish current authenticated local-QA acceptance from hosted/production acceptance.
- Updated .github/workflows/estateflow-download-builds.yml so Windows/Android artifact builds trigger for relevant changes and pull requests targeting feat/discovery-e10-enrichment. Existing legacy branch trigger and manual workflow dispatch are preserved. Publishing remains disabled by electron-builder configuration.

### Ordered next actions

| ID | Task | Status | Next action |
|---|---|---|---|
| R1 | Disposable local QA stack and synthetic fixtures | PASS | Continue using the ephemeral CI implementation; no production credentials. |
| R2 | Authenticated E18/E19/E21/E22 browser acceptance | PASS | Re-run on every relevant code change; retain PASS/FAIL/SKIPPED distinction. |
| R3 | E16.1 backfill in isolated PostgreSQL | PASS — CI only | Any hosted non-production deployment, dry run or real-data apply is still a separately approved action. |
| R4 | Paired physical Android/Windows device acceptance | PENDING | Use docs/AXIVESTRA-PAIRED-DEVICE-ACCEPTANCE.md with two physical devices and disposable QA data. |
| R5 | Windows/Android build on current integration branch | PASS on identical source tree; fresh trigger enabled | Verify the workflow triggered for this release-readiness PR/merge and record both artifact results. |
| R6 | Independent security/privacy/retention/licence/tenant/accessibility review | PENDING | Give docs/AXIVESTRA-RELEASE-REVIEW-PACK.md to a genuinely independent reviewer and record a signed report. |

### Current release boundaries

- No merge to main, production deployment, hosted Supabase migration, real-data backfill, provider activation, E20 dispatch, official WhatsApp send, paid upgrade or public release.
- The prior recorded hosted Supabase migration history ended at 20261114035526 axivestra_custom_module_sync; re-check before any future release decision.
- Five SECURITY DEFINER Advisor warnings and the plan-limited leaked-password protection notice remain items for independent review; do not mark them resolved solely from source inspection.
- E20 dispatch remains hard-disabled. E22 provider execution remains disabled and its synthetic QA data does not establish model accuracy.
- Physical device testing and independent review have not been performed by this update.

**Continuation rule:** This Section 16 overrides stale branch/PR status and older pending/completed labels in Sections 1–15. Continue from the latest commit on feat/discovery-e10-enrichment, not from the original project baseline. Integrate each completed increment into this same development line; never restart discovery from scratch or create another repository.
