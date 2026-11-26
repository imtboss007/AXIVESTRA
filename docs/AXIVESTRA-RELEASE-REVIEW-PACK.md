# AXIVESTRA — Independent Release Review Pack

**Status:** Preparation only. This document is not an independent audit, penetration test, compliance certification or release approval.

**Product-code baseline:** merge commit c2c8fb173e2e80c3eface6c574a616c8b498227b on feat/discovery-e10-enrichment.
**Repository:** imtboss007/AXIVESTRA.
**Review boundary:** inspect the integrated application and its cloud/edge/database contracts at the exact commit identified in the reviewer report. Reconfirm the current branch head before starting.

## 1. Independence and review method

The reviewer must be independent of the implementation and must not approve their own changes. Record reviewer identity, organisation, date, commit SHA, scope, exclusions, evidence examined and conflicts of interest.

The review must be performed against a fixed commit, not a moving branch. Findings must cite file paths, function/table names, affected roles, exploit or failure preconditions, impact, reproducibility and a recommended correction. Do not close a finding solely because a static contract test passes.

Use the following disposition labels:
- **PASS:** tested against the stated scope with recorded evidence.
- **FAIL:** a reproducible unacceptable weakness or control failure exists.
- **BLOCKED:** required environment, permission, evidence or external dependency is unavailable.
- **NOT TESTED:** the reviewer did not execute the required test.
- **NOT APPLICABLE:** explain why the control does not apply.

Suggested severity: Critical (cross-tenant compromise, credential compromise, destructive unauthorised action), High (sensitive-data exposure or privilege escalation), Moderate (material workflow/control weakness), Low (limited impact), Informational (hardening or documentation).

## 2. System boundary to review

Review the existing React/Vite client and local-first device state; Supabase Auth, Postgres, RLS, SECURITY DEFINER functions and migrations; Discovery Edge Functions; the discovery/orchestration worker contracts; Cloud Worker and WhatsApp service boundaries; source governance and evidence lifecycle; and the Windows/Android packaging workflows.

Do not treat a branch preview, local Supabase stack, CI synthetic fixtures or successful application build as a production deployment or production acceptance result.

## 3. Independent review matrix

| Domain | Primary evidence | Required reviewer checks |
|---|---|---|
| Authentication and tenant isolation | supabase/migrations/20261030164420_auth_company_rbac.sql; 20261030164546_rbac_hardening.sql; 20261030164550_metadata_audit_hardening.sql; 20261030164556_approval_permissions.sql; src/AuthGate.tsx | Verify authenticated identity binding, membership and role checks, company-scoped reads/writes, cross-tenant denial, session handling and privilege boundaries. Test negative cases using at least two disposable companies. |
| RLS and SECURITY DEFINER | All migrations; scripts/security-contract-check.cjs; services/discovery-engine/tests | Review every security-definer function's owner, search_path, grants/revokes, caller identity, argument validation and tenant predicates. Attempt direct-table and RPC misuse as viewer, staff, manager, owner and non-member. |
| Privacy and data minimisation | docs/AXIVESTRA-DISCOVERY-E14-PRIVACY-COMPLIANCE.md; supabase/migrations/20261122290000_discovery_privacy_compliance.sql; services/discovery-engine/tests/privacy-compliance-contract.test.mjs | Trace personal data from source ingestion through extraction, identity/contact records, provenance, review, export, erasure and retained metadata. Confirm identity verification and owner/admin approval are mandatory before subject actions. |
| Retention and erasure | E04 retention implementation; E14 migration and documentation | Verify expiry calculations, purpose-to-policy matching, bounded processing, retry/replay behaviour, immutable receipts, raw-object deletion and whether backups/logs/exports retain personal information. Confirm no unapproved automatic erasure worker exists. |
| Evidence, provenance and source licence | E02/E04/E13/E21 migrations and docs/AXIVESTRA-DISCOVERY-E21-EVIDENCE-OPERATIONS.md | Verify approved-source gates, source attribution/licence snapshots, evidence integrity hashes, retention-aware manifests, private object access, URL/body/value minimisation and cross-company evidence denial. |
| Relationships and commitments | docs/AXIVESTRA-E16-DEAL-PARTY-RELATIONSHIPS.md; docs/AXIVESTRA-E17-RELATIONSHIP-GRAPH.md; docs/AXIVESTRA-E18-COMMITMENTS-WORKSPACE.md | Verify stable-ID-only links, same-company composite references, immutable relationship identity/history, graph projection minimisation and commitment ownership/transition controls. |
| Orchestration and workers | docs/AXIVESTRA-E20-AGENT-ORCHESTRATION.md; supabase/functions/discovery-orchestration-worker; services/discovery-worker | Verify dispatch remains false, adapters are not dispatch-ready, worker tokens/leases are narrowly scoped and expiring, secrets remain server-side, retries are bounded and no hidden scheduler/queue bridge bypasses preflight. |
| AI matching and human review | docs/AXIVESTRA-DISCOVERY-E22-AI-MATCHING.md; services/discovery-worker/ai-matching.mjs; E22 migration/tests | Verify E11 remains authoritative, E22 is advisory, inputs are minimised, citations are request-bound, provider is disabled, scores are not represented as probabilities and model output cannot alter canonical records or promote leads. Review fairness and quality only with a properly adjudicated dataset. |
| Device sync and deletion | src/lib/device-sync.ts; scripts/device-sync.test.cjs | Independently exercise the real sync transport and two physical devices. Check bidirectional updates, tombstones, stale-snapshot replay, duplicate/retry behaviour and company/session isolation. Unit tests alone are insufficient. |
| Accessibility and responsive use | src/DiscoveryLeadWorkspace.tsx; src/styles.css; tests/browser/axivestra-ai-matching-review.spec.ts | Check keyboard-only operation, accessible names/states, focus visibility, contrast, zoom/reflow, reduced motion, screen-reader announcements and touch target behaviour. Include actual Android inspection; Chromium emulation is not physical-device acceptance. |
| Packaging and release controls | .github/workflows/estateflow-download-builds.yml; .github/workflows/discovery-governance-checks.yml | Verify reproducible source commit, artifact identity/hash, no publish/release side effects, dependency provenance, build secret handling and absence of production deploy or migration actions. |

