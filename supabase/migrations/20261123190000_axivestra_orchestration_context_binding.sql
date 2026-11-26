-- AXIVESTRA E20.3: bind each orchestration run to an explicit, reviewed discovery context.
-- This is an admission-control foundation only; it does not create executions or dispatch workers.
begin;

create table if not exists public.discovery_orchestration_run_contexts (
  company_id uuid not null,
  run_id uuid not null,
  profile_id uuid not null,
  source_id uuid not null,
  purpose text not null check(length(trim(purpose)) between 5 and 500),
  required_fields text[] not null check(cardinality(required_fields) between 1 and 40),
  profile_updated_at timestamptz not null,
  source_updated_at timestamptz not null,
  bound_by uuid not null references auth.users(id) on delete restrict,
  bound_at timestamptz not null default now(),
  reason text not null check(length(trim(reason)) between 10 and 1000),
  primary key(company_id,run_id),
  foreign key(company_id,run_id)
    references public.discovery_orchestration_runs(company_id,id) on delete cascade,
  foreign key(company_id,profile_id)
    references public.discovery_profiles(company_id,id) on delete restrict,
  foreign key(company_id,source_id)
    references public.discovery_source_registry(company_id,id) on delete restrict
);

create table if not exists public.discovery_orchestration_context_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  run_id uuid not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check(event_type in ('run_context_bound','run_context_rebound')),
  profile_id uuid not null,
  source_id uuid not null,
  purpose text not null,
  required_fields text[] not null,
  profile_updated_at timestamptz not null,
  source_updated_at timestamptz not null,
  reason text not null check(length(trim(reason)) between 10 and 1000),
  occurred_at timestamptz not null default now(),
  foreign key(company_id,run_id)
    references public.discovery_orchestration_runs(company_id,id) on delete cascade
);
create index if not exists discovery_orchestration_context_events_timeline_idx
  on public.discovery_orchestration_context_events(company_id,run_id,occurred_at desc);

alter table public.discovery_orchestration_run_contexts enable row level security;
alter table public.discovery_orchestration_context_events enable row level security;
drop policy if exists discovery_orchestration_run_contexts_company_read
  on public.discovery_orchestration_run_contexts;
create policy discovery_orchestration_run_contexts_company_read
  on public.discovery_orchestration_run_contexts for select to authenticated
  using(public.is_company_member(company_id));
drop policy if exists discovery_orchestration_context_events_company_read
  on public.discovery_orchestration_context_events;
create policy discovery_orchestration_context_events_company_read
  on public.discovery_orchestration_context_events for select to authenticated
  using(public.is_company_member(company_id));

revoke all on public.discovery_orchestration_run_contexts,
  public.discovery_orchestration_context_events from public,anon,authenticated,service_role;
grant select on public.discovery_orchestration_run_contexts,
  public.discovery_orchestration_context_events to authenticated,service_role;

create or replace function public.prevent_discovery_orchestration_context_event_mutation()
returns trigger language plpgsql
as $guard$
begin
  raise exception 'Orchestration context events are append-only; create a new event instead.';
end;
$guard$;
drop trigger if exists discovery_orchestration_context_events_immutable
  on public.discovery_orchestration_context_events;
create trigger discovery_orchestration_context_events_immutable
  before update or delete on public.discovery_orchestration_context_events
  for each row execute function public.prevent_discovery_orchestration_context_event_mutation();
revoke update,delete on public.discovery_orchestration_context_events from public,anon,authenticated,service_role;

create or replace function public.bind_discovery_orchestration_run_context(
  p_company_id uuid,
  p_run_id uuid,
  p_profile_id uuid,
  p_source_id uuid,
  p_purpose text,
  p_required_fields text[],
  p_reason text
) returns uuid
language plpgsql security definer
set search_path=public,pg_temp
as $bind$
declare
  v_actor uuid:=auth.uid();
  v_role text;
  v_run public.discovery_orchestration_runs%rowtype;
  v_profile public.discovery_profiles%rowtype;
  v_source public.discovery_source_registry%rowtype;
  v_event_id uuid;
  v_event_type text;
