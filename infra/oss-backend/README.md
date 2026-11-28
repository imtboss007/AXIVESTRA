# AXIVESTRA open-source backend prototype

This directory contains an isolated local proof-of-architecture, not a production deployment.

It tests an open-source alternative to the hosted Supabase backend and demonstrates company-level row isolation with two synthetic tenants. It does not connect to, export from, migrate, or modify the hosted AXIVESTRA project.

## Selected stack

| Responsibility | Component | Pinned prototype version | Upstream licence |
|---|---|---:|---|
| Relational database | PostgreSQL | 17 Alpine series | PostgreSQL Licence |
| Identity and OIDC | Keycloak | 26.8.2 | Apache-2.0 |
| REST and database role switching | PostgREST | 16.6 | MIT |
| Application/function API | Hono + Node.js | Hono 4.13.23 | MIT |
| Object storage | SeaweedFS | 4.55 | Apache-2.0 |

PostgREST verifies Keycloak-signed RS256 access tokens using the realm public JWK set. A fixed role=authenticated claim selects the PostgreSQL authenticated role; company access is still decided by PostgreSQL RLS policies, not by a client-supplied company ID.

Hono validates the same issuer, audience and signing algorithm, then runs database work inside a transaction with transaction-local JWT claims and SET LOCAL ROLE authenticated.

SeaweedFS exposes an S3-compatible endpoint for a future evidence/document adapter. The smoke test writes and reads a synthetic object and removes it afterward.

## Start on a computer with Docker Compose

1. Copy .env.example to .env.
2. Keep the sample values only for a local disposable test. They are not production secrets.
3. Run from this directory:

    docker compose up --build -d
    docker compose exec -T api node smoke.mjs

The smoke suite checks both demo users, the Hono API, PostgREST queries, tenant isolation and an S3 put/get/delete round trip.

Stop and delete all prototype database, identity and object-store volumes:

    docker compose down --volumes --remove-orphans

Published ports are bound to loopback only:

- Keycloak: http://localhost:8180
- PostgREST: http://localhost:8300
- Hono API: http://localhost:8380
- SeaweedFS S3: http://localhost:8333
- PostgreSQL: localhost:55432

The demo accounts are lender.demo and customer.demo. Their passwords are synthetic values in the imported local realm. The axivestra-test client enables the password grant only to automate this local smoke test. The browser client uses authorization code + PKCE and has no direct password grant. Do not copy the test client or demo passwords into a shared environment.

## What this prototype proves

- Keycloak can issue an RS256 token with an AXIVESTRA API audience and the PostgREST database-role claim.
- PostgREST accepts the Keycloak JWT and executes queries as the authenticated database role.
- Hono validates a Keycloak token and queries through a separate non-owner PostgreSQL login.
- Both data paths use the same auth.uid() compatibility function and PostgreSQL RLS policy.
- A LENDER demo user cannot read the CUSTOMER demo company's rows, and vice versa.
- The S3-compatible object endpoint can complete a local object round trip.

## Explicit limitations

- The bootstrap SQL creates only a small compatibility fixture (auth.users, companies, company_memberships and oss_backend_probe_records). It does not apply all AXIVESTRA Supabase migrations.
- It does not migrate any production user, password, company, profile, evidence or financial record.
- It does not yet port the full discovery-control action catalogue or the discovery worker's Supabase RPC contracts.
- It does not replace src/AuthGate.tsx, the existing Supabase client wrapper, or current desktop/mobile builds.
- It does not implement user invitation, sign-up email delivery, password reset, token revocation, production key rotation or multi-node operations.
- SeaweedFS is wired as an isolated storage option; existing AXIVESTRA local-first and evidence storage flows are not yet changed.
- Production must use HTTPS, secure secrets, a protected Keycloak admin account, backups, rotation/revocation procedures, least-privilege S3 policies, monitoring and a reviewed migration plan.

## Key rotation

The local keycloak-jwks-init service downloads current RS256 public keys when the stack starts. After changing the Keycloak signing key in a persistent environment, refresh the JWK file and restart/reload PostgREST before accepting tokens signed by the new key. A production implementation must automate and test overlapping old/new key rotation; this local one-shot bootstrap is not that production mechanism.

## Useful commands

    docker compose config -q
    docker compose logs --tail=100 keycloak postgrest api seaweedfs
    docker compose exec -T api npm test
    docker compose exec -T api node smoke.mjs
    docker compose down --volumes --remove-orphans
