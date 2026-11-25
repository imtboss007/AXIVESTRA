# AXIVESTRA — Continuation Baseline

**Checkpoint:** 25 November 2026  
**Repository:** https://github.com/imtboss007/AXIVESTRA  
**Canonical development branch:** `feat/discovery-e11-explainable-matching`  
**Production/default branch:** `main`  
**Owner instruction:** When the user says **“Continue AXIVESTRA”**, resume from this file and the live PR/CI state. Do not restart the project, create another repository, repeat the 123-entry inventory, or ask the user to restate established decisions.

## 1. Product and engineering objective

Continue the existing AXIVESTRA asset, capital, lender/customer and relationship-intelligence platform. Preserve its existing React 18/Vite, Supabase, Dexie/local-first, ECharts, TanStack, React Hook Form and Zod stack. The product is already a multi-workspace application for property, loans, ventures, equity, funds, investor relations, litigation, compliance, financial movements, evidence, tasks and counterparties.

Use the original 123-entry repository inventory as a source catalogue, not an instruction to install all 123 projects. The authoritative reconciliation and adoption decisions are in [AXIVESTRA-123-ENTRY-INVENTORY-RECONCILIATION.md](AXIVESTRA-123-ENTRY-INVENTORY-RECONCILIATION.md). Avoid duplicate frameworks and runtime dependencies. Prefer free/open-source and existing code; verify licence, maintenance, security and compatibility before any reuse.

## 2. Current PR map

All listed PRs are open drafts and none is merged to `main`.

| PR | Branch | Current head | Purpose | State |
|---|---|---|---|---|
| #88 | `feat/discovery-e11-explainable-matching` | `a4e264a649e884f0ed7e7501a9411207825d91f4` | Main E01–E22 discovery/evidence/matching/orchestration feature stack; base for next integration | Open, draft |
| #90 | `feat/axivestra-public-api-provider-bridge` | `97b83c2c445ed241467658aac5d870a848050fde` | Gated data.gov.in provider adapter and expanded public API catalogue | Open, draft |
| #91 | `feat/axivestra-relationship-network-visual` | `28a994b45a3f3fdb39f3c563994b837db2ea51c9` | E17 ECharts relationship network visual | Open, draft |
| #89 | Theme Studio branch | `17a5f46e73f5c686b0fa9b86ffdd704a778eddac` | Independent theme studio work | Open/independent; inspect live state before action |

PR #90 and #91 both target the #88 feature branch, not `main`. They diverged from the same earlier ancestor `c6809e8f32ac21750a22071327cb5f3d91654f5a`; comparison against the current #88 head showed #90 is 45 commits ahead and 9 behind, while #91 is 27 ahead and 9 behind. Their diffs overlap in shared discovery contract/test files. Do not assume their separate green CI proves combined compatibility.

A merge attempt for #90 was rejected by GitHub because it is still a draft (HTTP 405). Do not silently change draft state or merge. First reconcile the overlapping changes and obtain green checks on the integrated feature branch; only then may the draft status be changed as part of an explicit, reviewable integration step. Never merge any of these feature branches to `main` without separate explicit approval.

## 3. Verified CI at this checkpoint

- PR #88 head `a4e264a649e884f0ed7e7501a9411207825d91f4`: Discovery governance, WhatsApp Hub and Cloud Worker workflows completed successfully. Runs: 45544004500, 45544004577, 45544004533.
- PR #90 head `97b83c2c445ed241467658aac5d870a848050fde`: Discovery governance and WhatsApp Hub workflows completed successfully. Runs: 45543098506, 45543098524.
- PR #91 head `28a994b45a3f3fdb39f3c563994b837db2ea51c9`: Discovery governance and WhatsApp Hub workflows completed successfully. Runs: 45543373630, 45543373770.

These are branch-specific checks, not a combined integration test. No local clone, package installation, local test run or end-to-end authenticated QA was performed in this ChatGPT session. The authenticated E18/E19/E21/E22 browser acceptance path is explicitly skipped when the dedicated QA account/company, Supabase credentials and required fixtures are absent. Do not describe skipped acceptance as passed.

## 4. Implemented architecture and current boundaries

