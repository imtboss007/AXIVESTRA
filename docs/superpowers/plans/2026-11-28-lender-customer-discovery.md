# AXIVESTRA LENDER and CUSTOMER Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair company-workspace navigation and deliver separate, continuously refreshed LENDER and CUSTOMER discovery workspaces over the existing governed discovery pipeline.

**Architecture:** Two first-class React workspaces use a shared, company-scoped discovery control plane. Search/fetch/parser connectors remain server-side, policy-bound adapters; immutable evidence feeds separate lender/customer matching and review pipelines.

**Tech Stack:** React 18, TypeScript, Vite, Supabase Auth/Postgres/Edge Functions, existing discovery worker, Node tests, Python parser tests, Capacitor Android build.

**Spec:** `docs/superpowers/specs/2026-11-28-lender-customer-discovery-design.md`

## Global Constraints

- Continue in `imtboss007/AXIVESTRA`; no replacement repository.
- Base implementation on integration head `7cdd8e60571f6d9b315c3dac2b0ceb5bb522f1da`.
- No merge to `main`, deployment, release, paid provider purchase or production migration without separate approval.
- Keep all secrets server-side; never expose service-role keys or paid provider credentials in clients.
- No paywall/login/CAPTCHA/robots/rate-limit or access-control bypass.
- Search results are unverified candidates; evidence is immutable; human review is required before acceptance.
- Keep lender/customer candidate and accepted-record data isolated with company/workspace RLS.
- Pin every added dependency and record upstream licence/provenance.

## Review Focus

- Missing company context vs personal/local workspace: show the correct chooser or actionable explanation, never a misleading generic loop.
- Stale/expired auth session or membership lookup failure: recoverable sign-in/switch flow and explicit error.
- LENDER/CUSTOMER cross-contamination: database and API reject mismatched discovery kind.
- Search provider unavailable or empty results: no fabricated results; show provider health and last successful refresh.
- Source paused, terms changed, quota exhausted or paid credential missing: block fetch and explain the exact policy reason.

---

## Project A — Workspace routing and separate discovery products

### Task 1: Reproduce and test the company-workspace gate

**Files:**
- Inspect/modify: `src/AuthGate.tsx`, `src/App.tsx`, `src/DiscoverySourceManager.tsx`
- Test: existing AuthGate/App tests; add `src/__tests__/discovery-workspace-routing.test.tsx` if no suitable test exists.

**Interfaces:**
- AuthGate owns the authenticated user, memberships, selected company/personal/local mode.
- App receives a selected company ID and role; Discovery views must not infer a company from local cache.

- [ ] Add tests for no session, personal/local mode, company member, no memberships, and membership lookup failure.
- [ ] Run the targeted test and verify it fails for the current repeated-gate behaviour.
- [ ] Trace AuthGate's rendered branch and App navigation state; fix the smallest root cause without deleting/migrating local data.
- [ ] Render an actionable workspace chooser when no company is selected; show a precise missing-auth/company message when appropriate.
- [ ] Run targeted AuthGate/App tests and existing auth/device-sync tests.

### Task 2: Add separate LENDER and CUSTOMER destinations

**Files:**
- Create: `src/LenderDiscoveryWorkspace.tsx`
- Create: `src/CustomerDiscoveryWorkspace.tsx`
- Modify: `src/App.tsx`, `src/DiscoverySourceManager.tsx` (extract shared panels only if safe)
- Test: `src/__tests__/lender-customer-discovery.test.tsx`

**Interfaces:**
- Both workspace components receive `companyId`, `companyRole`, `selectedWorkspaceKey` and callbacks for workspace changes.
- Each component fixes its `discoveryKind` to `LENDER` or `CUSTOMER`; the user cannot silently switch the kind inside a result queue.

- [ ] Test that navigation exposes two distinct destinations and each requests only its own discovery kind.
- [ ] Test that the 16 existing module keys are available in both destinations subject to policy.
- [ ] Implement the two distinct workspaces with shared UI primitives and separate state/query keys.
- [ ] Add empty/loading/error/disabled/stale states and mobile responsive layouts.
- [ ] Run component tests, typecheck and Vite build.

### Task 3: Separate profiles, candidate queues and accepted records

**Files:**
- Inspect/modify: `src/DiscoverySourceManager.tsx`, discovery API schemas and relevant Supabase migrations/functions discovered in repository.
- Tests: existing discovery profile/API/RLS tests plus new cross-kind isolation tests.

**Interfaces:**
- API requests require `discoveryKind: "LENDER" | "CUSTOMER"`.
- Responses and persisted records carry the same immutable kind discriminator.

- [ ] Inspect current schema and E03–E15 services before deciding whether a migration is necessary.
- [ ] Add failing tests for cross-kind read/write attempts and company/workspace isolation.
- [ ] Implement kind-scoped query filters, deduplication keys, scoring, review and accepted records.
- [ ] Add/adjust RLS policies and composite foreign keys only where schema inspection requires them.
- [ ] Run SQL policy tests, discovery suite and Supabase advisors if available.

