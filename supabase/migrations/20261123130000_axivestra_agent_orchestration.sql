-- AXIVESTRA technical E20: company-scoped agent orchestration control plane.
-- Roadmap alias: revised E16 Agent Orchestration.
-- This release records dependency-aware plans and human approval; it does not dispatch workers.
begin;

create table if not exists public.discovery_orchestration_stage_registry (
  stage_key text primary key,
  technical_stage text not null,
  capability_name text not null,
  description text not null,
  sequence_no integer not null unique,
  dependency_stage_keys text[] not null default '{}'::text[],
  permission_class text not null check (permission_class in
    ('source_restricted','company_internal','personal_data','derived_data')),
  adapter_key text,
  dispatch_ready boolean not null default false,
  enabled_by_default boolean not null default false,
  created_at timestamptz not null default now(),
  check (stage_key ~ '^e[0-9]{2}_[a-z0-9_]+$'),
  check (cardinality(dependency_stage_keys)<=8)
);

insert into public.discovery_orchestration_stage_registry
  (stage_key,technical_stage,capability_name,description,sequence_no,dependency_stage_keys,permission_class,adapter_key,dispatch_ready,enabled_by_default)
values
  ('e04_source_capture','E04','Source capture','Capture evidence from an explicitly approved source and allow-listed request.',4,'{}','source_restricted',null,false,false),
  ('e05_extraction','E05','Extraction & normalisation','Convert captured evidence into bounded structured records.',5,array['e04_source_capture'],'source_restricted',null,false,false),
  ('e06_entity_resolution','E06','Company intelligence','Resolve source-observed organisations to company-scoped canonical entities.',6,array['e05_extraction'],'company_internal',null,false,false),
  ('e07_professional_roles','E07','Professional role intelligence','Resolve only source-observed professional roles against reviewed entities.',7,array['e05_extraction','e06_entity_resolution'],'personal_data',null,false,false),
  ('e08_contact_validation','E08','Contact validation','Validate permitted, source-observed business contact candidates using approved checks.',8,array['e05_extraction','e06_entity_resolution'],'personal_data',null,false,false),
  ('e09_geo_resolution','E09','Geographic intelligence','Normalise source-observed business addresses and place candidates.',9,array['e05_extraction','e06_entity_resolution'],'source_restricted',null,false,false),
  ('e10_enrichment','E10','External enrichment','Cross-check permitted company attributes against separately approved sources.',10,array['e06_entity_resolution'],'source_restricted',null,false,false),
  ('e11_matching','E11','Explainable matching','Score candidate companies using deterministic, reviewable criteria.',11,array['e06_entity_resolution','e07_professional_roles','e08_contact_validation','e09_geo_resolution','e10_enrichment'],'derived_data',null,false,false),
  ('e12_deduplication','E12','Deduplication','Generate duplicate candidates for human review without automatic merging.',12,array['e06_entity_resolution'],'derived_data',null,false,false)
on conflict(stage_key) do update set
  technical_stage=excluded.technical_stage,
  capability_name=excluded.capability_name,
  description=excluded.description,
  sequence_no=excluded.sequence_no,
  dependency_stage_keys=excluded.dependency_stage_keys,
  permission_class=excluded.permission_class,
  adapter_key=excluded.adapter_key,
  dispatch_ready=excluded.dispatch_ready,
  enabled_by_default=excluded.enabled_by_default;

create table if not exists public.discovery_orchestration_workflows (
  workflow_key text primary key,
  label text not null,
  description text not null,
  stage_keys text[] not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (workflow_key ~ '^[a-z0-9_]+$'),
  check (cardinality(stage_keys) between 2 and 9)
);