- E01–E15: workspace profiles, source governance, search preview, governed fetch/evidence, deterministic extraction, company/person/contact/geo/enrichment, explainable matching, provenance, privacy, review and lead workflows are implemented in the staged feature stack.
- E16–E17: explicit deal-party relationships and a company-scoped relationship graph exist. PR #91 adds the ECharts visual. The graph represents explicit records only; it does not infer identity or relationships.
- E18: commitments workflow exists; dedicated authenticated acceptance fixtures remain outstanding.
- E19: verification confidence ledger and owner/admin verification decisions exist; authenticated browser acceptance remains outstanding.
- E20: governed orchestration, approvals, queue mapping, retry/recovery and execution console exist. Dispatch is deliberately disabled; adapter bridges and kill switches remain off.
- E21: evidence catalogue, evidence packs, review lifecycle and metadata-only approved export exist. Authenticated workspace acceptance remains outstanding.
- E22: advisory AI matching, minimised request contract, durable suggestion ledger and owner/admin review exist. Provider adapter remains disabled; no model provider is configured or called.
- PR #90: data.gov.in API bridge and expanded public API catalogue are code-only and gated. No key, source registration, approval or external request exists.
- SearXNG remains off until an approved endpoint and server-side configuration are supplied.
- WhatsApp official cloud sending remains disabled; no autonomous external outreach is authorised.

## 5. Required next engineering sequence

1. Re-read this file, PR #88/#90/#91 metadata, changed-file patches, branch comparisons and latest workflow runs before making changes. The live GitHub state supersedes this checkpoint if it has moved.
2. Reconcile PR #90's provider bridge onto the current #88 feature branch without overwriting newer #88 code. Resolve shared test and package-script changes deliberately; preserve exact source governance, URL redaction, bounded paging, secret isolation and disabled-by-default behaviour.
3. Reconcile PR #91's E17 graph visual onto the same current #88 feature branch. Preserve the existing ECharts dependency; do not add D3, Cytoscape or another graph library. Keep graph data company-scoped and based only on explicit E16 links.
4. Run the full discovery governance, WhatsApp Hub and Cloud Worker CI against the integrated feature head. Run all relevant tests and build checks; inspect failures and fix regressions before proceeding.
5. Configure private QA fixtures and credentials through GitHub/Supabase secret management (never in chat or source) and complete authenticated E18/E19/E21/E22 acceptance. Also verify E16 historical relationship reconciliation/backfill and device-local sync; these are not proven by the graph visual.
6. Complete independent security/release review, licence/provenance review for any selected external code, and a data-retention/privacy review.
7. Keep the feature stack draft and unmerged until its integrated acceptance is genuinely complete. Production migrations, provider activation, worker dispatch, deployment, public release and merge to `main` each require explicit approval.

## 6. Configuration blockers — do not invent credentials

Potential server-side settings (only configure after owner approval and exact source review):
- `DISCOVERY_SEARXNG_ENABLED`
- `DISCOVERY_SEARXNG_URL`
- optional `DISCOVERY_SEARXNG_BEARER_TOKEN`
- `DATA_GOV_IN_API_KEY`
- exact approved data.gov.in dataset/resource ID and E02 source registration

No API key or provider credentials have been supplied. Never ask the user to paste secrets into chat; use the appropriate private secret manager after explicit authorisation. Provider-specific terms, licence, publisher, fields, purpose, quotas, freshness and retention must be reviewed before any external call.

## 7. Non-negotiable user constraints

- Continue in `imtboss007/AXIVESTRA`; do not create another repository.
- Preserve previous code and decisions; inspect before changing.
- One coherent implementation path; no duplicate dependencies or duplicate queues.
- Open-source/free-first; no paid product, provider, hosting or model spend without approval.
- No credentials in source, logs, prompts or chat.
- No production migration, deployment, external provider call, worker dispatch, live WhatsApp/outreach, public release or merge to `main` without explicit approval.
- Do not claim a GitHub green badge means the entire product is finished. Report PASS, FAIL, SKIPPED and BLOCKED separately.

## 8. Continuation command

When the user says **“Continue AXIVESTRA”**:
1. Read this checkpoint and the 123-entry reconciliation document.
2. Refresh PR and CI status from GitHub; do not assume SHAs/statuses above are still current.
3. Resume at the first incomplete item in Section 5.
4. Make progress directly on the existing feature branch(es), preserving all constraints.
5. Report actual files/commits/checks and remaining blockers; do not restart or ask for already documented requirements.
