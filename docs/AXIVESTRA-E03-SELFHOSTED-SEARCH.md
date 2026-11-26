# AXIVESTRA E03 — self-hosted public-directory search

## What this adds

The optional E03 search preview turns the selected LENDER/CUSTOMER workspace profile into up to four bounded organisation-level queries. It asks a separately operated SearXNG service for JSON search results and returns a maximum of 30 URL candidates to the existing AXIVESTRA review/queue screen.

Search output is **not evidence, identity verification, a verified lender/customer, or permission to contact**. Each result is marked `unverified_candidate`. An E03 result can be added to E04 only where the server matched its exact HTTPS origin and path against a source already approved and attached to that workspace profile. Other domains must go through the source registry and owner/admin terms review first.

## Separation and licensing

- SearXNG is AGPL-3.0 software. Run it as a separate self-hosted service or separately managed endpoint; AXIVESTRA calls its HTTP JSON API and does not embed SearXNG source code. Review obligations with counsel before a proprietary commercial deployment.
- The AXIVESTRA adapter is a small API client in `supabase/functions/_shared/discovery-search-connectors.mjs`; it is not a SearXNG distribution or service.
- Do not use public/shared metasearch instances as a production data source. Use a self-hosted instance under the operator's control and review its upstream search engines, privacy, logging, retention and request policy.
- The SearXNG JSON API uses `GET /search?q=...&format=json`. Enable the JSON format in that instance's own `settings.yml` (for example, include `json` in `search.formats`). Some instances disable JSON output.
- Use only the upstream SearXNG repository and documentation; no paid search provider is activated by this change.

## AXIVESTRA activation boundary

The search path is disabled unless the Supabase Edge Function environment has:

- `DISCOVERY_SEARXNG_ENABLED=true`
- `DISCOVERY_SEARXNG_URL=https://your-controlled-search-host.example`
- Optional `DISCOVERY_SEARXNG_BEARER_TOKEN` when the self-hosted endpoint is protected by a compatible reverse proxy.

These are server-side Edge Function secrets only. Never add them to Vite, the browser, Android, Electron, a public `.env` file, or source control. Do not use `VITE_`-prefixed variables for the endpoint or token.

The connector requires HTTPS and a hostname endpoint. It rejects IP-literal/local/private-style hostnames, non-HTTPS results and common person-centric social-network domains. It also strips email/phone patterns from result snippets. Queries are derived from workspace target classes plus bounded location, sector and product filters; arbitrary endpoint URLs cannot be supplied by a browser request.

## Operating sequence

1. Deploy/review the Edge Function through the normal controlled release process. This PR does not activate the SearXNG variables.
2. Separately deploy a SearXNG instance, configure its JSON output and put it behind HTTPS. Review enabled upstream engines, logging/retention and access controls.
3. Add the three server-side variables to the intended Supabase project only after service and privacy review. Leave the feature flag unset/false until authorised.
4. In AXIVESTRA, an owner/admin must register and review the exact official/licensed source, allowed purpose, fields, host/path, terms and attribution; attach it to an enabled workspace profile.
5. A signed-in company member may use **Search public directories** for that enabled profile. Results remain unverified; the server tags only exact matches to already attached approved source paths as fetch-eligible.
6. The user explicitly adds a fetch-eligible result URL to the E04 draft and separately submits the bounded E04 job. E04 still checks source, purpose, HTTPS origin/path, rate/page limits and company permission at enqueue and again at worker execution.
7. Review captured evidence and extracted facts, then accept/reject/qualify them through the existing human-review workflow. Do not automate outreach.

## Not enabled by this change

No SearXNG server is provisioned or called by default. No source is automatically registered/approved, no unapproved URL is fetched, no search result is converted directly into a lead, no private individual/contact database is scraped, and no provider/worker/production database is activated by this code change.
