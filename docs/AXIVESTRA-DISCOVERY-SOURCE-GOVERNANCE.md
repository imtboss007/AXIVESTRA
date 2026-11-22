# AXIVESTRA — Discovery Source Governance (E02 / E03)

**Branch:** `feat/discovery-source-governance`  
**Base:** `feature/axivestra-enterprise-experience` at `db014c6fc81d7cf082993dbd353ac9691fd962a9`

## What this slice implements

- Company-scoped source registry with exact HTTPS host and path policies.
- New sources always start as `pending`; the registry does not fetch them.
- Only company owners/admins can register, approve, pause or reject sources.
- Approval requires a terms/licence reference, permitted-use rationale, attribution, allowed fields, allowed purposes, exact allowed paths, quotas and retention.
- Sixteen workspace profiles support separate `LENDER` and `CUSTOMER` configurations; profiles are disabled by default.
- A source must be approved before it can be attached to a profile.
- Personal Loan / CUSTOMER external person-discovery is blocked; inbound, referred, user-entered or consented borrower intake remains a separate product workflow.
- Connector contracts support official APIs, licensed APIs, open datasets, permitted public pages and manual research. No connector is installed by default.

## Server API

Deploy the Supabase Edge Function `discovery-control` only after applying the migration and configuring the existing Supabase Auth project. It uses the authenticated user's JWT and checks company membership and owner/admin role server-side.

POST actions:

- `sources.list`
- `sources.register`
- `sources.review`
- `profiles.list`
- `profiles.upsert`
- `profiles.attach-source`
- `profiles.detach-source`

Request envelope:

```json
{
  "companyId": "authenticated-company-uuid",
  "action": "sources.register",
  "payload": {
    "name": "Official company registry",
    "canonicalUrl": "https://registry.example.gov/api",
    "sourceType": "official_api",
    "jurisdiction": "IN",
    "termsUrl": "https://registry.example.gov/terms",
    "licenseRef": "Exact terms/licence reference",
    "allowedPaths": ["/api/v1/entities"],
    "allowedPurposes": ["company identity verification"],
    "allowedFields": ["legal_name", "registration_id"],
    "attribution": "Source: official company registry"
  }
}
```

Every registration remains pending, even when an initial licence reference is supplied. Approval is a separate owner/admin action with an explicit legal basis and reviewed policy. Do not register guessed or wildcard domains.

## Connector contract

`supabase/functions/_shared/discovery-connector-registry.mjs` defines the adapter registry and verifies:
- source status is approved;
- connector key is one of the five supported types;
- target URLs use HTTPS and the exact approved hostname;
- target paths remain within explicitly approved path prefixes;
- query/result limits stay within configured bounds.

The connector registry is empty by default. This is deliberate: E02/E03 establishes governance and adapter contracts. E04 must add bounded fetch workers and actual provider-specific integrations only after source review.

## Deploy sequence (not performed)

1. Apply `supabase/migrations/20261122150000_discovery_source_governance.sql` to the correct Supabase project.
2. Deploy `supabase/functions/discovery-control`.
3. Verify owner/admin and read-only roles with separate test users/companies.
4. Register one non-sensitive test source as pending; verify it cannot be attached or fetched.
5. Approve it only after a human reviews its exact terms, data rights, purpose, fields, paths, quotas and retention.
6. Attach it to one disabled pilot profile. Keep the profile disabled until a provider adapter exists and tests pass.

## Explicit non-goals

This slice does not crawl the internet, scrape LinkedIn, bypass logins/CAPTCHAs, harvest personal contacts, validate contact consent, run AI matching, create lead records, send outreach, or deploy/merge anything. No external website or provider is activated by this commit.

## Checks

Run `npm run test:discovery` for the policy/connector tests and `npm test` for the full existing test chain. Supabase migration and Edge Function deployment remain manual acceptance gates.
