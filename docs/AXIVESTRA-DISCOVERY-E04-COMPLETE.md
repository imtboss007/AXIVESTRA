# AXIVESTRA E04 — Crawler & Fetch Workers

**Status:** complete implementation staged for review on `feat/discovery-e04-complete`. Not merged or deployed. No source adapters are enabled by default.

## E04 contract

E04 fetches only explicit candidate URLs supplied by an approved search/provider result or manually entered against a registered source. It does not search the web, discover links recursively, or decide which entities are relevant. Search and source discovery belong to E03; structured extraction belongs to E05.

The output of E04 is an immutable raw evidence object and its metadata reference, plus a fetch-event record. E04 does not parse company names, contacts, addresses, financial attributes or other business facts.

## Runtime architecture

1. An authenticated company member queues a job for an enabled LENDER/CUSTOMER workspace profile, one approved source attached to that profile, its exact approved purpose, and a bounded list of candidate URLs.
2. The API validates the company/profile/source relationship, exact HTTPS origin and path prefix, page budget, 48 KB job payload cap and 8 KB criteria cap. A company-scoped idempotency key prevents duplicate job creation.
3. The queue uses PostgreSQL row locking (`FOR UPDATE SKIP LOCKED`), bounded leases, heartbeats, retry limits and backoff.
4. A separate Node.js worker uses Crawlee `BasicCrawler` as the bounded request scheduler. One worker instance processes one claimed job at a time; each job's candidate list is capped by the source profile and the worker uses a maximum concurrency of two.
5. Before every outbound HTTPS request — including `robots.txt` and every redirect hop — the worker reserves a source-wide quota unit in PostgreSQL. It also writes a request-start event before the network request.
6. It checks same-origin `robots.txt` and fails closed if the policy endpoint is unavailable or disallows the target. A 404/410 means no robots file was published. This is an access-etiquette check, not a substitute for licence/terms approval.
7. DNS results are checked for private, loopback, link-local, special-use and reserved addresses. The socket is pinned to a public address returned by DNS while TLS hostname verification remains enabled. Only HTTPS on the standard port is accepted.
8. Redirects are limited to three hops, remain on the exact same origin and must still pass the source path allow-list. Cross-origin, non-HTTPS, credential-bearing or out-of-policy redirects are blocked.
9. A response is capped at 5 MB and must use an explicit evidence MIME allow-list (HTML, text, JSON/JSON-LD, XML or PDF). The SHA-256 content hash, source/legal snapshot, capture time, response metadata and private object path are stored. Query-parameter values are redacted from audit/evidence URLs.
10. A source-scoped cache reuses unexpired evidence for up to six hours, never beyond the source retention period. Cache hits produce an audit event without refetching the page.
11. Fetch failures are retried by Crawlee at most twice after the initial attempt. The job-level hard outbound-request ceiling is also enforced. No cookies, browser session tokens, credentials, stealth plugins, proxy rotation or anti-bot bypass are used.

## Permission and emergency controls

Fetching requires both independent gates:

- The separately hosted worker process must have `DISCOVERY_WORKER_ENABLED=true`. The default is disabled.
- A company owner/admin must issue a company-scoped fetch grant from the AXIVESTRA UI. It expires automatically after one hour. Revocation blocks new claims and quota reservations; active workers fail their next heartbeat and abort.

A company member may queue jobs and view the company's queue. Only its owner/admin may create or revoke the temporary fetch grant. The UI displays the exact permission scope and the one-hour expiry. Every grant/revocation and queued request leaves an audit receipt.

## Repository choice from the supplied candidate inventory

- **Crawlee** is the single selected TypeScript scheduling/crawling framework (pinned to 3.18.2, Apache-2.0). It is not a data source and does not require Apify hosted service.
- **Playwright** remains in the existing test toolchain. Browser-rendered fetching is not activated in this E04 runtime: a browser renderer must route every navigation and subresource through the same origin/path, DNS, robots, quota and audit gates. No browser stealth or challenge bypass is permitted. The current E04 fetch worker uses controlled HTTPS retrieval for official APIs and permitted static/public pages.
- Scrapy, Crawl4AI, Scrapling and other crawler engines are not stacked. A different engine would require a measured gap and a separate licence/security review.
- No lead-source/provider adapter is registered by default. The existing connector registry remains empty until each source/provider is separately reviewed and explicitly configured.

## Files included

- `services/discovery-worker/worker.mjs` — Crawlee worker, leased job execution, HTTPS retrieval, private evidence persistence and cache.
- `services/discovery-worker/worker-policy.mjs` — DNS/IP gate, robots policy, URL redaction and exact candidate validation.
- `services/discovery-worker/package.json` — pinned Crawlee runtime and isolated worker dependencies.
- `supabase/migrations/20261122180000_discovery_fetch_evidence.sql` — fetch events, evidence metadata, private bucket, cache, expiring company grant and service-role-only worker RPCs.
- `supabase/functions/discovery-control/index.ts` — queue APIs, candidate validation, one-hour owner/admin grant and queue history.
- `src/DiscoveryJobQueue.tsx` and `src/DiscoverySourceManager.tsx` — AXIVESTRA queue/authority UI, connected to the existing source-manager style system.
- `services/discovery-worker/worker-policy.test.mjs`, `services/discovery-worker/postgres-integration.test.mjs`, and `services/discovery-engine/tests/fetch-worker-contract.test.mjs` — pure policy, actual PostgreSQL and integration-contract tests.

## CI verification

The discovery workflow now runs:
- Source policy, bounded execution, durable queue and enqueue tests.
- Fetch worker policy tests.
- PostgreSQL 16 migration and concurrency integration tests: simultaneous job claims, shared quota contention, live heartbeat, revocation and blocked claim/reservation.
- Full application regression, Deno Edge Function type-check and AXIVESTRA web build.

The PostgreSQL test uses a disposable GitHub Actions database, not the user's Supabase project. A successful CI run is required before calling E04 validated.

## Not deployed / remaining release gate

No migration has been applied to the production Supabase project. No worker process is running. No source has been activated, no external website has been contacted by this implementation work, and no deployment, merge or release has been performed.

Before any live source is enabled: review that source's exact terms/licence, allowed purpose/fields, jurisdiction, robots policy, published quotas, retention, attribution and data protection. Apply reviewed migrations through the normal release process, deploy the worker in a controlled server environment, keep the process flag disabled until the owner/admin grant is issued, and monitor its fetch-event/evidence ledger. The worker supports static/API fetches only; browser rendering requires a separately controlled adapter.
