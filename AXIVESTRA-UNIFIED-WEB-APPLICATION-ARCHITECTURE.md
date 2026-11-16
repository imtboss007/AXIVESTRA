# AXIVESTRA — Unified Website & Application Architecture

**Status:** Architecture decision and implementation specification  
**Prepared from:** Repository review of `main` and draft PR #70  
**Product baseline:** AXIVESTRA v1.1.12 — Multi-Asset, Capital & Relationship Intelligence Operating Platform  
**Decision:** One AXIVESTRA website, one application interface, one identity and one connected operating experience.

## 1. Architecture decision

AXIVESTRA must be delivered as **one unified web application**, not as a marketing website plus a second, disconnected business application.

The existing AXIVESTRA application is the product source of truth. The existing React application, especially `src/App.tsx`, owns the authenticated product experience and must remain the source of truth for:

- Asset Intelligence Overview — the default post-login home.
- Intelligence Hub and explainable cross-domain analysis.
- The existing 16 domain workspaces.
- Shared operational workspaces and their linked records.
- Workspace Explorer as an optional navigation experience, not the product home.
- The established AXIVESTRA visual system, controls, workflows and responsive behaviour.

The public website, sign-in, application, Owner access controls, site-content administration and integrations must be routes and capabilities within the same AXIVESTRA product and origin. They must not become separately designed products or require a second login.

**Non-negotiable rule:** After successful sign-in and device authorization, the browser must open the same AXIVESTRA application experience that the user receives in the Windows desktop product. Mobile may rearrange navigation and panels for its screen, but must retain the same product identity, data, modules and workflows.

## 2. Repository audit — current state

This is a source-code and documentation audit, not a live-production certification.

### 2.1 Existing application on `main`

| Area | Observed implementation | Architecture implication |
|---|---|---|
| Web entry | `src/main.tsx` renders `AuthGate` | The primary website already enters the real application. |
| Authentication gate | `src/AuthGate.tsx` uses Supabase Auth, restores sessions, supports sign-in/sign-up/recovery, loads company memberships and allows personal/company workspace selection. | This is the existing login and workspace lifecycle. It cannot be replaced by a second login without migrating the underlying identity and data contracts. |
| Local mode | `AuthGate` retains explicit local-only mode; when Supabase client configuration is absent it currently renders `App` directly. | Preserve local-first records and offline behaviour. Review the missing-configuration fallback before enabling hosted access controls; never let a configuration error expose private cloud data. |
| Main product UI | `src/App.tsx` implements the existing shell, Asset Intelligence Overview, navigation, records and workspace workflows. | Reuse the existing UI; do not recreate a similar-looking dashboard in another package. |
| Domain workspaces | Sixteen workspaces are defined in `src/App.tsx` and documented in `AXIVESTRA-PRODUCT-ARCHITECTURE.md`. | All 16 must remain available and retain their existing fields and records. |
| Data and sync | The application uses local storage/IndexedDB and Supabase-backed personal/company records and membership/RBAC flows. | Authentication alone is not the data layer. Any backend migration must include sync, role enforcement and existing IDs. |
| Desktop/mobile | The repository packages the same web build for Electron/Windows and Capacitor/Android. | Keep one shared product implementation with platform adapters, not separate interface products. |
| Product definition | `AXIVESTRA-PRODUCT-ARCHITECTURE.md` defines the intelligence layer over a connected system of record and places Asset Intelligence Overview first. | This remains the canonical product definition. |

### 2.2 Draft PR #70

PR #70 is titled **“Add AXIVESTRA public website and D1 owner-controlled access foundation.”** Its changes introduce:

- A separate React/Vite application under `website/`, with separate homepage, styles, admin route and website database tables.
- A Better Auth + Cloudflare D1 Worker for Google/email-password identity and per-installation device approval.
- Static `/access.html` and `/owner-access.html` pages.
- A same-origin Pages Function proxy and a device client helper.

The PR documentation itself records the critical integration boundary: the new D1 Worker is not wired into the existing `AuthGate`; the application still uses Supabase Auth, membership/RBAC, direct Supabase queries and storage. The public website package also uses Supabase for its separate content/admin tables.

The branch comparison against `main` reported **63 commits ahead and 2 commits behind**, with a diverged history. It must be reconciled with current `main` before any integration review.

### 2.3 Material gaps and risks

