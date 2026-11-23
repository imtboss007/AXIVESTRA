-- AXIVESTRA E20.5: company-specific adapter contract approval and dependency schedule preview.
-- Contracts are registered/approved globally by controlled migrations; companies approve exact versions.
-- This migration adds no runnable production adapter, dispatcher, queue bridge or worker activation.
begin;

create table if not exists public.discovery_orchestration_company_adapter_approvals (
  company_id uuid not null references public.companies(id) on delete cascade,
  adapter_key text not null references public.discovery_orchestration_adapter_contracts(adapter_key) on delete restrict,
  contract_version text not null,
  status text not null check(status in ('approved','rejected','suspended')),
  reviewed_by uuid not null references auth.users(id) on delete restrict,
  reviewed_at timestamptz not null default now(),
  review_reason text not null check(length(trim(review_reason)) between 10 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(company_id,adapter_key)
);
create index if not exists discovery_orchestration_company_adapter_approvals_status_idx
  on public.discovery_orchestration_company_adapter_approvals(company_id,status,updated_at desc);

create table if not exists public.discovery_orchestration_company_adapter_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  adapter_key text not null,
  contract_version text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check(event_type in ('approved','rejected','suspended')),
  previous_status text,
  new_status text not null check(new_status in ('approved','rejected','suspended')),
  reason text not null check(length(trim(reason)) between 10 and 1000),
  occurred_at timestamptz not null default now(),
  foreign key(company_id,adapter_key)
    references public.discovery_orchestration_company_adapter_approvals(company_id,adapter_key) on delete restrict
);
create index if not exists discovery_orchestration_company_adapter_events_idx
  on public.discovery_orchestration_company_adapter_events(company_id,adapter_key,occurred_at desc);

alter table public.discovery_orchestration_company_adapter_approvals enable row level security;
alter table public.discovery_orchestration_company_adapter_events enable row level security;
drop policy if exists discovery_orchestration_company_adapter_approvals_read
  on public.discovery_orchestration_company_adapter_approvals;
create policy discovery_orchestration_company_adapter_approvals_read
  on public.discovery_orchestration_company_adapter_approvals for select to authenticated
  using(public.is_company_member(company_id));
drop policy if exists discovery_orchestration_company_adapter_events_read
  on public.discovery_orchestration_company_adapter_events;
create policy discovery_orchestration_company_adapter_events_read
  on public.discovery_orchestration_company_adapter_events for select to authenticated
  using(public.is_company_member(company_id));

revoke all on public.discovery_orchestration_company_adapter_approvals,
  public.discovery_orchestration_company_adapter_events from public,anon,authenticated,service_role;
grant select on public.discovery_orchestration_company_adapter_approvals,
  public.discovery_orchestration_company_adapter_events to authenticated,service_role;

create or replace function public.prevent_discovery_orchestration_company_adapter_event_mutation()
returns trigger language plpgsql
as $guard$
begin
  raise exception 'Company adapter approval history is append-only; create a new event instead.';
end;
$guard$;
drop trigger if exists discovery_orchestration_company_adapter_events_immutable
  on public.discovery_orchestration_company_adapter_events;
create trigger discovery_orchestration_company_adapter_events_immutable
  before update or delete on public.discovery_orchestration_company_adapter_events
  for each row execute function public.prevent_discovery_orchestration_company_adapter_event_mutation();
revoke update,delete on public.discovery_orchestration_company_adapter_events from public,anon,authenticated,service_role;

create or replace function public.review_discovery_orchestration_company_adapter(
  p_company_id uuid,p_adapter_key text,p_contract_version text,p_decision text,p_reason text
) returns uuid
language plpgsql security definer
set search_path=public,pg_temp
as $review$
declare
  v_actor uuid:=auth.uid();
  v_role text;
  v_contract public.discovery_orchestration_adapter_contracts%rowtype;
  v_previous_status text;
  v_event_id uuid;
