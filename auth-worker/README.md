# AXIVESTRA owner-controlled authentication

This Worker is the dedicated identity and device-approval service for AXIVESTRA. It uses Better Auth with Cloudflare D1; it does not use Supabase.

## Access policy

- Google sign-in (Gmail/Google account) and email/password registration.
- Registration creates an identity, not application access.
- Each browser/PC/mobile installation has a separate high-entropy device ID.
- Every new device starts as `pending`.
- Only the configured Owner account can approve, reject or revoke a device.
- The device must be approved for the signed-in identity. Guest devices are represented by a null user and must be approved separately.
- Account identity and device identity are checked independently.
- Owner decisions and device registration are audit logged.
- Public website routes do not require authentication; private application data must.

## Important security boundary

The Worker endpoints are the authentication and approval foundation. The current AXIVESTRA application still has Supabase-backed company/personal data and direct client-side Supabase queries. A UI-only check cannot secure those existing APIs. Before declaring the full app migrated, all private data reads/writes and file access must be moved behind authenticated Worker endpoints (or another backend that validates both the Better Auth session and approved device on every request), and the legacy Supabase data/auth path must be retired. Do not merge this as a completed Supabase removal.

## Cloudflare setup

1. Create a D1 database named `axivestra-access`.
2. Copy its database ID into `wrangler.jsonc`.
3. Install dependencies in this directory: `npm install`.
4. Generate Better Auth's core D1 schema from the checked-in config: `npx auth@latest generate --adapter kysely`. Review the generated SQL against the installed Better Auth version and place it before the custom device migration in the migration sequence.
5. Apply migrations: `npm run db:remote`.
6. Set secrets (never commit them):
   - `npx wrangler secret put BETTER_AUTH_SECRET` (use a cryptographically random value of at least 32 bytes).
   - `npx wrangler secret put OWNER_EMAIL` (the one email address that is the AXIVESTRA Owner).
   - `npx wrangler secret put GOOGLE_CLIENT_ID`
   - `npx wrangler secret put GOOGLE_CLIENT_SECRET`
7. In Google Cloud Console, create a Web OAuth client. Add the exact redirect URI: `https://YOUR-WORKER.workers.dev/api/auth/callback/google`. Add the production app origin as an authorised JavaScript origin.
8. Update `APP_ORIGIN` and `AUTH_BASE_URL` in Wrangler configuration.
9. Deploy with `npm run deploy`.

The Owner must sign in with Google using the exact configured Owner email and a verified Google email. Keep owner credentials under your control; do not create a general-purpose owner registration endpoint.

## API contract

All API calls use same-origin credentials and `x-axivestra-device` containing a random 256-bit per-installation ID. The raw ID is never stored in D1; only its SHA-256 digest is stored.

- Better Auth endpoints: `/api/auth/*`
- `POST /api/access/register-device` body: `{ "deviceId": "...", "label": "Office PC", "kind": "desktop" }`
- `GET /api/access/status`
- `GET /api/access/check` — returns 403 unless this account/device pair is approved.
- `GET /api/owner/devices` — Owner only.
- `POST /api/owner/devices/:id/approve`
- `POST /api/owner/devices/:id/reject`
- `POST /api/owner/devices/:id/revoke`
- `GET /api/owner/audit` — Owner only.

Guest mode must call `register-device` without a Better Auth session. It is not anonymous access to private data; it remains blocked until Owner approval.

## Remaining production requirements

- Configure verified email delivery before enabling mandatory email/password email verification.
- Add account-level approval if the policy later requires approving an identity separately from each device.
- Add rate limiting for device registration and owner decision endpoints, CAPTCHA/Turnstile for public guest registration, and alerting for suspicious attempts.
- Integrate the device check into every application data/API/file route before any private data is returned or mutated.
- Migrate the existing Supabase company, membership, personal workspace, records and storage data to D1/R2 or another explicitly selected backend. The current app cannot be called Supabase-free until this is complete.
- Add browser tests for pending/approved/rejected/revoked, guest and cross-account device cases.
