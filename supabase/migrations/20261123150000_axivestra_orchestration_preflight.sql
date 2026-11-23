-- AXIVESTRA E20.1: read-only orchestration preflight projection.
-- Computes readiness/blockers; it never marks steps runnable or dispatches jobs.
begin;

create or replace view public.discovery_orchestration_step_preflight
with (security_invoker=true) as
select
  s.id as step_id,
  s.company_id,
  s.run_id,
  s.stage_key,
  s.step_order,
  s.status as planned_status,
  s.dispatch_state,
  r.status as run_status,
  r.dispatch_state as run_dispatch_state,
  coalesce(c.enabled,false) as stage_enabled,
  coalesce(g.dispatch_ready,false) as adapter_dispatch_ready,
  g.adapter_key,
  s.permission_class,
  coalesce(dep.dependency_count,0)::integer as dependency_count,
  coalesce(dep.unsatisfied_dependency_count,0)::integer as unsatisfied_dependency_count,
  coalesce(dep.unsatisfied_dependency_ids,'{}'::uuid[]) as unsatisfied_dependency_ids,
  array_remove(array[
    case when r.status<>'approved_not_dispatched' then 'run_not_approved' end,
    case when r.dispatch_state<>'ready_for_adapter_review' then 'run_dispatch_not_configured' end,
    case when not coalesce(c.enabled,false) then 'stage_kill_switch_off' end,
    case when not coalesce(g.dispatch_ready,false) or g.adapter_key is null then 'adapter_not_registered' end,
    case when coalesce(dep.unsatisfied_dependency_count,0)>0 then 'dependencies_not_satisfied' end,
    'company_worker_grant_not_checked',
    'source_and_purpose_grants_not_checked',
    'personal_data_policy_not_checked',
    'no_dispatcher_registered'
  ],null) as blocker_codes,
  false as dispatch_permitted
from public.discovery_orchestration_steps s
join public.discovery_orchestration_runs r
  on r.company_id=s.company_id and r.id=s.run_id
join public.discovery_orchestration_stage_registry g on g.stage_key=s.stage_key
left join public.discovery_orchestration_company_stage_controls c
  on c.company_id=s.company_id and c.stage_key=s.stage_key
left join lateral (
  select
    count(*)::integer as dependency_count,
    count(*) filter(where d.status<>'succeeded')::integer as unsatisfied_dependency_count,
    coalesce(array_agg(d.id order by d.step_order) filter(where d.status<>'succeeded'),'{}'::uuid[]) as unsatisfied_dependency_ids
  from unnest(s.depends_on_step_ids) required(required_id)
  left join public.discovery_orchestration_steps d
    on d.company_id=s.company_id and d.run_id=s.run_id and d.id=required.required_id
) dep on true;

grant select on public.discovery_orchestration_step_preflight to authenticated,service_role;

comment on view public.discovery_orchestration_step_preflight is
  'E20.1 read-only dry-run preflight. Blockers are explicit and dispatch_permitted is always false until a separately reviewed dispatcher and all policy adapters exist.';

commit;