begin
  if v_actor is null then
    raise exception 'Authenticated user context is required.' using errcode='42501';
  end if;
  select role into v_role from public.company_memberships
    where company_id=p_company_id and user_id=v_actor;
  if coalesce(v_role,'') not in ('owner','admin') then
    raise exception 'Only company owners/admins can bind orchestration execution context.' using errcode='42501';
  end if;
  if p_reason is null or p_reason<>trim(p_reason) or length(p_reason)<10 or length(p_reason)>1000 then
    raise exception 'A context-binding reason of 10–1000 characters is required.' using errcode='22023';
  end if;
  if p_purpose is null or p_purpose<>trim(p_purpose) or length(p_purpose)<5 or length(p_purpose)>500 then
    raise exception 'An exact approved purpose is required.' using errcode='22023';
  end if;
  if p_required_fields is null or cardinality(p_required_fields)<1 or cardinality(p_required_fields)>40
    or exists(select 1 from unnest(p_required_fields) as req(field_name)
      where field_name is null or field_name<>trim(field_name) or length(field_name)=0 or length(field_name)>120)
    or cardinality(p_required_fields)<>(select count(distinct field_name) from unnest(p_required_fields) as req(field_name)) then
    raise exception 'Required fields must be a unique list of 1–40 non-empty field names.' using errcode='22023';
  end if;

  select * into v_run from public.discovery_orchestration_runs
    where company_id=p_company_id and id=p_run_id for update;
  if not found then
    raise exception 'Orchestration run not found in this company.' using errcode='P0002';
  end if;
  if v_run.status<>'awaiting_approval' then
    raise exception 'Execution context can only be bound before owner/admin run approval.' using errcode='22023';
  end if;

  select * into v_profile from public.discovery_profiles
    where company_id=p_company_id and id=p_profile_id;
  if not found or v_profile.enabled is not true then
    raise exception 'The selected discovery profile does not exist or is disabled.' using errcode='22023';
  end if;
  if v_profile.purpose<>p_purpose then
    raise exception 'The supplied purpose must exactly match the enabled profile purpose.' using errcode='22023';
  end if;

  select * into v_source from public.discovery_source_registry
    where company_id=p_company_id and id=p_source_id;
  if not found or v_source.status<>'approved' then
    raise exception 'The selected source is not approved for this company.' using errcode='22023';
  end if;
  if not (p_purpose=any(v_source.allowed_purposes)) then
    raise exception 'The exact profile purpose is not approved for this source.' using errcode='42501';
  end if;
  if exists(select 1 from unnest(p_required_fields) as req(field_name)
      where not (field_name=any(v_source.allowed_fields))) then
    raise exception 'One or more required fields are outside the source field allow-list.' using errcode='42501';
  end if;
  if not exists(
    select 1 from public.discovery_profile_sources ps
    where ps.company_id=p_company_id and ps.profile_id=p_profile_id and ps.source_id=p_source_id
  ) then
    raise exception 'The approved source must be attached to the selected profile.' using errcode='42501';
  end if;

  v_event_type:=case when exists(
    select 1 from public.discovery_orchestration_run_contexts
    where company_id=p_company_id and run_id=p_run_id
  ) then 'run_context_rebound' else 'run_context_bound' end;

  insert into public.discovery_orchestration_run_contexts(
    company_id,run_id,profile_id,source_id,purpose,required_fields,
    profile_updated_at,source_updated_at,bound_by,bound_at,reason
  ) values(
    p_company_id,p_run_id,p_profile_id,p_source_id,p_purpose,p_required_fields,
    v_profile.updated_at,v_source.updated_at,v_actor,clock_timestamp(),p_reason
  )
  on conflict(company_id,run_id) do update set
    profile_id=excluded.profile_id,
    source_id=excluded.source_id,
    purpose=excluded.purpose,
    required_fields=excluded.required_fields,
    profile_updated_at=excluded.profile_updated_at,
    source_updated_at=excluded.source_updated_at,
    bound_by=excluded.bound_by,
    bound_at=excluded.bound_at,
    reason=excluded.reason;

  insert into public.discovery_orchestration_context_events(
    company_id,run_id,actor_user_id,event_type,profile_id,source_id,purpose,
    required_fields,profile_updated_at,source_updated_at,reason
  ) values(
    p_company_id,p_run_id,v_actor,v_event_type,p_profile_id,p_source_id,p_purpose,
    p_required_fields,v_profile.updated_at,v_source.updated_at,p_reason
  ) returning id into v_event_id;

  return v_event_id;