1. **Two separate front ends:** `website/src/main.tsx` creates a separate public-site experience. Deploying it as the primary AXIVESTRA website would not make the existing PC application interface the website interface.
2. **Two identity systems:** the current app uses Supabase Auth; the draft introduces Better Auth. They do not automatically share users, sessions, password hashes, company memberships or role claims.
3. **Device check is not an application security boundary yet:** the device helper is not called by the current `AuthGate`, and the current app data operations have not been moved behind Worker APIs that enforce the device check.
4. **Data access remains Supabase-dependent:** direct client database requests and existing Row Level Security remain part of the product. A visual login switch or a successful device-check call would not secure those requests.
5. **Existing data and sync must be preserved:** company/personal workspaces, membership roles, records, contacts, tasks, financials, risks, approvals, local IndexedDB documents, paired-device sync and backup/restore all need migration/compatibility coverage before Supabase can be retired.
6. **Email verification is unfinished in the draft:** the Worker README says password signup is not yet email-verified and requires owner-side identity verification until delivery is configured.
7. **Deployment is not complete:** the draft still has a placeholder D1 database ID and requires D1 migrations, Worker secrets, Google OAuth configuration, Pages environment configuration and end-to-end tests.

**Audit conclusion:** Do not merge PR #70 unchanged and do not switch `AuthGate` to Better Auth yet. Reuse its useful identity/device-approval work only as part of a complete, tested migration.

## 3. Target single-website experience

One origin and one deployed application should serve the public and authenticated experiences.

| Route / area | Purpose | Access |
|---|---|---|
| `/` | Public AXIVESTRA entry, product information and sign-in entry. This is the front door to the same product, not a second application. | Public |
| `/app` | Existing AXIVESTRA application shell. After access is granted, open Asset Intelligence Overview by default. | Authenticated + approved device, or the explicitly supported local-only mode |
| `/app/*` | Deep links to existing workspaces and shared operating areas. Preserve route state and selected workspace on refresh. | Same as application |
| `/owner/access` | Device requests, approval/rejection/revocation and access audit, rendered in AXIVESTRA's existing interface. | Owner only |
| `/settings/integrations` | Connected services, account authorizations, connection health and disconnect controls. | Role controlled |
| `/settings/site-content` | Manage public website copy, published pages and enquiries from the same product shell. | Owner / authorized administrator |

The exact route implementation may follow the application's current routing conventions, but there must be one SPA build, one shared design system and one session lifecycle. A route is not permission: every private operation must still be authorized server-side.

### 3.1 Public-to-application flow

1. A visitor opens the AXIVESTRA website.
2. The visitor can read public product information and choose Google sign-in, email/password sign-in or the explicitly approved guest-device path.
3. A new device is registered and remains pending until the Owner approves it.
4. An authenticated account must also pass the account/device approval check. A guest device is recorded and approved independently, without being represented as an authenticated user.
5. Pending, rejected, revoked, mismatched and unregistered states must be explained clearly; none may render private application data.
6. After approval, the user enters the existing AXIVESTRA application shell and lands on **Asset Intelligence Overview**.
7. Sign-out ends the session and returns to the AXIVESTRA public entry.

Do not introduce a second website login for site administration or Owner device approval. Use the same identity with stronger, role-specific authorization.

### 3.2 Preserve the actual product home

The authenticated home is not a generic tile board. It is the established Asset Intelligence Overview described in the canonical architecture: a connected view of assets, capital, exposure, pipeline, risk, obligations, milestones, approvals and data quality, with facts and derived values labelled accurately.

The optional Workspace Explorer remains an optional way to navigate the 16 workspaces. It must not replace the overview or act as a substitute for working domain capabilities.

## 4. Shared interface across browser, Windows and Android

Use the existing application components and design tokens as the source of truth.

- **Browser:** serves the full AXIVESTRA application.
- **Windows:** existing Electron shell loads the same built application.
- **Android:** existing Capacitor shell loads the same built application.
- **Mobile browser / tablet:** the same application adapts layout, menus, tables and forms to available screen space.

Responsive behaviour may change the arrangement, not the product. Do not remove capabilities merely because the user is on a phone. Preserve keyboard support and desktop density on PC; preserve touch targets, safe-area spacing and usable forms on mobile.

Any public page, sign-in form, integration view or Owner tool added to the browser must use the same AXIVESTRA brand and shared components. Avoid a second header, unrelated colour system, separate product navigation or duplicate application home.

## 5. Identity, device approval and authorization