## Project B — Multi-engine search, scraping and live refresh

### Task 4: Open-source and provider connector audit

**Files:**
- Create: `docs/discovery/CONNECTOR-CATALOGUE.md`
- Modify: `THIRD_PARTY_NOTICES.md` only for dependencies actually adopted.

**Candidate projects:**
- Scrapy (BSD-3-Clause), Crawlee (Apache-2.0), Playwright (Apache-2.0), Scrapling (BSD-3-Clause), Crawl4AI (Apache-2.0), SearXNG (AGPL-3.0), Firecrawl (AGPL-3.0).
- Verify current upstream licences, versions, dependencies, advisories, and deployment obligations directly from each repository before adoption.

- [ ] Audit current connector implementations and identify missing capabilities.
- [ ] Compare candidate projects by capability, licence compatibility, security, maintenance and integration cost.
- [ ] Select the smallest compatible adapter set; do not add duplicate crawler frameworks without a measured need.
- [ ] Document paid-source integrations as official/licensed API connectors; do not automate logged-in browser sessions to evade terms.
- [ ] Add provenance notices and pinned versions for any adopted dependencies.

### Task 5: Unified connector contract and bounded search

**Files:**
- Inspect/modify: `supabase/functions/_shared/discovery-search-connectors.mjs`, discovery-control function, worker connector registry.
- Tests: `services/discovery-engine/tests/` connector contract and policy tests.

**Interfaces:**
- Search connector input: company ID, discovery kind, profile ID, bounded criteria, result limit, approved provider config.
- Search connector output: candidate URL, provider/source label, snippet/title, observed time, query provenance and `unverified_candidate` status.

- [ ] Add failing tests for result limit, HTTPS validation, unapproved domains, person-centric domains and provider outage.
- [ ] Keep SearXNG self-hosted/controlled and disabled until its server URL and JSON format are configured.
- [ ] Implement provider-neutral adapter selection and bounded result normalization.
- [ ] Ensure search results cannot become fetch-eligible unless exact origin/path matches an approved attached source.
- [ ] Run connector contract and security tests.

### Task 6: Approved-source fetch and parser selection

**Files:**
- Inspect/modify: `services/discovery-worker/`, `supabase/functions/_shared/`, source-specific adapter tests.
- Tests: fetch-policy, parser selection and provenance tests.

**Interfaces:**
- Fetch accepts only an approved source ID and URL matching its exact allowed origin/path.
- Parser consumes captured bytes offline and returns typed facts with immutable source locators.

- [ ] Add failing tests for paused sources, terms changes, path mismatch, quota exhaustion and unsupported content types.
- [ ] Keep Scrapling as parser-only for already captured evidence unless a separately approved source-specific fetch adapter is implemented.
- [ ] Use Scrapy/Crawlee/Playwright only for permitted bounded crawling where existing code is insufficient.
- [ ] Enforce request spacing, per-job limits, atomic company/source quotas, timeout and retry caps.
- [ ] Run worker and parser suites.

### Task 7: Scheduled refresh and freshness

**Files:**
- Inspect/modify: discovery migrations, queue/lease RPCs, worker scheduler and refresh UI.
- Tests: scheduler, idempotency, lease expiry, quota and stale-state tests.

**Interfaces:**
- Refresh job identity includes company, discovery kind, profile, source and schedule window.
- UI exposes last checked, next refresh, last success, freshness and blocked/error reason.

- [ ] Add failing tests for duplicate schedules, expired leases, pause/kill switch, quota exhaustion and concurrent jobs.
- [ ] Implement idempotent scheduled enqueue and atomic quota leases; do not rely on in-memory rate limits.
- [ ] Add per-source and per-company refresh controls with conservative default cadence.
- [ ] Surface stale data and provider failures; never label cached data live.
- [ ] Keep recurring workers disabled until separately authorised and configured.
- [ ] Run queue, scheduler and RLS tests.

## Project C — Verification and Android delivery

### Task 8: End-to-end and security regression

**Files:**
- Tests: existing app/auth/discovery suites; add end-to-end scenarios as repository test infrastructure permits.

- [ ] Verify separate LENDER/CUSTOMER flows across representative modules and all 16 profile keys.
- [ ] Verify company isolation, cross-kind isolation, evidence provenance, human review and no automatic outreach.
- [ ] Run lint, typecheck, unit/integration suites, dependency/security audit and production build.
- [ ] Record blocked checks rather than reporting them as passed.

### Task 9: Android artifact and handoff

**Files:**
- Inspect existing Capacitor/Android build configuration and workflow; do not change release signing or publish settings.

- [ ] Run the repository's documented Android build workflow on the feature branch.
- [ ] Verify the generated artifact is from the feature branch commit and report exact artifact link/hash.
- [ ] Provide manual physical-device checklist for sign-in, workspace selection, navigation, separate modes, refresh and offline/stale behavior.
- [ ] Open a draft PR targeting `feat/discovery-e10-enrichment`; do not merge it or deploy.
