# AXIVESTRA E05/E08 observed-contact encryption rollout

## Scope

E05 extracts only fields allow-listed for an approved source. Email and phone facts are encrypted with AES-256-GCM and a keyed HMAC fingerprint before they are committed to `discovery_extracted_facts`. The general extraction inbox receives only a masked value and a redacted source-span quote. E08 decrypts a value only in its server worker, validates it, then encrypts it again for the restricted contact-candidate table. A syntactically valid value is not proof of deliverability or permission to contact.

The extraction API now redacts contact facts as a second boundary before returning them to company workspace members. This covers legacy rows while the backfill is pending.

## Safe rollout order

1. Deploy the `20261124001000_discovery_extracted_contact_encryption.sql` schema/function migration. Its CHECK constraint is deliberately `NOT VALID`: existing records do not break schema rollout, but new/updated email and phone facts must meet the encryption requirements.
2. Provide the following secrets only to the isolated server-side backfill/worker environment. Never add them to Vite, Android, Electron, browser, or Git:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `DISCOVERY_CONTACT_ENCRYPTION_KEY` — canonical base64 for 32 random bytes
   - `DISCOVERY_CONTACT_FINGERPRINT_KEY` — canonical base64 for a different 32 random bytes
3. Run the dry run first:
   ```sh
   npm run discovery:backfill-e05-contacts
   ```
4. After reviewing the count and approving the data-maintenance window, run the idempotent backfill:
   ```sh
   DISCOVERY_E05_CONTACT_BACKFILL_APPLY=true npm run discovery:backfill-e05-contacts
   ```
   The worker encrypts each old contact, replaces its database value and source-span quote with a mask, clears the unneeded normalized value, and can safely be rerun. It never prints contact values. Empty or oversized legacy rows fail closed for manual review.
5. Confirm the output reports `remainingLegacyRows: 0`, then validate the database constraint:
   ```sql
   ALTER TABLE public.discovery_extracted_facts
   VALIDATE CONSTRAINT discovery_extracted_facts_contact_encryption_check;
   ```
6. Configure the E05 and E08 worker processes with the same two keys. Keep both processes disabled until separately authorised and hosted. Do not enable any external contact-validation provider as part of this backfill.

## Recovery and key handling

- The backfill is idempotent: rows with an existing ciphertext are not processed again.
- Keep keys in a managed server secret store. The encryption and fingerprint keys must be different.
- Back up the keys independently of database backups. Without the encryption key the contact values cannot be recovered.
- Rotation requires a planned decrypt/re-encrypt operation and versioned migration; do not replace keys in place.
- The private original source evidence retains its own source/retention policy and is not sent to the browser by the extraction inbox.
- Do not validate the CHECK constraint until all legacy contact rows are encrypted. Do not bypass the constraint or downgrade the encryption version.

## Verification

Run `npm run test:discovery` and `npm run build` after migration code changes. This repository branch is not deployed; this runbook does not authorise a live database migration or worker start.
