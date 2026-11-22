# AXIVESTRA — E04.2 durable discovery queue

**Branch:** `feat/discovery-durable-queue`  
**Depends on:** #74 source governance and #75 bounded execution controls  
**Status:** database migration and contract tests only; not deployed.

## Queue model

- Company-scoped jobs are linked to one profile and one source, both within the same company.
- An idempotency key prevents duplicate submissions within a company.
- Job states are queued, running, succeeded, failed and cancelled.
- Workers claim one job through a service-role-only RPC using `FOR UPDATE SKIP LOCKED`.
- Each claim creates a bounded worker lease. Heartbeats extend only a still-valid lease held by that worker.
- Expired leases are recovered; attempts are capped and retries use bounded backoff.
- A worker may reserve an outbound request only while it owns a live job lease for the same company and source.

## Cross-worker quota enforcement

Every outbound connector request must call `reserve_discovery_source_request` immediately before network I/O. The function serializes reservations by locking one quota row per source, then enforces the source's registered request limit over a rolling 60-second window. This is shared across workers and Edge Function instances using the same database.

The quota RPC returns an allow/deny result and retry-after seconds. A worker must not send the request when denied. The per-job in-memory limiter from E04 remains an additional local guard, not a replacement for this shared reservation.

## Security

- Browser roles have no table grants and no RPC execute permission.
- RPCs are granted to `service_role` only.
- Source must remain approved, profile must remain enabled, and the source must remain attached to the profile when a job is claimed.
- The source and job company IDs must match.
- Worker identity and unexpired lease ownership are checked before quota reservation and heartbeat.

## Remaining before live execution

1. Add a server-side job enqueue action with role/purpose/source/profile validation and idempotency handling.
2. Implement a worker that claims, heartbeats, reserves quota before every request, records evidence provenance, and finishes jobs.
3. Add PostgreSQL integration tests against a disposable Supabase/Postgres instance for concurrent claims, concurrent quota reservations, lease expiry and idempotency.
4. Add retention/deletion jobs and operational metrics.
5. Complete source-specific legal and terms review before enabling any adapter.

## Validation and release

The Node tests here validate migration contracts only; they do not substitute for PostgreSQL integration tests. CI runs discovery policy tests, queue contract tests, full regression, Deno type-check and web build. No migration is applied and no Edge Function or worker is deployed.