insert into public.discovery_orchestration_workflows(workflow_key,label,description,stage_keys,active)
values
  ('company_identity','Company identity resolution','Capture, extract and resolve company identity using existing approved source controls.',
    array['e04_source_capture','e05_extraction','e06_entity_resolution'],true),
  ('geo_resolution','Company identity + geo resolution','Resolve company identity, then normalise source-observed business locations.',
    array['e04_source_capture','e05_extraction','e06_entity_resolution','e09_geo_resolution'],true),
  ('full_discovery','Full governed discovery plan','Plan the complete current E04–E12 discovery chain, including role, contact, geo, enrichment, matching and deduplication stages.',
    array['e04_source_capture','e05_extraction','e06_entity_resolution','e07_professional_roles','e08_contact_validation','e09_geo_resolution','e10_enrichment','e11_matching','e12_deduplication'],true)
on conflict(workflow_key) do update set
  label=excluded.label,description=excluded.description,stage_keys=excluded.stage_keys,active=excluded.active;

create table if not exists public.discovery_orchestration_company_stage_controls (
  company_id uuid not null references public.companies(id) on delete cascade,
  stage_key text not null references public.discovery_orchestration_stage_registry(stage_key) on delete restrict,
  enabled boolean not null default false,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  reason text not null default 'Disabled until an approved stage adapter and execution gate are registered.',
  primary key(company_id,stage_key),
  check (length(reason)<=500)
);

create table if not exists public.discovery_orchestration_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  workflow_key text not null references public.discovery_orchestration_workflows(workflow_key) on delete restrict,
  status text not null default 'awaiting_approval'
    check (status in ('awaiting_approval','approved_not_dispatched','rejected','paused','cancelled')),
  dispatch_state text not null default 'not_configured'
    check (dispatch_state in ('not_configured','ready_for_adapter_review')),
  idempotency_key text not null check (length(idempotency_key) between 8 and 160),
  requested_by uuid not null references auth.users(id) on delete restrict,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  decision_reason text,
  max_parallel_steps integer not null default 1 check (max_parallel_steps between 1 and 4),
  policy_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(policy_snapshot)='object' and octet_length(policy_snapshot::text)<=4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,id),
  unique(company_id,idempotency_key),
  check ((approved_by is null and approved_at is null) or (approved_by is not null and approved_at is not null)),
  check (decision_reason is null or length(decision_reason)<=1000)
);
create index if not exists discovery_orchestration_runs_inbox_idx
  on public.discovery_orchestration_runs(company_id,status,created_at desc);

create table if not exists public.discovery_orchestration_steps (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  run_id uuid not null,
  stage_key text not null references public.discovery_orchestration_stage_registry(stage_key) on delete restrict,
  step_order integer not null check (step_order between 1 and 20),
  depends_on_step_ids uuid[] not null default '{}'::uuid[],
  status text not null default 'planned'
    check (status in ('planned','blocked','ready','queued','running','succeeded','failed','skipped','cancelled')),
  dispatch_state text not null default 'adapter_not_registered'
    check (dispatch_state in ('adapter_not_registered','adapter_ready','dispatched')),
  adapter_key text,
  permission_class text not null,
  stage_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(stage_snapshot)='object' and octet_length(stage_snapshot::text)<=3000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,id),
  unique(company_id,run_id,stage_key),
  unique(company_id,run_id,step_order),
  foreign key(company_id,run_id)
    references public.discovery_orchestration_runs(company_id,id) on delete cascade
);
create index if not exists discovery_orchestration_steps_run_idx
  on public.discovery_orchestration_steps(company_id,run_id,step_order);

create table if not exists public.discovery_orchestration_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  run_id uuid not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in (
    'run_requested','run_approved_not_dispatched','run_rejected','run_paused','run_resumed','run_cancelled'
  )),
  previous_status text,
  new_status text not null,
  reason text not null check (length(reason) between 10 and 1000),
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details)='object' and octet_length(details::text)<=3000),
  occurred_at timestamptz not null default now(),
  unique(company_id,id),
  foreign key(company_id,run_id)
    references public.discovery_orchestration_runs(company_id,id) on delete cascade
);
create index if not exists discovery_orchestration_events_timeline_idx
  on public.discovery_orchestration_events(company_id,run_id,occurred_at desc);

