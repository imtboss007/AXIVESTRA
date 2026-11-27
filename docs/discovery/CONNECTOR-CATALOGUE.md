# AXIVESTRA Discovery Connector Catalogue

**Review date:** 2026-11-28  
**Status:** Candidate assessment only. No new provider has been activated.

## Integration rule

AXIVESTRA uses one governed connector interface. Do not import every crawler repository into the application. Select a small set by task, keep upstream projects as external dependencies/services, pin versions, review exact licence files and security advisories, and record notices for anything adopted.

## Candidate matrix

| Project | Upstream | Licence reported in current research | Best-fit role | AXIVESTRA decision |
|---|---|---|---|---|
| Scrapy | https://github.com/scrapy/scrapy | BSD-3-Clause | High-volume structured HTTP crawling with throttling and middleware | Candidate for bounded permitted public-source crawling |
| Crawlee | https://github.com/apify/crawlee | Apache-2.0 | TypeScript crawling, queues, sessions and browser-backed crawling | Candidate if Node-native crawling is needed; avoid duplicating Scrapy without evidence |
| Playwright | https://github.com/microsoft/playwright | Apache-2.0 | JavaScript-rendered pages and controlled browser testing | Browser adapter for explicitly permitted JS pages; not a paywall/CAPTCHA bypass |
| Scrapling | https://github.com/D4Vinci/Scrapling | BSD-3-Clause | Adaptive parsing and extraction | Existing optional parser; currently documented as parsing already captured evidence |
| Crawl4AI | https://github.com/unclecode/crawl4ai | Apache-2.0 | HTML-to-Markdown/content extraction for AI workflows | Candidate only if its extraction output adds measurable value beyond E05 |
| SearXNG | https://github.com/searxng/searxng | AGPL-3.0 | Self-hosted metasearch returning candidate URLs | Existing connector is present but disabled; separate service and licence review required |
| Firecrawl | https://github.com/firecrawl/firecrawl | AGPL-3.0 | Self-hostable crawl/extraction API | Do not add unless a feature gap justifies AGPL network obligations and deployment review |

Licence labels above are a research shortlist, not legal advice or a substitute for verifying the exact release's LICENSE file and bundled dependencies at adoption time. Research overview: https://github.com/collections/web-scraping and https://scrapegrounds.com/guides/choose-scraping-libraries.

## Provider classes

1. **Official/public registries:** regulator/company/government directories and datasets, each registered with exact allowed paths, fields, purpose, attribution, terms and refresh cadence.
2. **Official organisation websites:** product, eligibility, service-area and company information where automated access is permitted.
3. **Licensed commercial feeds/APIs:** use the provider's official API or licensed export, server-side credentials, contractual field scope and rate limits. A subscription to a website does not automatically grant permission for automated scraping.
4. **Public search engines:** use a controlled self-hosted SearXNG instance or another approved search API. Search snippets are discovery hints, not evidence.
5. **User-provided sources:** uploaded lists, documents and URLs are ingested with explicit source attribution and validation.

## Paid and restricted sources

- Paid APIs are not enabled by default and may incur subscription or usage fees. Keep them disabled until the owner supplies approved credentials and confirms the applicable licence/terms and budget.
- Do not scrape content behind paywalls or login walls without explicit contractual permission for that method.
- Do not defeat CAPTCHA, bot controls, access restrictions, robots directives or rate limits.
- No private-person harvesting or automatic outreach.

## Required connector contract

Every adapter must accept a company ID, discovery kind (LENDER or CUSTOMER), workspace profile, source ID, approved purpose, field allow-list, result/page budget and abort signal. It must return bounded records with provider/source ID, exact URL, retrieval time, status, and error metadata. Fetch adapters may run only against an exact approved source origin/path. Parser adapters operate on captured evidence and never execute fetched page instructions.

## Freshness and refresh semantics

A scheduled refresh is only "live" when the provider call actually succeeds. Persist `last_attempt_at`, `last_success_at`, `next_refresh_at`, `source_as_of`, `content_hash`, `status` and a concise failure reason. Show cached/stale results as stale, never as live. Use idempotent queue jobs, atomic tenant/source quotas, leases, retry caps and a global pause switch. Refresh cadence is source-specific and constrained by provider terms and rate limits.

## Current implementation facts

- E03 SearXNG connector exists but requires server-side feature flag and endpoint configuration.
- E04 fetch and E05 extraction workers are disabled by default.
- Scrapling is currently an optional parser for already captured evidence, not a general internet search engine.
- The source registry requires explicit company owner/admin review before fetch eligibility.
- No external search provider or crawler should be activated merely because a frontend navigation item exists.


## Unified API layer decision (2026-11-28)

The architecture decision is recorded in [UNIFIED-PROVIDER-API-LAYER.md](./UNIFIED-PROVIDER-API-LAYER.md).

- Reuse the existing Supabase `discovery-control` Edge Function as the authenticated first-party API boundary.
- Reuse `discovery-connector-registry.mjs` for all provider adapters; do not create a parallel gateway or let the browser call providers directly.
- Reuse existing Crawlee and Playwright worker dependencies and the optional Scrapling parser. Scrapling remains a parser for captured evidence, not a discovery search engine.
- Keep SearXNG as the existing optional E03 metasearch service; it is inactive until server-side configuration.
- Scrapy is a candidate separate Python worker only if measured throughput justifies it. Meltano is a candidate for bulk ELT, not request-time prospect discovery.
- Apache APISIX is an optional later edge gateway if external API publication, multi-service routing or measured gateway scale requires it. It is not added as a duplicate runtime dependency now.
- LENDER and CUSTOMER use separate workspace profiles and result modes over the shared governed API/connector engine.
- Provider health, quota, last-success and freshness status must be visible; stale or failed results must never be labelled live.

This is an architecture decision only. No new provider was activated, no paid credentials were added, and no deployment or production migration occurred.
