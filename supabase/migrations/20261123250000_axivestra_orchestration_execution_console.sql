-- AXIVESTRA E20.7: read-only operational console projection.
-- Safe company-scoped queue, lease, worker and adapter readiness telemetry only.
-- This migration does not claim work, change execution state, enqueue queues or activate dispatch.
begin;

create or replace view public.discovery_orchestration_operations_inbox as
select
  e.company_id,
  e.id as execution_id,
  e.run_id,
  e.step_id,
  s.stage_key,
  e.adapter_key,
  e.state,
  e.attempt_count,
  e.max_attempts,
  e.created_at,
  e.updated_at,
  e.available_at,
  case
    when e.state in ('ready','retry_wait')
      then greatest(0,floor(extract(epoch from (statement_timestamp()-e.created_at)))::bigint)
    else null
  end as queue_age_seconds,
  case
    when e.state='retry_wait'
      then greatest(0,floor(extract(epoch from (e.available_at-statement_timestamp())))::bigint)
    else null
  end as retry_wait_seconds,
  e.last_error_code,
  e.last_error_summary,
  l.id as lease_id,
  case
    when l.id is null then 'not_leased'
    when l.expires_at<=statement_timestamp() then 'expired'
    when l.released_at is not null then 'released'
    else 'active'
  end as lease_state,
  l.worker_identity_id,
  l.worker_identity,
  wi.status as worker_status,
  wi.expires_at as worker_expires_at,
  l.leased_at,
  l.expires_at as lease_expires_at,
  l.heartbeat_at as lease_heartbeat_at,
  case
    when l.id is not null
      then greatest(0,floor(extract(epoch from (statement_timestamp()-l.heartbeat_at)))::bigint)
    else null
  end as lease_heartbeat_age_seconds,
  sr.adapter_key as stage_adapter_key,
  ac.contract_version as platform_contract_version,
  ac.enabled as platform_adapter_enabled,
  ac.reviewed_at as platform_adapter_reviewed_at,
  aa.contract_version as company_approval_contract_version,
  aa.status as company_approval_status,
  case
    when sr.adapter_key is distinct from e.adapter_key then 'stage_adapter_mismatch'
    when ac.adapter_key is null then 'contract_missing'
    when ac.enabled is not true or ac.reviewed_at is null then 'platform_review_required'
    when aa.adapter_key is null then 'company_approval_missing'
    when aa.status<>'approved' then 'company_approval_'||aa.status
    when aa.contract_version is distinct from ac.contract_version then 'company_approval_stale'
    else 'current'
  end as adapter_readiness_state
from public.discovery_orchestration_executions e
join public.discovery_orchestration_steps s
  on s.company_id=e.company_id and s.id=e.step_id and s.run_id=e.run_id
left join public.discovery_orchestration_stage_registry sr
  on sr.stage_key=s.stage_key
left join public.discovery_orchestration_adapter_contracts ac
  on ac.adapter_key=e.adapter_key
left join public.discovery_orchestration_company_adapter_approvals aa
  on aa.company_id=e.company_id and aa.adapter_key=e.adapter_key
left join lateral (
  select lease.*
  from public.discovery_orchestration_execution_leases lease
  where lease.company_id=e.company_id and lease.execution_id=e.id
  order by lease.created_at desc,lease.id desc
  limit 1
) l on true
left join public.discovery_orchestration_worker_identities wi
  on wi.company_id=l.company_id and wi.id=l.worker_identity_id
where public.is_company_member(e.company_id);

revoke all on public.discovery_orchestration_operations_inbox from public,anon,authenticated,service_role;
grant select on public.discovery_orchestration_operations_inbox to authenticated,service_role;

comment on view public.discovery_orchestration_operations_inbox is
  'E20.7 company-scoped read-only execution console. Reports queue age, retry delay, latest lease/heartbeat, worker lifecycle and adapter-version readiness. Never exposes credential/lease hashes or raw source content and cannot dispatch work.';

commit;
