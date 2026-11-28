# AXIVESTRA Unified Provider API Layer

**Date:** 28 November 2026  
**Status:** Architecture implementation checkpoint; no provider credentials, new network integrations, deployment or paid subscriptions activated.

## Decision

Use the existing company-scoped Supabase Edge Function and discovery connector registry as AXIVESTRA's first-party API gateway. Do not insert a second gateway into the runtime until measured traffic, multi-service routing or external API publication requires it. Apache APISIX remains an optional edge gateway for that later stage.

The existing implementation already provides:
- `discovery-control` as the authenticated API boundary for LENDER/CUSTOMER discovery.
- `discovery-connector-registry.mjs` as the governed adapter contract.
- E02 source approval and exact host/path allow-lists.
- E03 SearXNG search preview (disabled until server configuration).
- E04 controlled fetch with server-side provider credential injection.
- E05 extraction and downstream provenance, matching, review and enrichment workers.
- A public API research catalogue and a data.gov.in API-key request bridge.
- Crawlee and Playwright dependencies in the existing discovery worker; Scrapling is an optional parser for already captured evidence.

## Runtime topology

```text
LENDER DISCOVERY UI          CUSTOMER DISCOVERY UI
          |                           |
          +------ same authenticated API ------+
                                                 |
                               Supabase Edge Function
                                  discovery-control
                                                 |
                              company + role + purpose
                                  policy checks
                                                 |
                              E02 source registry
                         exact provider / URL / fields
                                                 |
                           Connector Registry (E03/E04)
                 +---------------+---------------+--------------+
                 |               |               |              |
              Official API    Licensed API     Open Dataset   Permitted
              adapters        adapters         adapters       public pages
                 |               |               |              |
                 +---------------+---------------+--------------+
                                                 |
                                 bounded durable job queue
                                                 |
                             discovery fetch / extraction workers
                           Crawlee / Playwright / Scrapling / HTTP
                                                 |
                           normalise -> deduplicate -> provenance
                                                 |
                              LENDER or CUSTOMER result store
                                                 |
                         freshness + verification + review status
```

## Provider API adapter contract

Every provider adapter must be registered behind the existing `ConnectorRegistry`; no UI component calls a provider directly.

Required adapter metadata:
- `providerId`, `connectorKey`, `sourceId`, `modeFit` (LENDER/CUSTOMER), `workspaceFit`.
- `authType`, secret reference name (never the secret value), `termsUrl`, `licenceRef`, `allowedPurposes`, `allowedFields`.
- `rateLimitPerMinute`, `pageLimit`, `timeoutMs`, `maxRetries`, `refreshPolicy`.
- `healthStatus`, `lastAttemptAt`, `lastSuccessAt`, `nextRefreshAt`, `sourceAsOf`.

Adapter operations:
1. `healthCheck()` — check provider reachability without exposing credentials.
2. `search(query, context)` — bounded search using the approved schema and purpose.
3. `fetchEvidence(candidate, context)` — fetch only an exact approved origin/path.
4. `normalise(response)` — map provider-specific payload to the AXIVESTRA record contract.
5. `getFreshness(response)` — return provider timestamp/ETag/Last-Modified where available.

Normalised result envelope:
```json
{
  "providerId": "provider-key",
  "sourceId": "company-source-uuid",
  "mode": "LENDER",
  "workspaceKey": "property_loans",
  "externalRecordId": "provider-record-id",
  "canonicalUrl": "https://provider.example/record",
  "retrievedAt": "ISO-8601",
  "sourceAsOf": null,
  "contentHash": "sha256:...",
  "verificationStatus": "unverified",
  "fields": {},
  "fieldProvenance": {},
  "licenceRef": "approved-source-licence"
}
```

The same schema is used for CUSTOMER mode. A source result never becomes a verified lender, active loan product, buyer, procurement opportunity, investor, company status or contact without the relevant independent verification stage.

## Connector and repository decisions

| Component | Role | AXIVESTRA decision |
|---|---|---|
| Existing Supabase Edge Functions | Authenticated first-party API boundary | Use now; already present |
| Existing ConnectorRegistry | Provider adapter contract, policy and bounded execution | Use now; already present |
| Crawlee | Node-native HTTP/browser crawling | Reuse existing worker dependency; public/permissioned pages only |
| Playwright | JavaScript-rendered permitted pages and browser validation | Reuse existing dependency where needed |
| Scrapling | Adaptive parsing | Keep optional for captured evidence; not a search engine |
| Scrapy | High-volume Python HTTP crawling | Candidate for a separate worker only if throughput tests justify Python runtime |
| Apache APISIX | API gateway, key auth, quotas, routing, observability | Optional later; not required to duplicate current API boundary |
| Meltano | ELT orchestration and reusable taps | Candidate for bulk structured data pipelines, not the request-time discovery gateway |
| SearXNG | Self-hosted metasearch | Existing E03 connector; remains disabled until endpoint and server flag are configured |

