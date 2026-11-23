# AXIVESTRA technical E20 — Agent Orchestration Control Plane

**Revised roadmap alias:** E16 — Agent Orchestration  
**Depends on:** technical E04–E12 stage queues, E02 source governance, E13 provenance, E14 privacy controls and E19 verification workflow  
**Migrations:** `20261123130000_axivestra_agent_orchestration.sql`, `20261123150000_axivestra_orchestration_preflight.sql`, `20261123170000_axivestra_orchestration_execution_contracts.sql`, `20261123190000_axivestra_orchestration_context_binding.sql`, `20261123210000_axivestra_orchestration_worker_identity_leases.sql`, `20261123230000_axivestra_orchestration_adapter_approvals.sql` plus the `discovery-orchestration-worker` Edge Function

## Purpose

AXIVESTRA already has separate source-fetch, extraction, entity, role, contact, geo, enrichment, matching and deduplication queues. They are not a single cross-stage orchestrator. E20 adds a company-scoped control plane to define ordered stage plans, preserve prerequisite relationships, collect an owner/admin decision and retain a durable decision history.

## Implemented foundation

- A versionable stage registry records technical stage ID, capability, dependency keys, permission class and adapter readiness.
- Workflow presets define an explicit, topologically ordered subset of existing E04–E12 stages: company identity, identity plus geo, and full discovery.
- A run request creates a company-scoped run, dependency-aware step rows and an append-only request event in one database transaction.
- Idempotency keys prevent duplicate run requests from producing duplicate plans.
- Any authenticated company member may request a plan. Only an owner/admin may approve, reject, pause, resume or cancel it.
- Approval transitions to `approved_not_dispatched`. It does not start an agent, create a discovery job, invoke a provider or contact an external source.
- Per-company/per-stage kill-switch rows are created OFF by default. No user-facing enable path is provided until a specific adapter, policy check and acceptance test have been registered.
- Company members can read runs, steps and history. Direct table writes are revoked; state changes pass through role-checked database functions.
- A read-only preflight view computes per-step blockers: approval state, dispatch configuration, stage kill switch, adapter registration, dependency completion, worker grant, source/purpose grants, personal-data policy and dispatcher registration.
- E20.2 adds adapter-contract metadata, durable execution and lease schemas, bounded retry/lease/concurrency parameters and append-only execution-event storage. All adapter contracts remain unseeded.
- E20.3 adds owner/admin-only context binding in the workspace. A run must reference an enabled company profile, an approved source attached to that profile, the profile's exact purpose and a required-field subset of that source's allow-list. The context is timestamp-snapshotted; changed profile/source policy becomes a preflight blocker. Bind/rebind receipts are append-only.
- E20.4 adds temporary, company-scoped worker identities with exact E04–E12 stage scopes, max active leases, bounded lease duration and expiry that cannot outlive the existing one-hour company worker grant. Only SHA-256 credential hashes are stored; the raw worker token is shown once by the workspace and is not written to audit history.
- Owners/admins can pause or permanently revoke an identity. Both actions release active leases immediately; revocation cannot be resumed without a new grant. Disabling or shortening the company-wide worker grant automatically pauses scoped identities and releases their leases. Natural expiry blocks new claims and heartbeat renewal; each scoped identity and lease is capped so neither can outlive the company grant. An expired identity may still retain its historical `active` row status until a later control/sweep operation, but it is operationally unusable.
- Worker lease operations are brokered through `supabase/functions/discovery-orchestration-worker`, which accepts only the temporary scoped worker token and the Supabase public API key. The service-role credential remains inside the Edge Function; the worker process never receives it. The broker hashes the worker token, creates and hashes lease tokens server-side, and returns a lease token only to the worker client. The client keeps it in a private in-memory map; it is not returned to adapter code or persisted. It sanitizes errors and never logs credentials or token hashes.
- The broker invokes service-role-only claim, heartbeat, release and expiry RPCs, which validate worker identity, company grant, stage scope, token and expiry. The safe lease inspector omits lease-token hashes. Claim also requires `dispatch_permitted=true` and zero preflight blockers; the current view still hard-codes dispatch to false, so no E20 execution can be claimed.
- A future worker process instantiates `createOrchestrationLeaseClient` with only `supabaseUrl`, `publicApiKey`, `companyId`, `workerIdentityId` and its one-time `workerToken`. It must not receive `SUPABASE_SERVICE_ROLE_KEY`. The helper pins the broker path to `/functions/v1/discovery-orchestration-worker`, requires HTTPS (except localhost tests), rejects redirects and keeps any returned lease token in process memory.
- E20.5 adds company-specific approval, rejection and suspension of an exact platform-reviewed adapter contract version. Every review is owner/admin-only, company-scoped and recorded in an append-only event history. Company approval does not enable the global contract, a stage kill switch or dispatch.
- E20.5 extends preflight with separate blockers for a platform-unreviewed/disabled adapter contract and a missing, rejected, suspended or stale company approval. It reports the platform-contract and company-approval states separately.
- E20.5 adds a read-only dependency schedule preview that distinguishes satisfied prerequisites, waiting dependencies and failed/cancelled dependencies. A preview state never changes a step, creates an execution or enqueues an existing queue.
- E20.5 adds a nine-stage contract map from the E20 registry to the existing E04–E12 queues. E04–E10 and E12 point to their actual queue table and enqueue/claim path; E11 is explicitly mapped as a deterministic inline engine with no dedicated queue. This prevents an invented duplicate queue for matching.
- The stage-queue contract table is read-only to authenticated company users and its `bridge_enabled` field is constrained OFF. Preflight reports a missing mapping or disabled bridge. E20 does not call any legacy enqueue/claim routine and does not alter the existing E04–E12 queue workers.
- The Discovery Sources workspace displays the stage inventory, versioned adapter contracts, company review actions/history, dependency schedule preview, run approvals, disabled stage gates, per-step preflight blockers, context binding controls, scoped worker grant/revoke controls and separate decision/context/worker histories.

