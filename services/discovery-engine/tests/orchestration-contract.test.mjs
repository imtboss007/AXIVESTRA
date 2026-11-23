import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

test("E20 creates dependency-aware, company-scoped orchestration plans without dispatching agents", async () => {
  const [migration, preflightMigration, executionMigration, contextMigration, workerMigration, edge, workspace, manager, integration, leaseClient, leaseClientTest] = await Promise.all([
    read("supabase/migrations/20261123130000_axivestra_agent_orchestration.sql"),
    read("supabase/migrations/20261123150000_axivestra_orchestration_preflight.sql"),
    read("supabase/migrations/20261123170000_axivestra_orchestration_execution_contracts.sql"),
    read("supabase/migrations/20261123190000_axivestra_orchestration_context_binding.sql"),
    read("supabase/migrations/20261123210000_axivestra_orchestration_worker_identity_leases.sql"),
    read("supabase/functions/discovery-control/index.ts"),
    read("src/DiscoveryOrchestrationWorkspace.tsx"),
    read("src/DiscoverySourceManager.tsx"),
    read("services/discovery-worker/postgres-integration.test.mjs"),
    read("services/discovery-worker/orchestration-lease-client.mjs"),
    read("services/discovery-worker/orchestration-lease-client.test.mjs")
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
  assert.ok(migration.includes("Only company owners/admins can approve or control orchestration plans."));
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
  assert.ok(contextMigration.includes("create table if not exists public.discovery_orchestration_run_contexts"));
  assert.ok(contextMigration.includes("create table if not exists public.discovery_orchestration_context_events"));
  assert.ok(contextMigration.includes("bind_discovery_orchestration_run_context"));
  assert.ok(contextMigration.includes("Only company owners/admins can bind orchestration execution context"));
  assert.match(contextMigration, /The exact profile purpose is not approved for this source/);
  assert.match(contextMigration, /One or more required fields are outside the source field allow-list/);
  assert.match(contextMigration, /The approved source must be attached to the selected profile/);
  assert.match(contextMigration, /run_context_missing/);
  assert.match(contextMigration, /purpose_not_allowlisted/);
  assert.match(contextMigration, /fields_not_allowlisted/);
  assert.match(contextMigration, /run_context_stale/);
  assert.match(contextMigration, /false as dispatch_permitted/);
  assert.ok(
    contextMigration.indexOf("],null) as blocker_codes") < contextMigration.indexOf("false as dispatch_permitted")
      && contextMigration.indexOf("false as dispatch_permitted") < contextMigration.indexOf("(ctx.run_id is not null) as execution_context_bound"),
    "E20.3 must append new preflight columns without breaking the E20.1 view's existing column order"
  );
  assert.match(integration, /20261123190000_axivestra_orchestration_context_binding\.sql/);
  assert.match(integration, /bind_discovery_orchestration_run_context/);
  assert.match(integration, /run_context_missing/);

  assert.ok(workerMigration.includes("create table if not exists public.discovery_orchestration_worker_identities"));
  assert.ok(workerMigration.includes("create table if not exists public.discovery_orchestration_worker_events"));
  assert.ok(workerMigration.includes("grant_discovery_orchestration_worker_identity"));
  assert.ok(workerMigration.includes("set_discovery_orchestration_worker_identity_status"));
  assert.ok(workerMigration.includes("claim_discovery_orchestration_lease"));
  assert.ok(workerMigration.includes("heartbeat_discovery_orchestration_lease"));
  assert.ok(workerMigration.includes("release_discovery_orchestration_lease"));
  assert.ok(workerMigration.includes("expire_discovery_orchestration_leases"));
  assert.ok(workerMigration.includes("worker_identity_scope_missing"));
  assert.ok(workerMigration.includes("company_worker_grant_inactive"));
  assert.ok(workerMigration.includes("perform 1 from public.companies where id=p_company_id for update"));
  assert.ok(workerMigration.includes("select count(*)::integer into v_active"));
  assert.ok(workerMigration.includes("e.adapter_key=v_execution.adapter_key"));
  assert.ok(workerMigration.includes("v_active>=v_adapter.max_parallel_per_company"));
  assert.ok(workerMigration.includes("v_active>=v_run.max_parallel_steps"));
  assert.ok(workerMigration.includes("from public.discovery_company_worker_controls"));
  assert.ok(workerMigration.includes("for share"));
  assert.ok(workerMigration.includes("A new random worker credential is required"));
  assert.ok(workerMigration.includes("coalesce(p_lease_seconds,0) not between 15 and 300"));
  assert.ok(workerMigration.includes("dispatch_permitted=true"));
  assert.ok(workerMigration.includes("false as dispatch_permitted"));
  assert.ok(workerMigration.includes("Worker grant events are append-only"));
  assert.ok(workerMigration.includes("Company worker grant was disabled or expired"));
  assert.ok(workerMigration.includes("Worker credential rotated; active leases were released"));
  assert.ok(workerMigration.includes("credential_hash"));
  assert.ok(workerMigration.includes("create or replace view public.discovery_orchestration_worker_directory"));
  assert.ok(workerMigration.includes("create or replace view public.discovery_orchestration_execution_lease_inbox"));
  assert.ok(workerMigration.includes("create or replace view public.discovery_orchestration_company_worker_gate"));
  assert.ok(workerMigration.includes("create or replace view public.discovery_orchestration_active_worker_stage_scopes"));
  assert.ok(workerMigration.includes("where public.is_company_member(company_id)"));
  assert.ok(workerMigration.includes("left join public.discovery_orchestration_company_worker_gate wg"));
  assert.ok(workerMigration.includes("left join public.discovery_orchestration_active_worker_stage_scopes ws"));
  assert.doesNotMatch(workerMigration, /left join public\\.discovery_company_worker_controls wg/);

  assert.ok(workerMigration.includes("revoke all on public.discovery_orchestration_execution_leases"));
  assert.match(integration, /20261123210000_axivestra_orchestration_worker_identity_leases\.sql/);
  assert.match(integration, /grant_discovery_orchestration_worker_identity/);
  assert.match(integration, /claim_discovery_orchestration_lease/);
  assert.match(integration, /heartbeat_discovery_orchestration_lease/);
  assert.match(integration, /release_discovery_orchestration_lease/);
  assert.match(integration, /set_discovery_orchestration_worker_identity_status/);
  assert.ok(integration.includes("E20.4 integration test for global company grant revocation."));
  assert.match(edge, /action === "orchestration\.workerGrant"/);
  assert.match(edge, /action === "orchestration\.workerControl"/);
  assert.match(edge, /crypto\.getRandomValues/);
  assert.match(edge, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(workspace, /Grant temporary worker identity/);
  assert.match(workspace, /Copy one-time credential/);
  assert.match(workspace, /workerStageKeys/);
  assert.match(workspace, /maxActiveLeases/);
  assert.match(workspace, /Type \{worker\.worker_key\} to revoke/);
  assert.match(workspace, /Worker grant history/);
  assert.ok(!workspace.includes("localStorage.setItem(workerToken"));
  assert.match(leaseClient, /createOrchestrationLeaseClient/);
  assert.match(leaseClient, /createHash/);
  assert.match(leaseClient, /randomBytes/);
  assert.match(leaseClient, /leaseTokens = new Map/);
  assert.match(leaseClientTest, /E20\.4 hashes worker credentials/);
  assert.match(leaseClientTest, /fails closed/);
  assert.match(leaseClientTest, /forgotten its token/);


  assert.doesNotMatch(executionMigration, /create or replace function public[.](claim|heartbeat|complete|retry)_discovery_orchestration/i);
  assert.match(edge, /discovery_orchestration_step_preflight/);
  assert.match(edge, /action === "orchestration\.list"/);
  assert.match(edge, /action === "orchestration\.request"/);
  assert.match(edge, /action === "orchestration\.decide"/);
  assert.match(edge, /action === "orchestration\.bindContext"/);
  assert.match(edge, /bind_discovery_orchestration_run_context/);
  assert.match(edge, /profileSourceResult/);
  assert.match(edge, /contextEventResult/);
  assert.match(workspace, /Context history/);
  assert.match(workspace, /Context bound/);
  assert.match(workspace, /execution_context_bound/);

  assert.match(workspace, /Bind & validate context/);
  assert.match(workspace, /orchestration\.bindContext/);
  assert.match(workspace, /Source allow-list/);
  assert.match(edge, /request_discovery_orchestration_run/);
  assert.match(edge, /record_discovery_orchestration_decision/);
  assert.match(workspace, /approved_not_dispatched/);
  assert.match(workspace, /Preflight blocked/);
  assert.match(workspace, /No stage was dispatched/);
  assert.ok(workspace.includes("only owners/admins can approve or reject it."));
  assert.match(manager, /DiscoveryOrchestrationWorkspace/);
  assert.match(integration, /20261123130000_axivestra_agent_orchestration\.sql/);
  assert.match(integration, /E20: plan-only orchestration/);
});