begin
  if v_actor is null then
    raise exception 'Authenticated user context is required.' using errcode='42501';
  end if;
  select m.role into v_role from public.company_memberships m
    where m.company_id=p_company_id and m.user_id=v_actor;
  if coalesce(v_role,'') not in ('owner','admin') then
    raise exception 'Only company owners/admins can review a company adapter contract.' using errcode='42501';
  end if;
  if p_adapter_key is null or p_adapter_key<>trim(p_adapter_key)
    or p_adapter_key !~ '^[a-z0-9][a-z0-9._-]{2,119}$' then
    raise exception 'A valid registered adapter key is required.' using errcode='22023';
  end if;
  if p_contract_version is null or p_contract_version<>trim(p_contract_version)
    or length(p_contract_version)<1 or length(p_contract_version)>80 then
    raise exception 'An exact registered contract version is required.' using errcode='22023';
  end if;
  if p_decision is null or p_decision not in ('approved','rejected','suspended') then
    raise exception 'Choose approved, rejected or suspended for this company adapter contract.' using errcode='22023';
  end if;
  if p_reason is null or p_reason<>trim(p_reason) or length(p_reason)<10 or length(p_reason)>1000 then
    raise exception 'A review reason of 10–1000 characters is required.' using errcode='22023';
  end if;

  perform 1 from public.companies where id=p_company_id for update;
  if not found then
    raise exception 'Company was not found.' using errcode='P0002';
  end if;
  select c.* into v_contract
    from public.discovery_orchestration_adapter_contracts c
    where c.adapter_key=p_adapter_key and c.contract_version=p_contract_version
    for share;
  if not found then
    raise exception 'The exact adapter contract version is not registered.' using errcode='P0002';
  end if;
  if p_decision='approved' and (
    v_contract.enabled is not true
    or v_contract.reviewed_by is null
    or v_contract.reviewed_at is null
    or length(trim(coalesce(v_contract.review_reason,'')))<10
  ) then
    raise exception 'Only a platform-reviewed, enabled adapter contract can be approved for a company.' using errcode='42501';
  end if;

  select a.status into v_previous_status
    from public.discovery_orchestration_company_adapter_approvals a
    where a.company_id=p_company_id and a.adapter_key=p_adapter_key
    for update;

  insert into public.discovery_orchestration_company_adapter_approvals(
    company_id,adapter_key,contract_version,status,reviewed_by,reviewed_at,review_reason,updated_at
  ) values(
    p_company_id,p_adapter_key,p_contract_version,p_decision,v_actor,clock_timestamp(),p_reason,clock_timestamp()
  )
  on conflict(company_id,adapter_key) do update set
    contract_version=excluded.contract_version,
    status=excluded.status,
    reviewed_by=excluded.reviewed_by,
    reviewed_at=excluded.reviewed_at,
    review_reason=excluded.review_reason,
    updated_at=excluded.updated_at;

  insert into public.discovery_orchestration_company_adapter_events(
    company_id,adapter_key,contract_version,actor_user_id,event_type,
    previous_status,new_status,reason
  ) values(
    p_company_id,p_adapter_key,p_contract_version,v_actor,p_decision,
    v_previous_status,p_decision,p_reason
  ) returning id into v_event_id;
  return v_event_id;
end;
$review$;

