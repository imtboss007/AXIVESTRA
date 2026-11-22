# AXIVESTRA E08 — Contact Validation

**Status:** Engineering implementation on `feat/discovery-e08-contact-validation`, based on the current E07 feature commit. This is not an external contact-discovery stage and does not activate a validator or provider account.

## Matrix scope

E08 follows the Lead & Customer Intelligence Matrix: store observed email/phone values and validation method/result separately; record bounce, catch-all and confidence; never infer consent. The matrix names Reacher as an optional self-hosted validator and provider APIs only when contracted.

## Implemented boundaries

- Only E05 facts whose source field is explicitly allow-listed and whose reviewed field schema declares `type=email` or `type=phone` are eligible.
- The job snapshots the exact source field schema and allow-list at E05 completion. Workers stop if approval, schema, profile attachment, evidence hash or company worker grant changes.
- No email guessing, web lookup, pattern generation, MX lookup, SMTP probing, message sending or contact-enrichment network call is performed.
- Email syntax and international E.164 phone formatting are checked locally. No country code is inferred for local phone numbers.
- Contact values are AES-256-GCM encrypted before database persistence. A separately keyed HMAC fingerprint supports duplicate detection without storing a plaintext lookup key. Logs expose job counts only, not contact values.
- Validation events separate method, result, confidence, catch-all signal and bounce type. The default event is `syntax_only`; it does **not** mean mailbox reachable, mobile active, consented or permitted to contact.
- Contact points are created only after explicit company owner/admin review, an association to an active canonical company and/or reviewed professional person, a stated purpose and an explicit retention expiry no more than 365 days away.
- Worker is disabled by default. No credentials, provider account, source activation, migration deployment or production worker has been configured.

## Optional validator path

Reacher is not embedded in the application or called by this worker. A future self-hosted Reacher adapter must be separately enabled after provider deployment, source-specific privacy/legal review, security review and test-quality evaluation. Contracted provider APIs require a separate provider-specific adapter and agreement. Catch-all and SMTP responses remain probabilistic. A bounce can be recorded as a later event; it does not change communication preferences or create consent.

## Required worker environment when explicitly operated

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only)
- `DISCOVERY_CONTACT_ENCRYPTION_KEY` — canonical base64 of exactly 32 random bytes
- `DISCOVERY_CONTACT_FINGERPRINT_KEY` — a different canonical base64 key of exactly 32 random bytes
- `DISCOVERY_CONTACT_VALIDATION_WORKER_ENABLED=true` (default is disabled)

Key creation, secure secret storage, rotation and operational authorization are deployment prerequisites. Do not reuse the two keys or expose them to browser/mobile clients.

## Validation status

Unit/contract tests and a PostgreSQL integration path are included in this branch; the latest CI run must pass before E08 is marked verified. Physical provider verification, live DNS/MX checks, SMTP checks, delivery/bounce event ingestion from a real provider, UI review workflow and E14 retention scheduler are not claimed as complete. No contact is sent a message.
