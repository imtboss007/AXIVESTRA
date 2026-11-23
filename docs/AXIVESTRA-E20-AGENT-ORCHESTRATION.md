# AXIVESTRA technical E20 — Agent Orchestration Control Plane

**Revised roadmap alias:** E16 — Agent Orchestration  
**Depends on:** technical E04–E12 stage queues, E02 source governance, E13 provenance, E14 privacy controls and E19 verification workflow  
**Migrations:** `20261123130000_axivestra_agent_orchestration.sql`, `20261123150000_axivestra_orchestration_preflight.sql`, `20261123170000_axivestra_orchestration_execution_contracts.sql`, `20261123190000_axivestra_orchestration_context_binding.sql`

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
- E20.2 adds adapter-contract metadata, durable execution and lease schemas, bounded retry/lease/concurrency parameters and append-only execution-event storage. All adapter contracts remain unseeded; there are no worker claim, heartbeat, completion or retry RPCs.
- E20.3 adds owner/admin-only context binding in the workspace. A run must reference an enabled company profile, an approved source attached to that profile, the profile's exact purpose and a required-field subset of that source's allow-list. The context is timestamp-snapshotted; changed profile/source policy becomes a preflight blocker. Bind/rebind receipts are append-only.
- E20.3 adds owner/admin-only run-context binding. It requires an enabled company profile, an approved source attached to that profile, an exact matching purpose and a required-field subset of the source allow-list. Context snapshots and append-only bind/rebind events are retained; stale profile/source changes become preflight blockers.
- The Discovery Sources workspace displays the stage inventory, dependency chain, run approvals, adapter readiness, disabled stage gates, per-step preflight blockers, context binding controls and separate decision/context histories.

## Current boundaries

- **Governed planning and read-only admission only.** Preflight is a dry-run blocker projection; it does not transition steps to runnable, reserve work or dispatch anything. There is no shared dispatcher, queue consumer, worker lease operation, execution scheduler, retry engine or cross-agent recovery loop in this release. E20.2 defines lease and execution persistence only; E20.3 validates source/profile/purpose/field context but does not expose worker mutation permissions or lease RPCs.
- Stage adapters are unregistered and marked not dispatch-ready. The existing stage queues remain independently governed and are not automatically bridged to E20.
- The company-wide worker grant and personal-data policy checks remain mandatory and are still explicit preflight blockers. E20.3 verifies the run-specific profile/source/purpose/field context but does not itself prove the company worker grant or personal-data policy approval.
- No agent autonomy, internet search, unapproved scraping, outreach, underwriting, credit/property decision, model-provider call or automatic entity merge is introduced.
- E13 remains the source lineage ledger; E19 remains the human verification workflow. E20 adds its own append-only orchestration decision receipts.

## Validation

The E20 contract suite checks the schema, stage dependency map, disabled-by-default execution gates, UI approval boundary, preflight blocker vocabulary and authenticated edge-function routes. PostgreSQL integration assertions apply E20 after E19 and E20.1 after E20, then test plan idempotency, dependency creation, member request, owner/admin approval, viewer rejection, run-context binding against actual approved source/profile/purpose/field rows, field-scope rejection, immutable context history, read-only preflight blocker results and the disabled execution/lease schema boundary.

## Remaining E20 sequence (indicative)

Four substantial implementation increments remain after E20.3:

1. **E20.4 — Worker identity and lease lifecycle:** connect the existing company worker grant to orchestration admission; implement worker identity, atomic claim, heartbeat, expiry and release with concurrency-safe locking.
2. **E20.5 — Adapter approval and dependency scheduler:** register versioned stage adapters, review the contracts per company, and bridge approved plan steps to existing E04–E12 queues only after every policy gate is verified.
3. **E20.6 — Retry and recovery:** enforce per-company concurrency, idempotent attempts, retry classification/backoff, expired-lease recovery, pause/cancel propagation and cross-stage failure handling.
4. **E20.7 — Execution console and acceptance:** add operational status/metrics and run end-to-end security, PostgreSQL, worker and authenticated browser acceptance before any separate activation decision.

These are engineering slices, not permission to activate a worker. The dispatch_permitted flag remains false until the full safety gate and separate approval are completed.

A successful current-head PostgreSQL governance workflow and app build are required before E20 is considered validated. Authenticated browser acceptance remains subject to the dedicated QA fixture. No production migration, worker activation, provider connection, deployment or merge is performed by this implementation.