revoke all on function public.prevent_discovery_orchestration_company_adapter_event_mutation() from public,anon,authenticated,service_role;
revoke all on function public.review_discovery_orchestration_company_adapter(uuid,text,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.review_discovery_orchestration_company_adapter(uuid,text,text,text,text)
  to authenticated;

-- Read-only preview of dependency state. "dependencies_satisfied" is not a runnable
-- state: approval, adapter readiness, company review, worker, source and privacy gates
-- continue to block execution independently.
create or replace view public.discovery_orchestration_dependency_schedule
with (security_invoker=true) as
select
  s.company_id,s.run_id,s.id as step_id,s.stage_key,s.step_order,s.depends_on_step_ids,
  r.status as run_status,s.status as step_status,
  coalesce(dep.dependency_count,0)::integer as dependency_count,
  coalesce(dep.unsatisfied_dependency_count,0)::integer as unsatisfied_dependency_count,
  coalesce(dep.failed_dependency_count,0)::integer as failed_dependency_count,
  case
    when coalesce(dep.failed_dependency_count,0)>0 then 'blocked_by_failed_dependency'
    when coalesce(dep.unsatisfied_dependency_count,0)>0 then 'waiting_for_dependencies'
    else 'dependencies_satisfied'
  end as dependency_state,
  case
    when r.status<>'approved_not_dispatched' then 'run_approval_required'
    when coalesce(dep.failed_dependency_count,0)>0 then 'blocked_by_failed_dependency'
    when coalesce(dep.unsatisfied_dependency_count,0)>0 then 'waiting_for_dependencies'
    else 'eligible_for_policy_review_only'
  end as schedule_preview_state,
  false as dispatch_permitted
from public.discovery_orchestration_steps s
join public.discovery_orchestration_runs r
  on r.company_id=s.company_id and r.id=s.run_id
left join lateral (
  select
    count(*)::integer as dependency_count,
    count(*) filter(where d.id is null or d.status<>'succeeded')::integer as unsatisfied_dependency_count,
    count(*) filter(where d.status in ('failed','cancelled'))::integer as failed_dependency_count
  from unnest(s.depends_on_step_ids) required(required_id)
  left join public.discovery_orchestration_steps d
    on d.company_id=s.company_id and d.run_id=s.run_id and d.id=required.required_id
) dep on true
where current_setting('request.jwt.claim.role',true)='service_role'
   or public.is_company_member(s.company_id);
grant select on public.discovery_orchestration_dependency_schedule to authenticated,service_role;

create or replace view public.discovery_orchestration_step_preflight
with (security_invoker=true) as
select
  s.id as step_id,s.company_id,s.run_id,s.stage_key,s.step_order,
  s.status as planned_status,s.dispatch_state,r.status as run_status,
  r.dispatch_state as run_dispatch_state,
  coalesce(c.enabled,false) as stage_enabled,
  coalesce(g.dispatch_ready,false) as adapter_dispatch_ready,
  g.adapter_key,s.permission_class,
  coalesce(dep.dependency_count,0)::integer as dependency_count,
  coalesce(dep.unsatisfied_dependency_count,0)::integer as unsatisfied_dependency_count,
  coalesce(dep.unsatisfied_dependency_ids,'{}'::uuid[]) as unsatisfied_dependency_ids,
  array_remove(array[
    case when r.status<>'approved_not_dispatched' then 'run_not_approved' end,
    case when r.dispatch_state<>'ready_for_adapter_review' then 'run_dispatch_not_configured' end,
    case when not coalesce(c.enabled,false) then 'stage_kill_switch_off' end,
    case when not coalesce(g.dispatch_ready,false) or g.adapter_key is null then 'adapter_not_registered' end,
    case when g.adapter_key is not null and (ac.adapter_key is null or ac.enabled is not true or ac.reviewed_by is null or ac.reviewed_at is null or length(trim(coalesce(ac.review_reason,'')))<10) then 'adapter_contract_not_platform_approved' end,
    case when g.adapter_key is not null and (aa.status is distinct from 'approved' or aa.contract_version is distinct from ac.contract_version) then 'company_adapter_not_approved' end,
    case when coalesce(dep.unsatisfied_dependency_count,0)>0 then 'dependencies_not_satisfied' end,
    case when ctx.run_id is null then 'run_context_missing' end,
    case when ctx.run_id is not null and not coalesce(ctx.profile_enabled,false) then 'profile_not_enabled' end,
    case when ctx.run_id is not null and coalesce(ctx.source_status,'')<>'approved' then 'source_not_approved' end,
    case when ctx.run_id is not null and not coalesce(ctx.purpose_still_allowed,false) then 'purpose_not_allowlisted' end,
    case when ctx.run_id is not null and not coalesce(ctx.fields_still_allowed,false) then 'fields_not_allowlisted' end,
    case when ctx.run_id is not null and not coalesce(ctx.context_snapshot_current,false) then 'run_context_stale' end,
    case when not coalesce(wg.active,false) then 'company_worker_grant_inactive' end,
    case when not coalesce(ws.active,false) then 'worker_identity_scope_missing' end,
    'personal_data_policy_not_checked',
    'no_dispatcher_registered'
  ],null) as blocker_codes,
  false as dispatch_permitted,
  (ctx.run_id is not null) as execution_context_bound,
  ctx.profile_id,ctx.source_id,ctx.purpose,ctx.required_fields,
  coalesce(ctx.profile_enabled,false) as profile_enabled,
  ctx.source_status,
  coalesce(ctx.context_snapshot_current,false) as context_snapshot_current,
  coalesce(ctx.purpose_still_allowed,false) as purpose_still_allowed,
  coalesce(ctx.fields_still_allowed,false) as fields_still_allowed,
  coalesce(wg.active,false) as company_worker_grant_active,
  wg.expires_at as company_worker_grant_expires_at,
  coalesce(ws.active,false) as worker_identity_scope_available,
  coalesce(ac.enabled and ac.reviewed_by is not null and ac.reviewed_at is not null and length(trim(coalesce(ac.review_reason,'')))>=10,false) as adapter_contract_platform_approved,
  coalesce(aa.status='approved' and aa.contract_version=ac.contract_version,false) as company_adapter_approved
from public.discovery_orchestration_steps s
join public.discovery_orchestration_runs r
  on r.company_id=s.company_id and r.id=s.run_id
join public.discovery_orchestration_stage_registry g on g.stage_key=s.stage_key
left join public.discovery_orchestration_company_stage_controls c
  on c.company_id=s.company_id and c.stage_key=s.stage_key
left join public.discovery_orchestration_adapter_contracts ac
  on ac.adapter_key=g.adapter_key
left join public.discovery_orchestration_company_adapter_approvals aa
  on aa.company_id=s.company_id and aa.adapter_key=g.adapter_key
left join public.discovery_orchestration_run_context_status ctx
  on ctx.company_id=s.company_id and ctx.run_id=s.run_id
left join public.discovery_orchestration_company_worker_gate wg
  on wg.company_id=s.company_id
left join public.discovery_orchestration_active_worker_stage_scopes ws
  on ws.company_id=s.company_id and ws.stage_key=s.stage_key
left join lateral (
  select
    count(*)::integer as dependency_count,
    count(*) filter(where d.id is null or d.status<>'succeeded')::integer as unsatisfied_dependency_count,
    coalesce(array_agg(required.required_id order by required.required_id) filter(where d.id is null or d.status<>'succeeded'),'{}'::uuid[]) as unsatisfied_dependency_ids
  from unnest(s.depends_on_step_ids) required(required_id)
  left join public.discovery_orchestration_steps d
    on d.company_id=s.company_id and d.run_id=s.run_id and d.id=required.required_id
) dep on true;

grant select on public.discovery_orchestration_step_preflight to authenticated,service_role;

comment on table public.discovery_orchestration_company_adapter_approvals is
  'E20.5 company-specific approval of one exact, platform-reviewed adapter contract version. Approval does not enable the stage kill switch or dispatch.';
comment on table public.discovery_orchestration_company_adapter_events is
  'E20.5 append-only company adapter contract review history.';
comment on function public.review_discovery_orchestration_company_adapter(uuid,text,text,text,text) is
  'Owner/admin-only review of an exact platform-reviewed adapter contract version. Does not register adapters, enable stage gates or dispatch work.';
comment on view public.discovery_orchestration_dependency_schedule is
  'E20.5 read-only dependency schedule preview. It never marks work ready or enqueues existing stage queues.';
comment on view public.discovery_orchestration_step_preflight is
  'E20 preflight includes company-specific adapter version approval. Dispatch remains permanently false in this implementation.';

commit;
