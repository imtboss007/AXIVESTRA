import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../../", import.meta.url);
const read = async path => (await readFile(new URL(path, root), "utf8")).replace(/\r\n/g, "\n");

test("E20 creates dependency-aware, company-scoped orchestration plans without dispatching agents", async () => {
  const [migration, preflightMigration, executionMigration, contextMigration, workerMigration, adapterMigration, retryMigration, consoleMigration, edge, workerEdge, config, workspace, manager, integration, leaseClient, leaseClientTest] = await Promise.all([
    read("supabase/migrations/20261123130000_axivestra_agent_orchestration.sql"),
    read("supabase/migrations/20261123150000_axivestra_orchestration_preflight.sql"),
    read("supabase/migrations/20261123170000_axivestra_orchestration_execution_contracts.sql"),
    read("supabase/migrations/20261123190000_axivestra_orchestration_context_binding.sql"),
    read("supabase/migrations/20261123210000_axivestra_orchestration_worker_identity_leases.sql"),
    read("supabase/migrations/20261123230000_axivestra_orchestration_adapter_approvals.sql"),
    read("supabase/migrations/20261123240000_axivestra_orchestration_retry_recovery.sql"),
    read("supabase/migrations/20261123250000_axivestra_orchestration_execution_console.sql"),
    read("supabase/functions/discovery-control/index.ts"),
    read("supabase/functions/discovery-orchestration-worker/index.ts"),
    read("supabase/config.toml"),
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
  assert.ok(workerMigration.includes("wi.worker_key=p_worker_key"), "E20.4 grant lookup must qualify worker_key to avoid RETURNS TABLE variable ambiguity");
  assert.ok(workerMigration.includes("constraint discovery_orchestration_worker_identity_company_worker_key unique(company_id,worker_key)"));
  assert.ok(workerMigration.includes("on conflict on constraint discovery_orchestration_worker_identity_company_worker_key do update set"), "E20.4 upsert must name its unique constraint to avoid RETURNS TABLE output-variable ambiguity");
  assert.ok(workerMigration.includes("c.expires_at>v_now"), "E20.4 claim must qualify company grant expiry against the RETURNS TABLE expires_at output");
  assert.ok(workerMigration.includes("wi.expires_at>v_now"), "E20.4 claim must qualify worker expiry against the RETURNS TABLE expires_at output");
  assert.ok(workerMigration.includes("ac.adapter_key=v_execution.adapter_key"), "E20.4 claim must qualify adapter lookup against the RETURNS TABLE adapter_key output");
  assert.ok(workerMigration.includes("s.stage_key from public.discovery_orchestration_steps as s"), "E20.4 claim must qualify the returned stage key");
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
  assert.ok(workerMigration.includes("Company worker grant was disabled, shortened or expired"));
  assert.ok(workerMigration.includes("Shortening a still-active company grant must release leases immediately"));
  const workerStatusStart = workerMigration.indexOf("create or replace function public.set_discovery_orchestration_worker_identity_status");
  const statusGrantLock = workerMigration.indexOf("select * into v_control", workerStatusStart);
  const statusWorkerLock = workerMigration.indexOf("select * into v_worker", workerStatusStart);
  assert.ok(statusGrantLock > workerStatusStart && statusWorkerLock > statusGrantLock, "worker resume must lock company grant before worker identity");
  assert.ok(workerMigration.includes("new.expires_at>=old.expires_at"));
  assert.match(integration, /shortening a still-enabled company grant must pause scoped workers/);
  assert.ok(workerMigration.includes("Worker credential rotated; active leases were released"));
  assert.ok(workerMigration.includes("credential_hash"));
  assert.ok(workerMigration.includes("create or replace view public.discovery_orchestration_worker_directory"));
  assert.ok(workerMigration.includes("create or replace view public.discovery_orchestration_execution_lease_inbox"));
  assert.ok(workerMigration.includes("create or replace view public.discovery_orchestration_company_worker_gate"));
  assert.ok(workerMigration.includes("create or replace view public.discovery_orchestration_active_worker_stage_scopes"));
  assert.ok(workerMigration.includes("current_setting('request.jwt.claim.role',true)='service_role'"),"trusted worker broker must evaluate membership-filtered preflight views without a human user JWT");
  assert.ok(workerMigration.includes("where public.is_company_member(company_id)"));
  assert.ok(workerMigration.includes("left join public.discovery_orchestration_company_worker_gate wg"));
  assert.ok(workerMigration.includes("left join public.discovery_orchestration_active_worker_stage_scopes ws"));
  assert.doesNotMatch(workerMigration, /left join public\\.discovery_company_worker_controls wg/);

  assert.ok(adapterMigration.includes("create table if not exists public.discovery_orchestration_company_adapter_approvals"));
  assert.ok(adapterMigration.includes("create table if not exists public.discovery_orchestration_company_adapter_events"));
  assert.match(adapterMigration, /review_discovery_orchestration_company_adapter/);
  assert.match(adapterMigration, /Only company owners\/admins can review a company adapter contract/);
  assert.match(adapterMigration, /Only a platform-reviewed, enabled adapter contract can be approved for a company/);
  assert.match(adapterMigration, /Company adapter approval history is append-only/);
  assert.match(adapterMigration, /create or replace view public\.discovery_orchestration_dependency_schedule/);
  assert.match(adapterMigration, /eligible_for_policy_review_only/);
  assert.match(adapterMigration, /false as dispatch_permitted/);
  assert.match(adapterMigration, /adapter_contract_not_platform_approved/);
  assert.match(adapterMigration, /company_adapter_not_approved/);
  assert.match(adapterMigration, /coalesce\(aa.status='approved' and aa.contract_version=ac.contract_version,false\) as company_adapter_approved/);
  assert.doesNotMatch(adapterMigration, /insert into public\.discovery_jobs/i);
  assert.doesNotMatch(adapterMigration, /update public\.discovery_orchestration_company_stage_controls/i);
  assert.match(retryMigration, /create table if not exists public\.discovery_orchestration_failure_policies/);
  assert.match(retryMigration, /create table if not exists public\.discovery_orchestration_execution_attempts/);
  assert.match(retryMigration, /create or replace function public\.guard_discovery_orchestration_attempt_receipt/);
  assert.match(retryMigration, /before update or delete on public\.discovery_orchestration_execution_attempts/);
  assert.match(retryMigration, /A finalized orchestration attempt receipt is immutable/);
  assert.match(retryMigration, /An attempt receipt can only transition once from started to a final outcome/);
  assert.match(retryMigration, /attempt_number between 1 and 8/);
  assert.match(retryMigration, /failure_class.*permanent/);
  assert.match(retryMigration, /'INVALID_INPUT','permanent',false/);
  assert.match(retryMigration, /'UNKNOWN_FAILURE','unknown',false/);
  assert.match(retryMigration, /WORKER_RELEASED/);
  assert.match(retryMigration, /LEASE_EXPIRED/);
  assert.match(retryMigration, /UNKNOWN_FAILURE/);
  assert.match(retryMigration, /The failure code is not in the approved retry classification catalogue/);
  assert.match(retryMigration, /power\(2::numeric,greatest\(0,v_attempt\.attempt_number-1\)\)/);
  assert.match(retryMigration, /e\.state in \('ready','retry_wait'\)/);
  assert.match(retryMigration, /new\.attempt_number:=v_execution\.attempt_count\+1/);
  assert.match(retryMigration, /'lease:'\|\|new\.id::text/);
  assert.match(retryMigration, /record_discovery_orchestration_attempt_outcome/);
  assert.match(retryMigration, /idempotent',true/);
  assert.match(retryMigration, /create or replace view public\.discovery_orchestration_attempt_inbox/);
  assert.match(retryMigration, /create or replace view public\.discovery_orchestration_execution_inbox/);
  assert.match(retryMigration, /pf\.dispatch_permitted=true and cardinality\(pf\.blocker_codes\)=0/);
  assert.doesNotMatch(retryMigration, /retry after .*error message/i);
  // E20.7's safe company-scoped operations projection is telemetry only.
  assert.match(consoleMigration, /create or replace view public\.discovery_orchestration_operations_inbox/);
  assert.match(consoleMigration, /queue_age_seconds/);
  assert.match(consoleMigration, /retry_wait_seconds/);
  assert.match(consoleMigration, /lease_heartbeat_age_seconds/);
  assert.match(consoleMigration, /company_approval_stale/);
  assert.match(consoleMigration, /stage_adapter_mismatch/);
  assert.match(consoleMigration, /where public\.is_company_member\(e\.company_id\)/);
  assert.match(consoleMigration, /grant select on public\.discovery_orchestration_operations_inbox to authenticated,service_role/);
  assert.doesNotMatch(consoleMigration, /lease_token_hash|credential_hash|raw_source_body|http\(|enqueue_discovery_/i);
  assert.match(integration, /20261123250000_axivestra_orchestration_execution_console\.sql/);
  assert.match(integration, /discovery_orchestration_operations_inbox/);
  assert.match(integration, /company_approval_stale/);
  assert.match(edge, /operationsResult/);
  assert.match(edge, /discovery_orchestration_operations_inbox/);
  assert.match(workspace, /E20\.7 · OPERATIONS CONSOLE/);
  assert.match(workspace, /Oldest queue age/);
  assert.match(workspace, /Adapter\/version drift and readiness exceptions/);
  assert.match(workspace, /active lease\(s\)/);
  assert.match(integration, /20261123240000_axivestra_orchestration_retry_recovery\.sql/);
  assert.match(integration, /REMOTE_5XX/);
  assert.match(integration, /duplicateFailureOutcome/);
  assert.match(integration, /LEASE_EXPIRED/);
  assert.match(integration, /attempt_count,2/);
  assert.match(integration, /downstreamSchedule/);
  assert.match(integration, /blocked_by_failed_dependency/);
  assert.match(workerEdge, /action !== "finish"/);
  assert.match(workerEdge, /action === "finish"/);
  assert.match(workerEdge, /record_discovery_orchestration_attempt_outcome/);
  assert.match(leaseClient, /async finish\(leaseId/);
  assert.match(leaseClientTest, /E20\.6 worker client records a successful attempt/);
  assert.match(leaseClientTest, /E20\.6 worker client submits only registered error-code shaped failures/);
  assert.match(edge, /executionResult/);
  assert.match(edge, /attemptResult/);
  assert.match(edge, /failurePolicyResult/);
  assert.match(workspace, /Execution attempts and retry status/);
  assert.match(workspace, /Attempt receipt history/);
  assert.match(workspace, /Approved failure classification catalogue/);
  assert.match(adapterMigration, /create table if not exists public\.discovery_orchestration_stage_queue_contracts/);
  assert.match(adapterMigration, /bridge_enabled boolean not null default false check\(bridge_enabled=false\)/);
  for (const stageKey of [
    "e04_source_capture","e05_extraction","e06_entity_resolution","e07_professional_roles",
    "e08_contact_validation","e09_geo_resolution","e10_enrichment","e11_matching","e12_deduplication"
  ]) assert.ok(adapterMigration.includes("('" + stageKey + "','e20.5-map-v1'"), "E20.5 must map " + stageKey);
  assert.match(adapterMigration, /'e11_matching','e20\.5-map-v1','deterministic_inline',null,'none',null/);
  assert.match(adapterMigration, /stage_queue_bridge_disabled/);
  assert.match(adapterMigration, /stage_queue_mapping_missing/);
  assert.match(adapterMigration, /q\.queue_table as stage_queue_table/);
  assert.match(adapterMigration, /q\.claim_routine as stage_queue_claim_routine/);
  assert.match(adapterMigration, /bridge_enabled=false/);
  assert.doesNotMatch(adapterMigration, /perform public\.enqueue_discovery_/i);
  assert.doesNotMatch(adapterMigration, /select \* from public\.claim_discovery_/i);
  assert.match(integration, /discovery_orchestration_stage_queue_contracts/);
  assert.match(integration, /E11 matching is deterministic inline/);
  assert.match(integration, /stage_queue_bridge_disabled/);
  assert.match(edge, /stageQueueContractResult/);
  assert.match(edge, /stageQueueContracts/);
  assert.match(workspace, /Existing stage queue map/);
  assert.match(workspace, /LEGACY QUEUE CONTRACTS/);
  assert.match(workspace, /Bridge: \{contract\.bridge_enabled \? "Enabled" : "OFF · read-only mapping"\}/);
  assert.match(integration, /20261123230000_axivestra_orchestration_adapter_approvals\.sql/);
  assert.match(integration, /review_discovery_orchestration_company_adapter/);
  assert.match(integration, /dependencyPreview/);
  assert.match(integration, /company_adapter_approved/);
  assert.match(edge, /action === "orchestration\.adapterReview"/);
  assert.match(edge, /adapterContractResult/);
  assert.match(edge, /adapterApprovalResult/);
  assert.match(edge, /schedulePreviewResult/);
  assert.match(workspace, /Versioned adapter contracts/);
  assert.match(workspace, /Approve exact version for company/);
  assert.match(workspace, /Company adapter review history/);
  assert.match(workspace, /Dependency schedule preview/);
  assert.match(workspace, /Dispatch: permanently OFF/);

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
  assert.match(edge, /userClient\.from\("discovery_orchestration_step_preflight"\)/);
  assert.match(edge, /company_worker_grant_active,company_worker_grant_expires_at,worker_identity_scope_available/);
  assert.match(edge, /crypto\.getRandomValues/);
  assert.match(edge, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(workspace, /Grant temporary worker identity/);
  assert.match(workspace, /Copy one-time credential/);
  assert.match(workspace, /workerStageKeys/);
  assert.match(workspace, /maxActiveLeases/);
  assert.match(workspace, /Type \{worker\.worker_key\} to revoke/);
  assert.match(workspace, /Worker grant history/);
  assert.match(workspace, /I reviewed this exact stage scope/);
  assert.match(workspace, /workerGrantConfirmed/);
  assert.match(workerMigration, /Re-check live execution gates on every heartbeat/);
  assert.match(workerMigration, /pf\.dispatch_permitted=true/);
  assert.match(integration, /heartbeat must fail closed while E20 preflight dispatch_permitted remains false/);
  assert.ok(!workspace.includes("localStorage.setItem(workerToken"));
  assert.match(workerEdge, /x-axivestra-worker-token/);
  assert.match(workerEdge, /claim_discovery_orchestration_lease/);
  assert.match(workerEdge, /heartbeat_discovery_orchestration_lease/);
  assert.match(workerEdge, /release_discovery_orchestration_lease/);
  assert.match(workerEdge, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(workerEdge, /configuredPublicKeys/);
  assert.match(workerEdge, /function defaultKeyFromJson/);
  assert.match(workerEdge, /SUPABASE_SECRET_KEYS/);
  assert.match(workerEdge, /x-axivestra-worker-token/);
  assert.match(workerEdge, /Cache-Control/);
  assert.doesNotMatch(workerEdge, /console\.(?:log|error)\([^)]*(?:rawWorkerToken|leaseToken|leaseTokenHash|workerCredentialHash)/i);
  assert.match(workerEdge, /subtle\.digest\("SHA-256"/);
  assert.match(workerEdge, /crypto\.getRandomValues/);
  assert.match(workerEdge, /Never include database details, input, authorization headers, hashes or tokens in logs\/responses/i);
  assert.match(config, /\[functions\.discovery-orchestration-worker\]\nverify_jwt = false/);
  assert.match(leaseClient, /createOrchestrationLeaseClient/);
  assert.match(leaseClient, /fetchImpl/);
  assert.match(leaseClient, /x-axivestra-worker-token/);
  assert.match(leaseClient, /functions\/v1\/discovery-orchestration-worker/);
  assert.doesNotMatch(leaseClient, /SUPABASE_SERVICE_ROLE_KEY|service_role|admin\.rpc|p_worker_credential_hash|p_lease_token_hash/);
  assert.match(leaseClient, /leaseTokens = new Map/);
  assert.match(leaseClientTest, /E20\.4 worker client calls the narrow broker/);
  assert.match(leaseClientTest, /fails closed/);
  assert.match(leaseClientTest, /forgotten its token/);
  assert.match(leaseClientTest, /never calls the service role/);


  assert.doesNotMatch(executionMigration, /create or replace function public[.](claim|heartbeat|complete|retry)_discovery_orchestration/i);
  assert.match(integration, /E20\.2 must create no worker lease, execution, completion, retry or dispatch RPCs/);
  assert.match(integration, /E20\.4 must expose exactly the explicit claim\/heartbeat\/release broker RPCs/);
  assert.match(integration, /authenticated_can_heartbeat/);
  assert.match(integration, /service_can_release/);
  assert.match(leaseClientTest, /worker requests carry only the public API key and its own scoped token/);
  assert.match(leaseClientTest, /service-role credentials must never enter the worker process/);
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