## 4. Known findings and explicit limitations to verify

1. The last recorded connected hosted Supabase migration-history check ended at 20261114035526 axivestra_custom_module_sync. E16–E22 migrations were not recorded as applied in that snapshot. Re-check the live project before any deployment decision; CI's disposable PostgreSQL migration run is not a hosted migration.
2. The last recorded Supabase Security Advisor snapshot showed five authenticated SECURITY DEFINER warnings: public.is_company_member(uuid), public.has_company_role(uuid,text[]), public.create_company_with_owner(text), public.cancel_whatsapp_cloud_message(uuid,uuid), and public.retry_whatsapp_cloud_message(uuid,uuid). A source spot-check exists, but these warnings are not independently cleared or proven harmless.
3. The same recorded snapshot showed leaked-password protection disabled on the connected Free organisation. Do not upgrade or purchase a plan to change this without owner approval.
4. E14 does not provide a user-facing DSAR portal, identity-verification provider, automated legal-basis assessment, portable export package builder or cross-jurisdiction legal rules engine. Do not claim universal legal compliance from the implemented controls.
5. E20 dispatch is hard-disabled. No external provider, autonomous worker dispatch, source fetch activation or official WhatsApp send is authorised by this review pack.
6. E22 has no configured model provider or real adjudicated evaluation dataset. Synthetic contract/browser fixtures prove workflow contracts only, not model accuracy, fairness or production suitability.
7. The paired physical Android/Windows device-sync acceptance has not been performed. The deterministic reconciliation test is not device acceptance.
8. Independent security, privacy/retention, licence/provenance, tenant-isolation and accessibility sign-off remains outstanding.

## 5. Existing automated evidence — not a substitute for independent review

Post-merge runs on the integration branch:
- Discovery Governance PR run 45826453426: PASS, including the authenticated E18–E22 browser job.
- Discovery Governance push run 45826476793: PASS.
- WhatsApp Hub run 45826453454: PASS.
- Cloud Worker run 45826453430: PASS.

Windows installer and Android APK jobs passed in run 45824041085 on source commit b4b6f72e94d86d4d9edb12841c9da6aaf6544d9e. GitHub reports the merge commit c2c8fb173e2e80c3eface6c574a616c8b498227b has the same Git tree as that tested source commit. A fresh integration-branch artifact build is still desirable and is wired by the accompanying CI trigger update.

E15's dedicated authenticated browser acceptance previously passed 9/9 tests in runs 45823362748 and 45823355164. It covered lender/customer filtering, search/clear/no-results, score display, 390px layout and reduced-motion rules. It does not replace physical Android testing.

## 6. Required reviewer report

- Reviewer / organisation:
- Date:
- Exact commit SHA:
- Environment and test accounts:
- Scope completed:
- Scope excluded and reason:
- Findings with severity, affected component, reproduction, evidence and remediation:
- RLS/tenant-isolation result:
- Privacy/retention result:
- Licence/provenance result:
- Worker/provider boundary result:
- AI/model boundary result:
- Accessibility/device result:
- Overall disposition: PENDING / PASS WITH CONDITIONS / FAIL
- Reviewer sign-off:

## 7. Exit criteria

R6 is complete only when an independent reviewer has examined the fixed commit, executed or clearly marked the required negative tests, recorded findings and retest evidence, and signed a documented disposition. Any Critical or High finding blocks release pending remediation and retest. This preparation document itself never changes R6 from PENDING.

Production migrations, real-data backfills, provider activation, worker dispatch, official messaging, production deployment, paid upgrades and public release remain separate approval gates.