Do not add all crawler libraries indiscriminately. Reuse current Crawlee/Playwright/Scrapling capabilities; add Scrapy or Meltano only after a connector gap and operational need are demonstrated. Review each exact upstream licence/version and transitive dependency before adoption.

## Source coverage strategy

### LENDER module
- Banks, NBFCs, HFCs and other regulated financial institutions: authoritative regulator registers and official institution websites.
- Public/private finance providers and loan products: official provider APIs/pages and licensed feeds.
- Funds, VCs, PE firms, family offices and investment firms: public filings, official firm sites, open directories and authorised APIs.
- Government finance schemes and institutional programmes: official government portals and datasets.

### CUSTOMER module
- Manufacturers, OEMs, Tier-1/Tier-2 suppliers, industrial machinery and automation companies.
- Automotive, aerospace, electrical, defence and medical-device companies where source and use permissions allow.
- Importers/exporters, distributors, procurement directories, tenders and public purchase opportunities.
- Company registry records, official websites, public product/capability pages and authorised business datasets.

### Paid providers
Use official APIs or licensed exports only when AXIVESTRA has the required subscription, scope and contractual permission. Credentials stay in server-side secrets. The UI displays connection state, quota and last successful refresh; it never exposes keys. Publicly accessible preview pages may be used only within their terms and field restrictions. No paywall, login, CAPTCHA, bot-control or licence bypass.

## Refresh and live-data rules

- Refresh is provider-specific and respects terms, rate limits, quotas and source freshness.
- Support manual refresh and scheduled refresh through the existing durable queue/orchestration worker.
- Persist attempt/success timestamps, source-as-of time, next due time, content hash, response status and safe error reason.
- Use idempotency keys, tenant/provider quotas, concurrency limits, retry caps, backoff and a global pause switch.
- Label records `LIVE`, `CACHED`, `STALE`, `FAILED` or `NOT_CONFIGURED`; never label cached or failed results live.
- Do not promise always-current data where the provider has no API, no update timestamp or restrictive refresh limits.

## Delivery sequence

1. Reuse current authenticated API, registry, E03/E04/E05 and worker queue; do not create a parallel data plane.
2. Expose provider connection and health status in the separate LENDER and CUSTOMER workspaces.
3. Add a provider adapter only after E02 source review and server-side credential configuration.
4. Add scheduled refresh using existing orchestration and freshness fields; test idempotency, quotas, tenant isolation and pause behaviour.
5. Run contract tests and worker integration tests; inspect CI before declaring ready.
6. Keep this work on the existing feature branch and draft PR. No merge, deployment, paid activation or production migration without owner approval.

## Acceptance criteria

- LENDER and CUSTOMER data remain mode-isolated while sharing the API gateway and connector runtime.
- All providers are represented by source records with explicit legal/terms review and field allow-lists.
- No provider credential reaches browser code, logs, audit details or result records.
- Failed or stale refreshes are visibly distinguished from successful live refreshes.
- Duplicate records retain source-level provenance and do not erase conflicting values.
- Unapproved sources cannot search or fetch; all jobs are company-scoped, bounded and auditable.
- Paid data is available only through an authorised API/export agreement.


## E03 search filter behaviour

The E03 search screen now uses a shared geography contract and a workspace/mode-specific filter catalogue:

- Geography scope: `state`, `india`, or `international`.
- `state`: one of India's 28 States or 8 Union Territories; the generated location query is `{State/UT}, India`.
- `india`: search location is `India`.
- `international`: optional country name; a blank country means global/international coverage.
- Amount-range inputs carry a selected currency code (INR, USD, EUR, GBP, AED, SGD, CAD or AUD).
- The filter catalogue defines a separate LENDER and CUSTOMER set for every one of the 16 AXIVESTRA workspace keys (32 combinations). Property Loans and Housing Loan include different product, collateral, borrower, tenure, LTV, property-value and purchase-stage filters.
- The UI submits the selected filter set to `discovery-control`; the backend validates geography and each field against that exact workspace/mode definition before building E03 search query terms.
- Search filters are included in the audit as geographic scope and field keys. Raw search text and filter values are not stored in the audit event.

The location is applied as a search-engine query constraint; it is not a geospatial guarantee or a verified boundary. Results remain unverified candidates until source evidence is captured and reviewed. India State/UT reference list: [Ministry of External Affairs — India at a Glance](https://www.mea.gov.in/india-at-glance.htm); the Ministry of Home Affairs annual report describes the eight Union Territories: [Annual Report 2024–25](https://www.mha.gov.in/sites/default/files/AREnglish_24032026.pdf).