## Current boundaries

- **Governed planning and non-dispatchable lease foundations only.** Preflight and the E20.5 schedule view are dry-run projections; they do not transition steps to runnable or enqueue stage jobs. E20.4 provides scoped identity management and service-role-only lease RPCs, but the claim RPC returns no work while `dispatch_permitted=false`.
- No production adapter is registered or dispatch-ready. Platform adapter contracts are a controlled, versioned catalogue; company owners/admins can review only a platform-enabled exact version. There is no UI path to register arbitrary executable adapter code, and company approval is not a dispatch permission.
- The existing stage queues remain independently governed and are not bridged to E20. There is still no dispatcher, queue bridge, automatic dependency scheduler, retry engine or cross-agent recovery loop.
- The existing company-wide worker grant is mandatory and checked dynamically by E20.4; each scoped identity expires no later than that grant. Personal-data policy checks remain an explicit preflight blocker. E20.3 verifies run-specific profile/source/purpose/field context but does not replace separate privacy approval.
- No agent autonomy, internet search, unapproved scraping, outreach, underwriting, credit/property decision, model-provider call or automatic entity merge is introduced.
- E13 remains the source lineage ledger; E19 remains the human verification workflow. E20 adds its own append-only orchestration decision receipts.

## Validation

The E20 contract suite checks the schema, stage dependency map, disabled-by-default execution gates, UI approval boundary, preflight blocker vocabulary, company adapter approval rules, dependency schedule preview, all nine legacy queue mappings and authenticated edge-function routes. PostgreSQL integration tests apply E20 after E19 and exercise plan idempotency, approval, governed run-context binding, worker owner/admin grants, stage scoping, expiry bounds, credential privacy, public-key plus scoped-token Edge broker, no service-role key in the worker client, blocked claims while dispatch is false, heartbeat/release, expired-lease return-to-ready, pause/revoke and immediate release following company-grant revocation. E20.5 additionally verifies that only a platform-reviewed enabled contract can be approved for a company, a viewer cannot approve it, review events are append-only, dependency previews never dispatch, the eight existing durable queues plus E11 inline engine are mapped correctly, all bridge flags remain false and authenticated users cannot modify the mapping. Current-head CI must pass before E20.5 is considered validated.

## Remaining E20 sequence

E20.5 is implemented as a non-dispatchable adapter-governance and schedule-preview increment. Two engineering increments remain:

1. **E20.6 — Retry and recovery:** enforce company/adapter/run concurrency under durable database locks; idempotent attempt receipts; explicit retryable/permanent error classes and bounded backoff; expiry recovery without double attempts; pause/cancel propagation; and cross-stage failure handling. Retries must not be inferred from arbitrary error strings.
2. **E20.7 — Execution console and acceptance:** add operational status/metrics, worker lifecycle visibility, adapter/version drift, queue-age and failure views; then run end-to-end security, PostgreSQL, worker and authenticated browser acceptance before any separate activation decision.

E20.5 does not create a production adapter or bridge to the legacy queues. Versioned catalogue entries remain controlled migration/release artefacts; company review is scoped to an exact enabled version. The dependency schedule and stage-to-queue contract map are observational only. E04–E10/E12 retain their existing queue triggers and claim routines; E11 remains deterministic inline scoring.

These are engineering slices, not permission to activate a worker. The `dispatch_permitted` flag remains hard-coded false; E20.4's claim RPC cannot acquire work. Any future change to that invariant requires a separate explicit release decision after policy integration, production adapter review, security and end-to-end acceptance.

A successful current-head PostgreSQL governance workflow and app build are required before E20.5 is considered validated. Authenticated browser acceptance remains subject to the dedicated QA fixture. No production migration, worker activation, provider connection, deployment or merge is performed by this implementation.