alter table public.discovery_orchestration_company_stage_controls enable row level security;
alter table public.discovery_orchestration_runs enable row level security;
alter table public.discovery_orchestration_steps enable row level security;
alter table public.discovery_orchestration_events enable row level security;
drop policy if exists discovery_orchestration_controls_company_read on public.discovery_orchestration_company_stage_controls;
create policy discovery_orchestration_controls_company_read on public.discovery_orchestration_company_stage_controls
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists discovery_orchestration_runs_company_read on public.discovery_orchestration_runs;
create policy discovery_orchestration_runs_company_read on public.discovery_orchestration_runs
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists discovery_orchestration_steps_company_read on public.discovery_orchestration_steps;
create policy discovery_orchestration_steps_company_read on public.discovery_orchestration_steps
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists discovery_orchestration_events_company_read on public.discovery_orchestration_events;
create policy discovery_orchestration_events_company_read on public.discovery_orchestration_events
  for select to authenticated using (public.is_company_member(company_id));

revoke all on public.discovery_orchestration_stage_registry,public.discovery_orchestration_workflows,
  public.discovery_orchestration_company_stage_controls,public.discovery_orchestration_runs,
  public.discovery_orchestration_steps,public.discovery_orchestration_events
  from public,anon,authenticated,service_role;
grant select on public.discovery_orchestration_stage_registry,public.discovery_orchestration_workflows,
  public.discovery_orchestration_company_stage_controls,public.discovery_orchestration_runs,
  public.discovery_orchestration_steps,public.discovery_orchestration_events
  to authenticated,service_role;

create or replace function public.prevent_discovery_orchestration_event_mutation()
returns trigger language plpgsql
as $guard$
begin
  raise exception 'Orchestration events are append-only; create a new event instead.';
end;
$guard$;
drop trigger if exists discovery_orchestration_events_immutable on public.discovery_orchestration_events;
create trigger discovery_orchestration_events_immutable
  before update or delete on public.discovery_orchestration_events
  for each row execute function public.prevent_discovery_orchestration_event_mutation();
revoke update,delete on public.discovery_orchestration_events from public,anon,authenticated,service_role;

create or replace view public.discovery_orchestration_run_inbox
with (security_invoker=true) as
select r.id,r.company_id,r.workflow_key,w.label as workflow_label,r.status,r.dispatch_state,
  r.requested_by,r.approved_by,r.approved_at,r.decision_reason,r.max_parallel_steps,
  r.created_at,r.updated_at,
  count(s.id)::integer as stage_count,
  count(s.id) filter(where s.dispatch_state='adapter_not_registered')::integer as unavailable_adapter_count,
  count(s.id) filter(where coalesce(c.enabled,false)=false)::integer as disabled_stage_count,
  bool_and(coalesce(c.enabled,false) and coalesce(g.dispatch_ready,false)) as all_stage_gates_ready
from public.discovery_orchestration_runs r
join public.discovery_orchestration_workflows w on w.workflow_key=r.workflow_key
left join public.discovery_orchestration_steps s on s.company_id=r.company_id and s.run_id=r.id
left join public.discovery_orchestration_company_stage_controls c
  on c.company_id=s.company_id and c.stage_key=s.stage_key
left join public.discovery_orchestration_stage_registry g on g.stage_key=s.stage_key
group by r.id,w.label;

grant select on public.discovery_orchestration_run_inbox to authenticated,service_role;

create or replace function public.request_discovery_orchestration_run(
  p_company_id uuid,p_workflow_key text,p_idempotency_key text
) returns uuid
language plpgsql security definer
set search_path=public,pg_temp
as $request$
declare
  v_actor uuid:=auth.uid();
  v_role text;
  v_workflow public.discovery_orchestration_workflows%rowtype;
  v_stage public.discovery_orchestration_stage_registry%rowtype;
  v_run_id uuid;
  v_existing_workflow text;
  v_step_id uuid;
  v_dep_ids uuid[];
  v_stage_key text;
  v_order integer:=0;