end;
$bind$;

revoke all on function public.prevent_discovery_orchestration_context_event_mutation() from public,anon,authenticated,service_role;
revoke all on function public.bind_discovery_orchestration_run_context(uuid,uuid,uuid,uuid,text,text[],text)
  from public,anon,authenticated,service_role;
grant execute on function public.bind_discovery_orchestration_run_context(uuid,uuid,uuid,uuid,text,text[],text)
  to authenticated;

create or replace view public.discovery_orchestration_run_context_status
with (security_invoker=true) as
select
  c.company_id,c.run_id,c.profile_id,c.source_id,c.purpose,c.required_fields,
  c.bound_by,c.bound_at,c.reason,c.profile_updated_at,c.source_updated_at,
  p.enabled as profile_enabled,p.purpose as current_profile_purpose,
  s.status as source_status,s.allowed_purposes,s.allowed_fields,
  (c.profile_updated_at=p.updated_at and c.source_updated_at=s.updated_at) as context_snapshot_current,
  (c.purpose=any(s.allowed_purposes)) as purpose_still_allowed,
  (c.required_fields <@ s.allowed_fields) as fields_still_allowed
from public.discovery_orchestration_run_contexts c
join public.discovery_profiles p on p.company_id=c.company_id and p.id=c.profile_id
join public.discovery_source_registry s on s.company_id=c.company_id and s.id=c.source_id;
grant select on public.discovery_orchestration_run_context_status to authenticated,service_role;

-- Keep dispatch hard-blocked. E20.3 adds explicit context blockers to the read-only projection.
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
    case when coalesce(dep.unsatisfied_dependency_count,0)>0 then 'dependencies_not_satisfied' end,
    case when ctx.run_id is null then 'run_context_missing' end,
    case when ctx.run_id is not null and not coalesce(ctx.profile_enabled,false) then 'profile_not_enabled' end,
    case when ctx.run_id is not null and coalesce(ctx.source_status,'')<>'approved' then 'source_not_approved' end,
    case when ctx.run_id is not null and not coalesce(ctx.purpose_still_allowed,false) then 'purpose_not_allowlisted' end,
    case when ctx.run_id is not null and not coalesce(ctx.fields_still_allowed,false) then 'fields_not_allowlisted' end,
    case when ctx.run_id is not null and not coalesce(ctx.context_snapshot_current,false) then 'run_context_stale' end,
    'company_worker_grant_not_checked',
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
  coalesce(ctx.fields_still_allowed,false) as fields_still_allowed
from public.discovery_orchestration_steps s
join public.discovery_orchestration_runs r
  on r.company_id=s.company_id and r.id=s.run_id
join public.discovery_orchestration_stage_registry g on g.stage_key=s.stage_key
left join public.discovery_orchestration_company_stage_controls c
  on c.company_id=s.company_id and c.stage_key=s.stage_key
left join public.discovery_orchestration_run_context_status ctx
  on ctx.company_id=s.company_id and ctx.run_id=s.run_id
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

comment on view public.discovery_orchestration_step_preflight is
  'E20.3 read-only preflight. It validates explicit profile/source/purpose/field context and freshness while dispatch_permitted remains hard-coded false.';

commit;
