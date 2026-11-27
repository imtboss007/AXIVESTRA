# AXIVESTRA LENDER and CUSTOMER Discovery — Design

**Date:** 2026-11-28  
**Repository:** `imtboss007/AXIVESTRA`  
**Base:** `feat/discovery-e10-enrichment` at `7cdd8e60571f6d9b315c3dac2b0ceb5bb522f1da`

## Intent

Repair the installed application's repeated company-workspace gate and expose two independent, first-class discovery products: **LENDER Discovery** and **CUSTOMER Discovery**. Each product must operate across the existing 16 business workspaces, maintain its own criteria, source attachments, queues, evidence, extraction, entity matching, verification, scoring and lead review, while sharing governed infrastructure.

The system should refresh permitted public and licensed sources on a controlled schedule and display source provenance, last-checked time, freshness and verification state. Search results remain unverified candidates until evidence capture and human review establish otherwise.

## Goals

- Fix workspace selection/authentication propagation so company-scoped discovery screens render only when a valid authenticated company context exists, and explain missing prerequisites rather than showing the same generic gate.
- Add separate top-level LENDER Discovery and CUSTOMER Discovery navigation/workspaces. Keep each of the 16 existing module profiles available within both where policy and criteria permit.
- Give each discovery type separate criteria, result queues, deduplication namespaces, match scoring, review status and accepted lead records.
- Support search connectors and fetch/extraction adapters selected by source capability: SearXNG for self-hosted meta-search, Scrapy/Crawlee for bounded crawling, Playwright for permitted JS-rendered pages, Scrapling for adaptive parsing, and existing deterministic extraction. Reuse only compatible, maintained, licensed components; do not bulk-copy third-party repositories into AXIVESTRA.
- Implement scheduled refresh with per-source/per-company quotas, leases, backoff, idempotency, change detection, freshness indicators and pause/kill switches.
- Keep evidence immutable and provenance-linked; require explicit owner/admin source approval and human acceptance before a candidate becomes a qualified lender/customer.
- Keep Android and desktop responsive, with clear empty, disabled, loading, auth-error, provider-error and stale-data states.

## Non-goals / anti-goals

- No bypassing authentication, paywalls, CAPTCHA, bot challenges, rate limits, robots directives, contractual terms or technical access controls.
- No scraping private personal profiles, non-public data, or paid content without an authorised account/API/licence and permitted purpose.
- No fabricated "live" data, no silent promotion of search snippets to verified records, no automatic outreach.
- No secrets or provider credentials in browser/mobile bundles, VITE variables, commits or logs.
- No production Supabase migration, worker activation, paid provider purchase, deployment, release or merge to `main` without separate approval.
- No new repository.

## Approaches considered

1. **Patch the existing Discovery Sources page only.** Smallest change, but leaves LENDER/CUSTOMER hidden behind a source-governance surface and does not solve separate operating workspaces. Rejected.
2. **Two independent discovery products on shared governed infrastructure (selected).** Adds separate navigation and pipelines while reusing company-scoped source registry, immutable evidence and existing E03-E15 services. Best balance of clear UX, maintainability and no duplicate crawling stack.
3. **Import multiple complete scraper products into AXIVESTRA.** Rejected because it duplicates queues/parsers, increases supply-chain/licence obligations and makes provenance and tenant quotas harder to enforce. Integrate adapters/packages behind one connector contract instead.

## Architecture

- **Presentation:** distinct `LenderDiscoveryWorkspace` and `CustomerDiscoveryWorkspace` routes/components. Each has workspace selector (16 existing modules), criteria, search/refresh controls, candidate list, evidence, match/verification/review tabs and freshness status.
- **Shared control plane:** company-authenticated Discovery API, workspace profiles, approved source registry, purpose/field/path allow-lists, source terms/licence references and company-level grants.
- **Connectors:** provider/search connectors return bounded candidate URLs and source metadata. Fetch adapters operate only on exact approved origins/paths. Parser adapters parse captured snapshots offline.
- **Pipeline:** search → candidate validation/dedupe → approved-source fetch → immutable evidence → extraction → entity resolution → verification → scoring → human review → accepted lender/customer record.
- **Refresh:** scheduler enqueues idempotent refresh jobs; leased workers enforce atomic per-company/source quotas, request spacing, timeouts, retry caps and kill switches. UI labels last checked, next scheduled, freshness and failures.
- **Paid sources:** provider adapters use official/licensed APIs or authorised user-connected credentials stored server-side. If a provider requires subscription, the integration stays unavailable until credentials and commercial permission are supplied. Do not use a generic browser session to defeat paywalls.
- **Open-source candidates:** Scrapy (BSD-3-Clause), Crawlee (Apache-2.0), Playwright (Apache-2.0), Scrapling (BSD-3-Clause), Crawl4AI (Apache-2.0), SearXNG (AGPL-3.0) and Firecrawl (AGPL-3.0) are candidates, not blanket approvals. Verify exact upstream version, licence, dependencies, security posture and integration need before adding any dependency. Prefer existing Scrapling/SearXNG integration and minimal adapters. Firecrawl/SearXNG network deployment obligations require explicit legal review.
- **Data separation:** lender and customer rows must carry a fixed discovery kind and company/workspace ownership; RLS and composite foreign keys enforce isolation. Shared source/evidence infrastructure must never cause lender/customer result leakage.

## Constraints and acceptance criteria

1. On Android, tapping any navigation item must not redirect every page to the same gate. Workspace chooser and authenticated company context must be retained and propagated.
2. LENDER Discovery and CUSTOMER Discovery appear as distinct top-level destinations and never share candidate queues or accepted records.
3. Each destination can select all 16 existing module profiles, with explicit unsupported/disabled policy reasons.
4. Search results are labelled unverified; only exact approved-source matches are fetch-eligible.
5. Every captured fact links to immutable evidence, source, retrieval time, content hash, parser/schema version and review receipt.
6. Refresh respects source policy, tenant/source quotas, idempotency and pause/kill controls; stale/failed sources are visibly reported.
7. Paid integrations remain disabled without authorised credentials and documented licence/terms.
8. No provider credentials are exposed to clients.
9. Tests cover missing company context, personal/local mode, company membership, lender/customer separation, source policy, refresh quotas, idempotency and stale-state UX.
10. CI/build and Android artifact generation must pass before a corrected build is offered. Physical-device acceptance remains a separate manual gate.

## Decisions left to implementation

- Reuse existing profile schema where safe; add a discovery-kind discriminator only where schema inspection proves it is needed.
- Do not enable any connector or recurring worker merely by setting a frontend flag.
- If the connected environment cannot inspect/run the Android build or execute Supabase migrations, stop at a reviewable branch/PR and report the exact blocked operations.