begin
  if v_actor is null then raise exception 'Authenticated user context is required.' using errcode='42501'; end if;
  select role into v_role from public.company_memberships
    where company_id=p_company_id and user_id=v_actor;
  if v_role is null then raise exception 'Company membership is required.' using errcode='42501'; end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key))<8 or length(p_idempotency_key)>160 then
    raise exception 'An idempotency key of 8–160 characters is required.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||trim(p_idempotency_key),0));
  select id,workflow_key into v_run_id,v_existing_workflow
    from public.discovery_orchestration_runs
    where company_id=p_company_id and idempotency_key=trim(p_idempotency_key);
  if v_run_id is not null then
    if v_existing_workflow<>p_workflow_key then raise exception 'This idempotency key is already assigned to a different workflow.' using errcode='23505'; end if;
    return v_run_id;
  end if;
  select * into v_workflow from public.discovery_orchestration_workflows
    where workflow_key=p_workflow_key and active=true;
  if not found then raise exception 'The requested orchestration workflow is not available.' using errcode='22023'; end if;

  if exists (
    select 1
    from public.discovery_orchestration_stage_registry s
    cross join lateral unnest(s.dependency_stage_keys) dep(dep_key)
    where s.stage_key=any(v_workflow.stage_keys)
      and (not (dep.dep_key=any(v_workflow.stage_keys))
        or array_position(v_workflow.stage_keys,dep.dep_key)>=array_position(v_workflow.stage_keys,s.stage_key))
  ) then
    raise exception 'Workflow dependency graph is incomplete or not topologically ordered.' using errcode='22023';
  end if;

  insert into public.discovery_orchestration_runs(
    company_id,workflow_key,status,idempotency_key,requested_by,max_parallel_steps,policy_snapshot
  ) values (
    p_company_id,p_workflow_key,'awaiting_approval',trim(p_idempotency_key),v_actor,1,
    jsonb_build_object('human_approval_required',true,'company_worker_grant_required',true,
      'per_stage_kill_switch_required',true,'external_providers_auto_activated',false,
      'dispatch_enabled',false,'policy_version','E20-plan-only-v1')
  ) returning id into v_run_id;

  foreach v_stage_key in array v_workflow.stage_keys loop
    v_order:=v_order+1;
    select * into v_stage from public.discovery_orchestration_stage_registry where stage_key=v_stage_key;
    select coalesce(array_agg(s.id order by s.step_order),'{}'::uuid[]) into v_dep_ids
      from unnest(v_stage.dependency_stage_keys) dep(dep_key)
      join public.discovery_orchestration_steps s
        on s.company_id=p_company_id and s.run_id=v_run_id and s.stage_key=dep.dep_key;
    if cardinality(v_dep_ids)<>cardinality(v_stage.dependency_stage_keys) then
      raise exception 'Workflow dependency step was not created before its dependent stage.';
    end if;
    insert into public.discovery_orchestration_steps(
      company_id,run_id,stage_key,step_order,depends_on_step_ids,status,dispatch_state,
      adapter_key,permission_class,stage_snapshot
    ) values (
      p_company_id,v_run_id,v_stage_key,v_order,v_dep_ids,'planned','adapter_not_registered',
      v_stage.adapter_key,v_stage.permission_class,
      jsonb_build_object('technical_stage',v_stage.technical_stage,'dispatch_ready',v_stage.dispatch_ready,
        'enabled_by_default',v_stage.enabled_by_default,'dependencies',to_jsonb(v_stage.dependency_stage_keys))
    );
    insert into public.discovery_orchestration_company_stage_controls(company_id,stage_key,enabled)
      values(p_company_id,v_stage_key,false) on conflict(company_id,stage_key) do nothing;
  end loop;

  insert into public.discovery_orchestration_events(company_id,run_id,actor_user_id,event_type,
    previous_status,new_status,reason,details)
  values(p_company_id,v_run_id,v_actor,'run_requested',null,'awaiting_approval',
    'An orchestration plan was requested and is awaiting owner/admin approval.',
    jsonb_build_object('workflowKey',p_workflow_key,'stageKeys',to_jsonb(v_workflow.stage_keys)));
  return v_run_id;
end;
$request$;