### 5.1 One identity lifecycle

The target is one identity/session authority for the website and application. Google and email/password sign-in, password recovery, guest-device registration and Owner-controlled approvals must be surfaced through the same origin.

Existing Supabase user IDs and Better Auth user IDs are not interchangeable. Define a stable identity mapping and account-linking/migration procedure before changing the sign-in provider. Do not assume existing password hashes can be copied into a different authentication system. Plan explicit Google re-linking and/or password reset where required, with account recovery and duplicate-account handling.

### 5.2 Device approval

- Each browser/PC/mobile installation has its own high-entropy installation identifier.
- Bind an authenticated device to the authenticated account; bind a guest device to a guest identity record.
- New devices start pending.
- Only the configured Owner can approve, reject or revoke devices.
- Revocation must take effect at the server boundary, not just after a page refresh.
- Record registration, approval, rejection, revocation, actor, target, timestamp and relevant device metadata in an audit trail.
- A browser-stored device ID is an installation identifier, not hardware-backed proof. Consider passkeys/WebAuthn as a stronger later binding.
- Apply abuse controls, rate limits and appropriate bot protection to public guest registration and sensitive Owner actions.

### 5.3 Enforce authorization on every private request

The backend must validate the user session, device approval, company/personal scope and role for every private data/API/file operation. A hidden button, client route guard or one-time `/api/access/check` at page load is not sufficient.

The existing owner/admin/manager/staff/read-only boundaries must be preserved and translated into the target authorization model. Guests must receive only the specifically approved guest scope; they must not inherit an authenticated account's permissions.

## 6. Data and backend migration

The proposed free-first target is Cloudflare Workers for authenticated APIs, D1 for relational identity/application data where suitable, and R2 for document/file objects. Cloudflare Pages can serve the unified web build. GitHub remains the source repository and CI system.

This is a target design, not a statement that the existing product has already moved.

Required migration work:

1. Inventory every Supabase table, view, RPC, Edge Function, RLS policy, storage bucket and direct client query used by the app.
2. Map existing IDs, ownership, company memberships, roles and relationships to a versioned target schema. Preserve personal and company boundaries.
3. Design Worker API contracts for every read/write operation and enforce session + approved device + tenant/role scope in the Worker.
4. Migrate records, file objects and metadata with stable ID mapping. Preserve document-vault behaviour, local-only data, backups and device-sync reconciliation.
5. Build repeatable, idempotent migration tooling, record counts, checksums, exception reports, restore/rollback procedures and an owner-approved cutover plan.
6. Replace direct Supabase data access with the Worker API adapter. Do not leave a browser-side Supabase bypass for private data.
7. Test company isolation, personal workspace isolation, roles, pending/revoked devices, guest restrictions, offline mode, conflict resolution and multi-device sync.
8. Only after the migrated data path passes acceptance tests may Supabase access be disabled and the app be described as Supabase-free.

Do not force local-only records into a cloud account. Keep local-only and cloud datasets distinct unless the user explicitly selects an import/migration action. Never silently merge, overwrite or delete existing records.

Before committing to D1 for every application table, verify dataset size, relational query patterns, transaction needs, indexing, growth and free-tier quotas. If a workload cannot safely fit the selected service, document a lawful free/open alternative and obtain approval before introducing a paid dependency.

## 7. External website and service integrations

AXIVESTRA should connect to external services from inside the existing application. Create a shared **Integrations** capability rather than creating separate AXIVESTRA-branded copies of every external website.

For each integration, record:

- Provider, purpose and the AXIVESTRA workspace(s) that use it.
- Connection method: API, OAuth/SSO, webhook, or external link.
- Authorized account/organization, scopes and consent.
- Server-side token/secret storage; never expose private credentials in browser code.
- Data source, refresh/update time, provenance and connection health.
- User who connected/disconnected it, audit history and failure state.
- Disconnect and credential revocation controls.

Where a provider offers a supported API, show relevant provider data inside the appropriate AXIVESTRA workspace. Where a provider supports SSO, use its supported identity flow. Where no integration or embedding support exists, open the provider site in a new tab with a clear return path. Do not scrape credentials, automate around access controls or assume every external site can be embedded in an iframe.

Third-party data must be labelled with its source, retrieval time, licence/usage limits and verification state. An external link alone is not a connected data integration.

## 8. Public website content and administration

