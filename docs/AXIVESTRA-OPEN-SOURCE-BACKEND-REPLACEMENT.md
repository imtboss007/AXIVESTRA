# AXIVESTRA — open-source backend replacement assessment

**Status:** isolated prototype branch; no production cutover authorized or performed  
**Prototype:** infra/oss-backend/  
**Parent:** current AXIVESTRA search-readiness fixes

## 1. Decision

Prototype a modular PostgreSQL-centred stack:

- PostgreSQL remains the source of truth.
- Keycloak provides OIDC identity and browser/mobile sign-in.
- PostgREST provides table/RPC-style REST access with JWT role switching and PostgreSQL RLS.
- Hono provides the first-party API for workflows currently implemented as Supabase Edge Functions.
- SeaweedFS provides an S3-compatible object-storage target for documents and evidence.

This is a more compatible path than replacing PostgreSQL with a document database or adopting an integrated backend with a different data/API model. It is also more modular than a single all-in-one platform.

## 2. Why not use Appwrite or Nhost as the first replacement

Appwrite is a capable self-hosted application backend, but adopting it as the primary AXIVESTRA backend would introduce a different data model and API contract. Nhost combines PostgreSQL, Hasura GraphQL, authentication, storage and functions; it is a useful option, but would still require a broad migration from Supabase Auth/PostgREST/Edge Function interfaces. Neither is a drop-in replacement for the existing Supabase SDK calls.

The modular choice preserves PostgreSQL and a PostgREST-shaped query interface. Its cost is that identity, API and storage integration have to be operated and secured separately.

## 3. Compatibility findings from the AXIVESTRA code

The current frontend is materially coupled to the Supabase SDK:

| Existing integration | Observed use | Prototype replacement |
|---|---|---|
| Supabase Auth in src/AuthGate.tsx | getSession, onAuthStateChange, password sign-in, sign-up, password reset, user update and sign-out | Keycloak OIDC authorization-code flow with PKCE; account registration, reset and invitations need separate workflow design |
| Supabase query client in src/lib/supabase.ts | extensive .from() reads, inserts, upserts and RPC calls across cloud sync and workspaces | PostgREST for compatible table filters/CRUD; explicit repository adapters for SDK-specific behaviour and RPC differences |
| Supabase function calls in application modules | functions.invoke(...), including company invitation and WhatsApp proxy actions | Hono first-party API routes; port each action with the same authorization, validation and audit semantics |
| Discovery Edge Functions | discovery-control and orchestration endpoints use user JWT verification, admin/service-role operations, database RPCs and audit writes | Hono handlers with explicit database roles, RLS context, scoped service operations and preserved fail-closed checks |
| Discovery worker | uses Supabase service client for queue leasing, quota RPCs, evidence writes and job state | keep Crawlee/Playwright worker; replace DB client and RPC calls with a narrow worker API or dedicated least-privilege Postgres role |
| Supabase Storage | no direct supabase.storage.from(...) usage was found in the repository search | SeaweedFS S3 is a candidate for future evidence/document storage; do not migrate files until inventory and retention rules are known |

The app also has local-first storage and sync logic. That should remain intact during the backend transition.

## 4. Identity and tenant isolation model

The prototype uses Keycloak's UUID subject as the AXIVESTRA user ID. The local demo realm imports two synthetic users whose IDs also exist in the local auth.users compatibility table.

The access token includes:

- iss: exact Keycloak realm issuer
- aud: axivestra-api
- sub: UUID identity
- role: static authenticated database role

The role claim selects only the PostgreSQL execution role. It does not grant a company role. Company owner/admin/manager/staff permissions continue to come from company membership rows and RLS checks.

Both PostgREST and the Hono API establish the same transaction/session claims consumed by auth.uid(). Hono uses BEGIN, SET LOCAL ROLE authenticated and set_config('request.jwt.claims', ..., true); the role/claims are transaction-local so a pooled connection cannot retain one user's context for the next request.

No browser-supplied company_id is accepted as proof of membership.

## 5. Prototype test boundaries

The Compose stack uses local-only Docker volumes and synthetic data:

- one synthetic LENDER user/company
- one synthetic CUSTOMER user/company
- one synthetic probe record per company
- no company source registry rows or real prospects
- no production endpoint or hosted database credentials

The smoke suite obtains demo tokens, checks the API and PostgREST responses, attempts cross-tenant reads and expects empty results, then performs and removes a synthetic S3 object.

The bootstrap schema is deliberately small. Passing its test does not prove the complete AXIVESTRA schema has been migrated.

## 6. Migration sequence before any cutover

1. **Inventory and contract capture.** Enumerate every .from(), .rpc(), Auth method and functions.invoke() call, including services and Electron/mobile code. Capture request/response/error semantics.
2. **Identity mapping.** Design Keycloak subject-to-existing-user mapping, password reset, email verification, MFA, invitation, account disablement, token revocation and audit requirements. Do not migrate password hashes without a reviewed, supported procedure.
3. **Database compatibility.** Port Supabase-specific schemas, functions, extensions, triggers, roles, RLS policies and foreign keys to a vanilla PostgreSQL bootstrap. Preserve the existing UUIDs and membership model. Verify every table's RLS with at least two tenants and each role.
4. **Query adapter.** Introduce a single AXIVESTRA data/auth client adapter. Map supported .from() operations to PostgREST and document differences in filters, errors, upserts, pagination, realtime and RPC.
5. **Function API.** Port Edge Function actions into versioned Hono routes. Preserve validation, admin boundaries, audit events, rate limits, idempotency and fail-closed behaviour. Do not expose service credentials to browser/mobile clients.
6. **Worker migration.** Replace the worker's direct service-role client with explicit internal endpoints or an isolated database role. Retain queue leases, atomic quota reservations, SSRF/DNS controls, robots handling, source approval and evidence provenance.
7. **Storage adapter.** Add S3-compatible upload/download, tenant-specific object keys, signed URL policy, encryption, retention and audit. Inventory current evidence/file stores before moving anything.
8. **Parallel validation.** Run current Supabase and prototype against separate synthetic fixtures. Compare results, auth decisions, RLS behaviour, queue transitions, evidence hashes and audit events.
9. **Controlled cutover.** Only after user approval: backup, rehearsal, change freeze, migration, rollback verification, DNS/client configuration and security sign-off.

## 7. Explicit non-goals for this prototype

- no deployment, merge, production migration or change to Render/Supabase settings
- no real company data or account import
- no automated source registration or public-search activation
- no deletion of the existing Supabase implementation
- no replacement of the Android/Windows app or local-first sync
- no promise of feature parity until each API/auth/worker contract is ported and tested

## 8. Upstream repositories and versions checked

| Project | Repository | Prototype version | Licence |
|---|---|---:|---|
| PostgREST | https://github.com/PostgREST/postgrest | v16.6 | MIT |
| Keycloak | https://github.com/keycloak/keycloak | 26.8.2 | Apache-2.0 |
| SeaweedFS | https://github.com/seaweedfs/seaweedfs | 4.55 | Apache-2.0 |
| Hono | https://github.com/honojs/hono | 4.13.23 | MIT |

Versions were checked against the upstream GitHub release pages on 2026-11-28. Recheck security advisories and update pins before a production rollout. PostgreSQL remains under its own PostgreSQL Licence.

## 9. Current prototype status

The Compose stack, realm import, synthetic RLS schema, Hono API and end-to-end smoke test are staged on the isolated Git branch. GitHub Actions validation is required before treating this stack as a working prototype. The main AXIVESTRA app remains connected to its current backend.