create or replace function public.record_discovery_orchestration_decision(
  p_company_id uuid,p_run_id uuid,p_decision text,p_reason text
) returns uuid
language plpgsql security definer
set search_path=public,pg_temp
as $decision$
declare
  v_actor uuid:=auth.uid();
  v_role text;
  v_run public.discovery_orchestration_runs%rowtype;
  v_next_status text;
  v_event_type text;
  v_event_id uuid;
begin
  if v_actor is null then raise exception 'Authenticated user context is required.' using errcode='42501'; end if;
  select role into v_role from public.company_memberships
    where company_id=p_company_id and user_id=v_actor;
  if coalesce(v_role,'') not in ('owner','admin') then
    raise exception 'Only company owners/admins can approve or control orchestration plans.' using errcode='42501';
  end if;
  if coalesce(p_reason,'')<>trim(p_reason) or p_reason is null
    or length(trim(p_reason))<10 or length(p_reason)>1000 then
    raise exception 'A decision reason of 10–1000 characters is required.' using errcode='22023';
  end if;
  select * into v_run from public.discovery_orchestration_runs
    where company_id=p_company_id and id=p_run_id for update;
  if not found then raise exception 'Orchestration run not found in this company.' using errcode='P0002'; end if;

  if p_decision='approve' and v_run.status='awaiting_approval' then
    v_next_status:='approved_not_dispatched'; v_event_type:='run_approved_not_dispatched';
  elsif p_decision='reject' and v_run.status='awaiting_approval' then
    v_next_status:='rejected'; v_event_type:='run_rejected';
  elsif p_decision='cancel' and v_run.status in ('awaiting_approval','approved_not_dispatched','paused') then
    v_next_status:='cancelled'; v_event_type:='run_cancelled';
  elsif p_decision='pause' and v_run.status='approved_not_dispatched' then
    v_next_status:='paused'; v_event_type:='run_paused';
  elsif p_decision='resume' and v_run.status='paused' then
    v_next_status:='approved_not_dispatched'; v_event_type:='run_resumed';
  else
    raise exception 'This orchestration decision is not allowed from the current run state.' using errcode='22023';
  end if;

  update public.discovery_orchestration_runs
    set status=v_next_status,
        approved_by=case when p_decision='approve' then v_actor else approved_by end,
        approved_at=case when p_decision='approve' then clock_timestamp() else approved_at end,
        decision_reason=trim(p_reason),updated_at=clock_timestamp()
    where company_id=p_company_id and id=p_run_id;

  insert into public.discovery_orchestration_events(
    company_id,run_id,actor_user_id,event_type,previous_status,new_status,reason,details
  ) values(
    p_company_id,p_run_id,v_actor,v_event_type,v_run.status,v_next_status,trim(p_reason),
    jsonb_build_object('dispatchState','not_configured','executionStarted',false)
  ) returning id into v_event_id;
  return v_event_id;
end;
$decision$;

revoke all on function public.prevent_discovery_orchestration_event_mutation() from public,anon,authenticated,service_role;
revoke all on function public.request_discovery_orchestration_run(uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.record_discovery_orchestration_decision(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.request_discovery_orchestration_run(uuid,text,text) to authenticated;
grant execute on function public.record_discovery_orchestration_decision(uuid,uuid,text,text) to authenticated;

comment on table public.discovery_orchestration_runs is
  'E20 company-scoped orchestration plans. Approval is recorded separately from execution; this release never dispatches workers.';
comment on table public.discovery_orchestration_steps is
  'E20 dependency-aware plan steps for existing E04-E12 stage queues. All execution adapters are unregistered by default.';
comment on table public.discovery_orchestration_company_stage_controls is
  'E20 per-company, per-stage kill switches. All controls are created disabled; no user-facing enable path is provided until adapter review.';
comment on table public.discovery_orchestration_events is
  'E20 append-only request, approval, pause, resume, rejection and cancellation history.';
comment on view public.discovery_orchestration_run_inbox is
  'E20 read-only company inbox. approved_not_dispatched means human approved the plan, not that a worker has started.';

commit;
