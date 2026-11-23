import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

test("E20 creates dependency-aware, company-scoped orchestration plans without dispatching agents", async () => {
  const [migration, preflightMigration, executionMigration, edge, workspace, manager, integration] = await Promise.all([
    read("supabase/migrations/20261123130000_axivestra_agent_orchestration.sql"),
    read("supabase/migrations/20261123150000_axivestra_orchestration_preflight.sql"),
    read("supabase/migrations/20261123170000_axivestra_orchestration_execution_contracts.sql"),
    read("supabase/functions/discovery-control/index.ts"),
    read("src/DiscoveryOrchestrationWorkspace.tsx"),
    read("src/DiscoverySourceManager.tsx"),
    read("services/discovery-worker/postgres-integration.test.mjs")
  ]);

  for (const table of [
    "discovery_orchestration_stage_registry",
    "discovery_orchestration_workflows",
    "discovery_orchestration_company_stage_controls",
    "discovery_orchestration_runs",
    "discovery_orchestration_steps",
    "discovery_orchestration_events"
  ]) assert.match(migration, new RegExp("create table if not exists public\\." + table));

  assert.match(migration, /dependency_stage_keys text\[\] not null/);
  assert.match(migration, /depends_on_step_ids uuid\[\] not null/);
  assert.match(migration, /unique\(company_id,idempotency_key\)/);
  assert.match(migration, /status='awaiting_approval'/);
  assert.match(migration, /'approved_not_dispatched'/);
  assert.match(migration, /enabled boolean not null default false/);
  assert.match(migration, /dispatch_ready boolean not null default false/);
  assert.match(migration, /revoke all on public\.discovery_orchestration_stage_registry/);
  assert.match(migration, /Only company owners\/admin can approve or control orchestration plans/);
  assert.match(migration, /Orchestration events are append-only/);
  assert.match(migration, /'full_discovery'/);
  assert.match(migration, /'company_identity'/);
  assert.match(migration, /'geo_resolution'/);
  assert.doesNotMatch(migration, /insert into public\.discovery_jobs/);
  assert.doesNotMatch(migration, /perform .*http/i);

  assert.ok(preflightMigration.includes("create or replace view public.discovery_orchestration_step_preflight"));
  assert.match(preflightMigration, /company_worker_grant_not_checked/);
  assert.match(preflightMigration, /source_and_purpose_grants_not_checked/);
  assert.match(preflightMigration, /personal_data_policy_not_checked/);
  assert.match(preflightMigration, /no_dispatcher_registered/);
  assert.match(preflightMigration, /false as dispatch_permitted/);
  for (const table of [
    "discovery_orchestration_adapter_contracts",
    "discovery_orchestration_executions",
    "discovery_orchestration_execution_leases",
    "discovery_orchestration_execution_events"
  ]) assert.ok(executionMigration.includes("create table if not exists public." + table));
  assert.match(executionMigration, /enabled boolean not null default false/);
  assert.match(executionMigration, /max_parallel_per_company integer not null default 1/);
  assert.match(executionMigration, /max_attempts integer not null default 3/);
  assert.match(executionMigration, /lease_seconds integer not null default 120/);
  assert.match(executionMigration, /Execution events are append-only/);
  assert.ok(executionMigration.includes("no worker claim/heartbeat/complete/retry RPC"));
  assert.doesNotMatch(executionMigration, /create or replace function public\\.(claim|heartbeat|complete|retry)_discovery_orchestration/i);
  assert.match(edge, /discovery_orchestration_step_preflight/);
  assert.match(edge, /action === "orchestration\.list"/);
  assert.match(edge, /action === "orchestration\.request"/);
  assert.match(edge, /action === "orchestration\.decide"/);
  assert.match(edge, /request_discovery_orchestration_run/);
  assert.match(edge, /record_discovery_orchestration_decision/);
  assert.match(workspace, /approved_not_dispatched/);
  assert.match(workspace, /Preflight blocked/);
  assert.match(workspace, /No stage was dispatched/);
  assert.match(workspace, /Only owners\/admins can approve or reject it/);
  assert.match(manager, /DiscoveryOrchestrationWorkspace/);
  assert.match(integration, /20261123130000_axivestra_agent_orchestration\.sql/);
  assert.match(integration, /E20: plan-only orchestration/);
});