Retain the useful public content work from PR #70, but integrate it as public routes and protected Owner/admin functions in the main AXIVESTRA application.

- Public pages use the same AXIVESTRA brand and lead to the existing sign-in/application flow.
- The Owner/admin editor lives inside the existing Settings area and uses the same identity/session.
- Enquiry records remain isolated from operational business records, with clear retention and access policies.
- Public forms require server-side validation, abuse/rate limiting and bot protection before high-traffic promotion.
- Do not add a separate public-site Supabase login/database if the end-state is the D1/Workers architecture.
- Public content administration must not grant access to property, investor, legal or financial records.

## 9. Recommended delivery sequence and gates

### Gate 0 — Architecture and branch reconciliation
- Accept this document as the integration specification.
- Rebase/reconcile PR #70 with current `main`; inspect its 63-ahead / 2-behind history.
- Keep PR #70 draft until its separate website deployment and auth/data-boundary assumptions are corrected.
- Do not merge or deploy during this gate.

### Gate 1 — One front door, existing app unchanged
- Bring public landing/content routes into the main application build.
- Keep the existing `AuthGate` and application data path operating until a replacement is ready.
- Preserve `src/App.tsx`, all 16 workspaces, current data, local mode and current desktop/mobile behaviour.
- Make sign-in lead to the existing Asset Intelligence Overview.
- Retain the current production hostname until a new domain is owned, configured and tested.

### Gate 2 — Backend and identity migration
- Finish the full data/API/storage inventory and target schema.
- Implement Worker APIs, identity mapping, device approval and role/tenant authorization.
- Migrate data and account access with reconciliation and rollback evidence.
- Move the app off direct Supabase data access before switching the production authentication gate.

### Gate 3 — Integrations
- Implement the integration registry, provider connection flows, server-side credential protection, provenance, audit and disconnect behaviour.
- Add provider-specific integrations only after their API/SSO terms, scopes and reliability have been checked.

### Gate 4 — Cross-platform acceptance
- Validate website, Windows and Android using the same seeded records and account.
- Test desktop and mobile layouts, offline/local-only behaviour, backup/restore, device approval and revocation, role boundaries, external integrations and navigation restoration.
- Test fresh install, existing-user migration and recovery scenarios.

### Gate 5 — Owner-approved release
- Complete security review, migrations, tests, quotas and rollback plan.
- Obtain explicit Owner approval before production merge, DNS change or deployment.
- Monitor authentication, API errors, data sync, access audit and storage after release.

## 10. Release acceptance checklist

- [ ] The website and Windows product show the same authenticated AXIVESTRA interface and Asset Intelligence Overview.
- [ ] There is only one public website origin and one application deployment; no duplicate website product is required to use the app.
- [ ] One sign-in/session works across the website and supported app surfaces.
- [ ] New authenticated and guest devices remain blocked until Owner approval.
- [ ] Pending, rejected, revoked and account-mismatch devices cannot retrieve private records or files.
- [ ] The Owner alone can approve/reject/revoke devices and review the access audit.
- [ ] All 16 domain workspaces and shared operational areas remain present.
- [ ] Existing local, personal and company records remain intact and correctly scoped.
- [ ] Company roles, personal workspace boundaries and read-only restrictions are enforced server-side.
- [ ] PC/mobile sync, backup/restore and offline/local-only behaviour pass regression tests.
- [ ] External service data is connected through authorized APIs/SSO, or clearly opened externally when integration is unsupported.
- [ ] Public content and enquiry administration is protected and does not expose operational data.
- [ ] No production deployment, data migration cutover or Supabase retirement occurs before Owner approval and successful acceptance.

## 11. Explicit non-goals

- No generic SaaS tile dashboard in place of the real Asset Intelligence Overview.
- No new visual identity or duplicate navigation system.
- No separate website application that competes with `src/App.tsx`.
- No immediate replacement of `AuthGate` with Better Auth before the data/API migration.
- No claim that D1, Workers, R2 or the current Worker are deployed or fully configured.
- No blind iframe embedding of external websites.
- No destructive database migration, data reset, silent merge or automatic deletion.
- No merge, DNS change or production deployment without explicit Owner approval.

---

**Final architecture rule:** AXIVESTRA is one product and one connected website. Its public front door, login, Asset Intelligence application, Owner access controls, site administration and integrations belong to one application experience. The existing AXIVESTRA PC application is the interface reference and functional source of truth; the website must deliver that same product after login.
