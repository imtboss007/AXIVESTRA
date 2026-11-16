# AXIVESTRA owner-controlled authentication

This Worker is the dedicated identity and device-approval service for AXIVESTRA. It uses Better Auth with Cloudflare D1 and does not use Supabase.

## Access policy

- Google sign-in (Gmail/Google account) and email/password registration.
- Registration creates an identity, not application access.
- Each browser/PC/mobile installation has a separate high-entropy device ID.
- Every new device starts as `pending`.
- Only the configured Owner account can approve, reject or revoke a device.
- The device must be approved for the signed-in identity. Guest devices have no user identity and must be approved separately.
- Owner decisions and device registration are audit logged.
- Public website routes remain public; private app data must require a successful server-side device check.

## Security boundary and migration status

The Worker endpoints are the authentication/device-approval foundation. The current AXIVESTRA application still has Supabase-backed authentication, company/personal data and direct client-side Supabase queries. A UI-only check cannot secure those existing APIs. Before declaring the full app migrated, all private data reads/writes and file access must be moved behind authenticated Worker endpoints (or another backend that validates both the Better Auth session and approved device on every request), and the legacy Supabase data/auth path must be retired. Do not merge this as a completed Supabase removal.

## Cloudflare setup

1. Create a D1 database named `axivestra-access`.
2. Copy its database ID into `wrangler.jsonc`.
3. Install dependencies in this directory: `npm install`.
4. Apply the checked-in Better Auth core and device approval migrations: `npm run db:remote`. Before upgrading Better Auth, regenerate and review its core schema using `npx auth@latest generate --adapter kysely`.
5. Set Worker secrets (never commit them):
   - `npx wrangler secret put BETTER_AUTH_SECRET` (use a cryptographically random value of at least 32 bytes).
   - `npx wrangler secret put OWNER_EMAIL` (the one email address that is the AXIVESTRA Owner).
   - `npx wrangler secret put GOOGLE_CLIENT_ID`
   - `npx wrangler secret put GOOGLE_CLIENT_SECRET`
6. In Google Cloud Console, create a Web OAuth client. Add redirect URI `https://axivestra.pages.dev/api/auth/callback/google` and authorised JavaScript origin `https://axivestra.pages.dev`.
7. Keep `APP_ORIGIN` and `AUTH_BASE_URL` set to `https://axivestra.pages.dev` in Wrangler configuration.
8. Deploy the Worker with `npm run deploy`. Set the main AXIVESTRA Cloudflare Pages project's `AUTH_WORKER_URL` environment variable to the deployed Worker URL, for example `https://axivestra-access.<your-account>.workers.dev`.
9. Redeploy the main AXIVESTRA Pages app. The checked-in Pages Function at `functions/api/[[path]].ts` proxies auth/access requests same-origin so browser session cookies remain on the AXIVESTRA app domain.

The Owner must sign in with Google using the exact configured Owner email and a verified Google email. Keep owner credentials under your control; there is no general-purpose owner registration endpoint.

## Owner console and client helper

- Owner device approval console: `/owner-access.html` (source: `public/owner-access.html`). It uses Google sign-in and Owner-only device/audit endpoints.
- Device client helper: `src/lib/axivestra-device-access.ts`. It creates a random 256-bit per-installation ID and exposes registration/status/check calls. The existing app authentication gate has not yet been switched over to this helper.

## API contract

The app calls these endpoints on its own origin (`https://axivestra.pages.dev`); the Pages Function proxies them to the Worker. Requests use same-origin credentials and `x-axivestra-device`. The raw device ID is never stored in D1; only its SHA-256 digest is stored.

- Better Auth endpoints: `/api/auth/*`
- `POST /api/access/register-device` body: `{ "deviceId": "...", "label": "Office PC", "kind": "desktop" }`
- `GET /api/access/status`
- `GET /api/access/check` — returns 403 unless this account/device pair is approved.
- `GET /api/owner/devices` — Owner only.
- `POST /api/owner/devices/:id/approve`
- `POST /api/owner/devices/:id/reject`
- `POST /api/owner/devices/:id/revoke`
- `GET /api/owner/audit` — Owner only.

Guest mode registers without a Better Auth session. It is not anonymous access to private data; it remains blocked until Owner approval.

## Remaining production requirements

- Configure verified email delivery before enabling mandatory email/password email verification. Until then, Owner must independently verify the identity before approving a password-created account.
- Add rate limiting for device registration and owner decision endpoints, CAPTCHA/Turnstile for public guest registration, and alerting for suspicious attempts.
- Integrate the device check into every application data/API/file route before any private data is returned or mutated.
- Migrate the existing Supabase company, membership, personal workspace, records and storage data to D1/R2 (or another explicitly selected backend). The current app cannot be called Supabase-free until this is complete.
- Add browser tests for pending/approved/rejected/revoked, guest and cross-account device cases.
- The device ID currently represents a browser/app installation, not a hardware-backed identity. Add WebAuthn/passkey device binding for stronger resistance to copied browser storage.
