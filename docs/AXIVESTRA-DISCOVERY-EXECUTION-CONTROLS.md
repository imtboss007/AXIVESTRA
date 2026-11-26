# AXIVESTRA — E04 bounded discovery execution controls

**Implementation branch:** `feat/discovery-bounded-execution`  
**Depends on:** draft PR #74, `feat/discovery-source-governance`  
**Status:** execution-policy foundation only; no worker or provider is activated.

## Implemented in this increment

- Each connector job must use a session bound to one approved source and a job ID.
- Per-job connector calls are spaced using the source's declared requests-per-minute value.
- Evidence fetches are capped by the source's `max_pages_per_job` budget.
- Total connector calls per job are bounded to the page budget plus five search/control calls.
- Each connector operation receives an `AbortSignal` and has a bounded timeout.
- Retries are disabled by default and occur only when an adapter marks an error `retryable: true`; retry count is capped at two.
- Search adapters cannot return more rows than the caller's approved result limit.
- Requested purposes must match the exact approved purpose list.
- Evidence provenance records the job, source, connector, exact URL, retrieval time, allowed purpose, observed fields, terms/licence reference, legal basis and attribution.
- Observed fields outside the approved field allow-list are rejected.

## Important enforcement boundary

The session enforces limits inside one job execution. It is not a distributed rate limiter: concurrent jobs or multiple Edge Function instances still require an atomic server-side quota lease and durable queue before production traffic is enabled. This increment deliberately does not pretend an in-memory session can enforce cross-worker quotas.

No connector is registered by default. No external host is contacted by this code change. Actual adapters, durable job queue, atomic source quota accounting, source-specific credential handling and provider acceptance tests remain separate gates.

## Validation

Run `npm run test:discovery`, `npm test`, `deno check supabase/functions/discovery-control/index.ts` and `npm run build`.

## Release boundary

No Supabase migration or Edge Function deployment is performed by this increment. It is a stacked draft change on PR #74 and must not be merged ahead of its dependency.
