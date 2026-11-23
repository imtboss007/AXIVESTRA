# AXIVESTRA technical E20 — Agent Orchestration Control Plane

**Revised roadmap alias:** E16 — Agent Orchestration  
**Depends on:** technical E04–E12 stage queues, E02 source governance, E13 provenance, E14 privacy controls and E19 verification workflow  
**Migration:** `20261123130000_axivestra_agent_orchestration.sql`

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
- The Discovery Sources workspace displays the stage inventory, dependency chain, run approvals, adapter readiness, disabled stage gates and append-only history.

## Current boundaries

- **Plan and approval only.** There is no shared dispatcher, queue consumer, worker lease, dependency scheduler, retry engine or cross-agent recovery loop in this release.
- Stage adapters are unregistered and marked not dispatch-ready. The existing stage queues remain independently governed and are not automatically bridged to E20.
- The existing company-wide worker grant, source approval, exact purpose/field allow-lists and privacy controls remain separate mandatory safeguards.
- No agent autonomy, internet search, unapproved scraping, outreach, underwriting, credit/property decision, model-provider call or automatic entity merge is introduced.
- E13 remains the source lineage ledger; E19 remains the human verification workflow. E20 adds its own append-only orchestration decision receipts.

## Validation

The E20 contract suite checks the schema, stage dependency map, disabled-by-default execution gates, UI approval boundary and authenticated edge-function routes. PostgreSQL integration assertions apply E20 after E19 and test plan idempotency, stage dependency creation, member request, owner/admin approval, viewer rejection and immutable event history.

A successful current-head PostgreSQL governance workflow and app build are required before E20 is considered validated. Authenticated browser acceptance remains subject to the dedicated QA fixture. No production migration, worker activation, provider connection, deployment or merge is performed by this implementation.
