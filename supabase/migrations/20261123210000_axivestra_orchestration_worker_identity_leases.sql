-- AXIVESTRA E20.4: scoped worker identities and controlled lease lifecycle.
-- Worker grants are temporary, company-scoped and stage-scoped.
-- Lease RPCs are service-role-only and still honor the permanently-false E20 dispatch gate.
begin;

create table if not exists public.discovery_orchestration_worker_identities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  worker_key text not null check(worker_key ~ '^[a-z0-9][a-z0-9._-]{2,79}$'),
  display_name text not null check(length(trim(display_name)) between 3 and 120),
  credential_hash text not null check(credential_hash ~ '^[a-f0-9]{64}$'),
  stage_keys text[] not null check(cardinality(stage_keys) between 1 and 9),
  max_active_leases integer not null default 1 check(max_active_leases between 1 and 4),
  lease_seconds integer not null default 120 check(lease_seconds between 15 and 300),
  status text not null default 'active' check(status in ('active','paused','revoked')),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  granted_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  reason text not null check(length(trim(reason)) between 10 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,id),
  unique(company_id,worker_key),
  unique(company_id,credential_hash)
);
create index if not exists discovery_orchestration_workers_active_idx
  on public.discovery_orchestration_worker_identities(company_id,status,expires_at);

create table if not exists public.discovery_orchestration_worker_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  worker_identity_id uuid not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check(event_type in (
    'worker_granted','worker_token_rotated','worker_paused','worker_resumed','worker_revoked',
    'lease_granted','lease_heartbeat','lease_released','lease_expired'
  )),
  worker_key_snapshot text not null,
  stage_keys_snapshot text[] not null,
  reason text not null check(length(trim(reason)) between 10 and 1000),
  details jsonb not null default '{}'::jsonb
    check(jsonb_typeof(details)='object' and octet_length(details::text)<=3000),
  occurred_at timestamptz not null default now(),
  foreign key(company_id,worker_identity_id)
    references public.discovery_orchestration_worker_identities(company_id,id) on delete restrict
);
create index if not exists discovery_orchestration_worker_events_idx
  on public.discovery_orchestration_worker_events(company_id,worker_identity_id,occurred_at desc);

alter table public.discovery_orchestration_execution_leases
  add column if not exists worker_identity_id uuid;
alter table public.discovery_orchestration_execution_leases
  add constraint discovery_orchestration_execution_lease_worker_fk
  foreign key(company_id,worker_identity_id)
  references public.discovery_orchestration_worker_identities(company_id,id) on delete restrict;

alter table public.discovery_orchestration_worker_identities enable row level security;
alter table public.discovery_orchestration_worker_events enable row level security;
drop policy if exists discovery_orchestration_worker_identities_admin_read
  on public.discovery_orchestration_worker_identities;
create policy discovery_orchestration_worker_identities_admin_read
  on public.discovery_orchestration_worker_identities for select to authenticated
  using(exists(
    select 1 from public.company_memberships m
    where m.company_id=discovery_orchestration_worker_identities.company_id
      and m.user_id=auth.uid() and m.role in ('owner','admin')
  ));
drop policy if exists discovery_orchestration_worker_events_admin_read
  on public.discovery_orchestration_worker_events;
create policy discovery_orchestration_worker_events_admin_read
  on public.discovery_orchestration_worker_events for select to authenticated
  using(exists(
    select 1 from public.company_memberships m
    where m.company_id=discovery_orchestration_worker_events.company_id
      and m.user_id=auth.uid() and m.role in ('owner','admin')
  ));

revoke all on public.discovery_orchestration_worker_identities,
  public.discovery_orchestration_worker_events from public,anon,authenticated,service_role;
grant select on public.discovery_orchestration_worker_identities,
  public.discovery_orchestration_worker_events to service_role;
-- The credential-bearing identity table is not readable directly by authenticated users.
-- Owners/admins use the safe worker directory view; service_role retains internal access.
grant select on public.discovery_orchestration_worker_events to authenticated;

-- A directory view deliberately excludes credential_hash and the raw lease-token hash.
create or replace view public.discovery_orchestration_worker_directory as
select id,company_id,worker_key,display_name,stage_keys,max_active_leases,lease_seconds,
       status,expires_at,last_used_at,granted_by,updated_by,reason,created_at,updated_at
from public.discovery_orchestration_worker_identities
where exists(
  select 1 from public.company_memberships m
  where m.company_id=discovery_orchestration_worker_identities.company_id
    and m.user_id=auth.uid() and m.role in ('owner','admin')
);
grant select on public.discovery_orchestration_worker_directory to authenticated,service_role;

-- The previous E20.2 table grant exposed lease_token_hash to authenticated members.
-- Replace it with a safe directory view that never returns the hash.
revoke all on public.discovery_orchestration_execution_leases from public,anon,authenticated,service_role;
grant select on public.discovery_orchestration_execution_leases to service_role;
create or replace view public.discovery_orchestration_execution_lease_inbox as
select id,company_id,execution_id,worker_identity_id,worker_identity,
       leased_at,expires_at,heartbeat_at,released_at,release_reason,created_at
from public.discovery_orchestration_execution_leases
where public.is_company_member(company_id);
grant select on public.discovery_orchestration_execution_lease_inbox to authenticated,service_role;

create or replace function public.prevent_discovery_orchestration_worker_event_mutation()
returns trigger language plpgsql
as $guard$
begin
  raise exception 'Worker grant events are append-only; create a new event instead.';
end;
$guard$;
drop trigger if exists discovery_orchestration_worker_events_immutable
  on public.discovery_orchestration_worker_events;
create trigger discovery_orchestration_worker_events_immutable
  before update or delete on public.discovery_orchestration_worker_events
  for each row execute function public.prevent_discovery_orchestration_worker_event_mutation();
revoke update,delete on public.discovery_orchestration_worker_events from public,anon,authenticated,service_role;

create or replace function public.release_discovery_orchestration_worker_leases(
  p_company_id uuid,p_worker_identity_id uuid,p_reason text,p_actor_user_id uuid
) returns integer
language plpgsql security definer
set search_path=public,pg_temp
as $release$
declare
  v_lease record;
  v_count integer:=0;
begin
  for v_lease in
    select l.id,l.execution_id,l.worker_identity_id,l.worker_identity,e.state,e.attempt_count,
           w.worker_key,w.stage_keys
    from public.discovery_orchestration_execution_leases l
    join public.discovery_orchestration_executions e
      on e.company_id=l.company_id and e.id=l.execution_id
    join public.discovery_orchestration_worker_identities w
      on w.company_id=l.company_id and w.id=l.worker_identity_id
    where l.company_id=p_company_id and l.released_at is null
      and (p_worker_identity_id is null or l.worker_identity_id=p_worker_identity_id)
    for update of l,e skip locked
  loop
    update public.discovery_orchestration_execution_leases
      set released_at=clock_timestamp(),release_reason=left(p_reason,500)
      where company_id=p_company_id and id=v_lease.id and released_at is null;
    update public.discovery_orchestration_executions
      set state='ready',updated_at=clock_timestamp()
      where company_id=p_company_id and id=v_lease.execution_id and state='leased';
    insert into public.discovery_orchestration_execution_events(
      company_id,execution_id,actor_user_id,event_type,previous_state,new_state,
      attempt_number,reason,details
    ) values(
      p_company_id,v_lease.execution_id,p_actor_user_id,'lease_released',v_lease.state,'ready',
      v_lease.attempt_count,left(p_reason,1000),
      jsonb_build_object('workerKey',v_lease.worker_key,'revoked',true)
    );
    insert into public.discovery_orchestration_worker_events(
      company_id,worker_identity_id,actor_user_id,event_type,worker_key_snapshot,
      stage_keys_snapshot,reason,details
    ) values(
      p_company_id,v_lease.worker_identity_id,p_actor_user_id,'lease_released',
      v_lease.worker_key,v_lease.stage_keys,left(p_reason,1000),
      jsonb_build_object('executionId',v_lease.execution_id,'leaseId',v_lease.id)
    );
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$release$;
revoke all on function public.release_discovery_orchestration_worker_leases(uuid,uuid,text,uuid)
  from public,anon,authenticated,service_role;

create or replace function public.grant_discovery_orchestration_worker_identity(
  p_company_id uuid,p_worker_key text,p_display_name text,p_credential_hash text,
  p_stage_keys text[],p_max_active_leases integer,p_lease_seconds integer,
  p_expires_at timestamptz,p_reason text
) returns table(
  worker_identity_id uuid,worker_key text,display_name text,stage_keys text[],
  max_active_leases integer,lease_seconds integer,status text,expires_at timestamptz
)
language plpgsql security definer
set search_path=public,pg_temp
as $grant$
declare
  v_actor uuid:=auth.uid();
  v_role text;
  v_control public.discovery_company_worker_controls%rowtype;
  v_worker public.discovery_orchestration_worker_identities%rowtype;
  v_event_type text;
begin
  if v_actor is null then raise exception 'Authenticated user context is required.' using errcode='42501'; end if;
  select role into v_role from public.company_memberships
    where company_id=p_company_id and user_id=v_actor;
  if coalesce(v_role,'') not in ('owner','admin') then
    raise exception 'Only company owners/admins can grant orchestration worker identity.' using errcode='42501';
  end if;
  if p_worker_key is null or p_worker_key<>trim(p_worker_key)
    or p_worker_key !~ '^[a-z0-9][a-z0-9._-]{2,79}$' then
    raise exception 'Worker key must be 3–80 lowercase letters, digits, dot, underscore or dash.' using errcode='22023';
  end if;
  if p_display_name is null or length(trim(p_display_name))<3 or length(p_display_name)>120 then
    raise exception 'Worker display name must be 3–120 characters.' using errcode='22023';
  end if;
  if p_credential_hash is null or p_credential_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'A SHA-256 worker credential hash is required.' using errcode='22023';
  end if;
  if p_stage_keys is null or cardinality(p_stage_keys)<1 or cardinality(p_stage_keys)>9
    or exists(select 1 from unnest(p_stage_keys) as requested(stage_key) where requested.stage_key is null)
    or cardinality(p_stage_keys)<>(select count(distinct requested.stage_key) from unnest(p_stage_keys) as requested(stage_key))
    or exists(select 1 from unnest(p_stage_keys) as requested(stage_key)
      where not exists(select 1 from public.discovery_orchestration_stage_registry r where r.stage_key=requested.stage_key)) then
    raise exception 'Select 1–9 distinct, registered orchestration stage keys.' using errcode='22023';
  end if;
  if coalesce(p_max_active_leases,0) not between 1 and 4 then
    raise exception 'Maximum active leases must be between 1 and 4.' using errcode='22023';
  end if;
  if coalesce(p_lease_seconds,0) not between 15 and 300 then
    raise exception 'Lease duration must be between 15 and 300 seconds.' using errcode='22023';
  end if;
  if p_reason is null or p_reason<>trim(p_reason) or length(p_reason)<10 or length(p_reason)>1000 then
    raise exception 'A reason of 10–1000 characters is required.' using errcode='22023';
  end if;
  select * into v_control from public.discovery_company_worker_controls
    where company_id=p_company_id for share;
  if not found or v_control.enabled is not true or v_control.expires_at<=clock_timestamp() then
    raise exception 'The temporary company worker grant must be active before granting a scoped orchestration worker.' using errcode='42501';
  end if;
  if p_expires_at is null or p_expires_at<=clock_timestamp()
    or p_expires_at>v_control.expires_at
    or p_expires_at>clock_timestamp()+interval '1 hour' then
    raise exception 'Worker identity expiry must be future and no later than the company worker grant (maximum one hour).' using errcode='22023';
  end if;

  select * into v_worker from public.discovery_orchestration_worker_identities
    where company_id=p_company_id and worker_key=p_worker_key for update;
  v_event_type:=case when not found then 'worker_granted' else 'worker_token_rotated' end;
  if found and v_worker.credential_hash=p_credential_hash then
    raise exception 'A new random worker credential is required when re-granting or rotating an identity.' using errcode='22023';
  end if;
  if found then
    perform public.release_discovery_orchestration_worker_leases(
      p_company_id,v_worker.id,'Worker credential rotated; active leases were released for re-authentication.',v_actor
    );
  end if;

  insert into public.discovery_orchestration_worker_identities(
    company_id,worker_key,display_name,credential_hash,stage_keys,
    max_active_leases,lease_seconds,status,expires_at,granted_by,updated_by,reason
  ) values(
    p_company_id,p_worker_key,trim(p_display_name),p_credential_hash,p_stage_keys,
    p_max_active_leases,p_lease_seconds,'active',p_expires_at,v_actor,v_actor,trim(p_reason)
  )
  on conflict(company_id,worker_key) do update set
    display_name=excluded.display_name,
    credential_hash=excluded.credential_hash,
    stage_keys=excluded.stage_keys,
    max_active_leases=excluded.max_active_leases,
    lease_seconds=excluded.lease_seconds,
    status='active',
    expires_at=excluded.expires_at,
    updated_by=excluded.updated_by,
    reason=excluded.reason,
    updated_at=clock_timestamp()
  returning * into v_worker;

  insert into public.discovery_orchestration_worker_events(
    company_id,worker_identity_id,actor_user_id,event_type,worker_key_snapshot,
    stage_keys_snapshot,reason,details
  ) values(
    p_company_id,v_worker.id,v_actor,v_event_type,v_worker.worker_key,v_worker.stage_keys,
    trim(p_reason),jsonb_build_object(
      'expiresAt',v_worker.expires_at,'maxActiveLeases',v_worker.max_active_leases,
      'leaseSeconds',v_worker.lease_seconds,'credentialRotated',true
    )
  );

  return query select v_worker.id,v_worker.worker_key,v_worker.display_name,v_worker.stage_keys,
    v_worker.max_active_leases,v_worker.lease_seconds,v_worker.status,v_worker.expires_at;
end;
$grant$;

create or replace function public.set_discovery_orchestration_worker_identity_status(
  p_company_id uuid,p_worker_identity_id uuid,p_status text,p_reason text
) returns table(worker_identity_id uuid,worker_key text,status text,expires_at timestamptz,released_leases integer)
language plpgsql security definer
set search_path=public,pg_temp
as $status$
declare
  v_actor uuid:=auth.uid();
  v_role text;
  v_worker public.discovery_orchestration_worker_identities%rowtype;
  v_control public.discovery_company_worker_controls%rowtype;
  v_released integer:=0;
  v_event text;
begin
  if v_actor is null then raise exception 'Authenticated user context is required.' using errcode='42501'; end if;
  select role into v_role from public.company_memberships
    where company_id=p_company_id and user_id=v_actor;
  if coalesce(v_role,'') not in ('owner','admin') then
    raise exception 'Only company owners/admins can control orchestration worker identity.' using errcode='42501';
  end if;
  if coalesce(p_status,'') not in ('active','paused','revoked') then
    raise exception 'Worker status must be active, paused or revoked.' using errcode='22023';
  end if;
  if p_reason is null or p_reason<>trim(p_reason) or length(p_reason)<10 or length(p_reason)>1000 then
    raise exception 'A reason of 10–1000 characters is required.' using errcode='22023';
  end if;
  -- Use the same company-grant→worker lock order as claims and grant revocation.
  if p_status='active' then
    select * into v_control from public.discovery_company_worker_controls c
      where c.company_id=p_company_id and c.enabled=true and c.expires_at>clock_timestamp()
      for share;
    if not found then
      raise exception 'An active, unexpired company worker grant is required to resume an identity.' using errcode='42501';
    end if;
  end if;
  select * into v_worker from public.discovery_orchestration_worker_identities
    where company_id=p_company_id and id=p_worker_identity_id for update;
  if not found then raise exception 'Worker identity not found in this company.' using errcode='P0002'; end if;
  if p_status='active' then
    if v_worker.status='revoked' then
      raise exception 'Revoked identities must be re-granted with a newly issued credential.' using errcode='22023';
    end if;
    if v_worker.expires_at<=clock_timestamp()
      or v_worker.expires_at>v_control.expires_at then
      raise exception 'An identity expiry no later than the active company grant is required.' using errcode='42501';
    end if;
    v_event:='worker_resumed';
  else
    v_event:=case when p_status='revoked' then 'worker_revoked' else 'worker_paused' end;
  end if;
  update public.discovery_orchestration_worker_identities
    set status=p_status,updated_by=v_actor,reason=trim(p_reason),updated_at=clock_timestamp()
    where company_id=p_company_id and id=p_worker_identity_id
    returning * into v_worker;
  if p_status in ('paused','revoked') then
    v_released:=public.release_discovery_orchestration_worker_leases(
      p_company_id,p_worker_identity_id,'Worker identity was '||p_status||'; active orchestration leases were released.',v_actor
    );
  end if;
  insert into public.discovery_orchestration_worker_events(
    company_id,worker_identity_id,actor_user_id,event_type,worker_key_snapshot,
    stage_keys_snapshot,reason,details
  ) values(
    p_company_id,v_worker.id,v_actor,v_event,v_worker.worker_key,v_worker.stage_keys,trim(p_reason),
    jsonb_build_object('status',v_worker.status,'releasedLeases',v_released)
  );
  return query select v_worker.id,v_worker.worker_key,v_worker.status,v_worker.expires_at,v_released;
end;
$status$;

create or replace function public.prevent_worker_dispatch_when_company_grant_revoked()
returns trigger language plpgsql security definer
set search_path=public,pg_temp
as $trigger$
declare v_worker record;
begin
  if new.enabled is true and new.expires_at>clock_timestamp() then
    if tg_op<>'UPDATE' then return new; end if;
    if old.enabled is not true then return new; end if;
    if new.expires_at>=old.expires_at then return new; end if;
    -- Shortening a still-active company grant must release leases immediately;
    -- otherwise an old lease could outlive the newly shortened authority.
  end if;
  for v_worker in
    update public.discovery_orchestration_worker_identities
      set status='paused',updated_by=new.updated_by,updated_at=clock_timestamp(),
          reason='Paused automatically because the company worker grant was disabled, shortened or expired.'
      where company_id=new.company_id and status='active'
      returning id,worker_key,stage_keys
  loop
    perform public.release_discovery_orchestration_worker_leases(
      new.company_id,v_worker.id,
      'Company worker grant was disabled, shortened or expired; active orchestration leases were released.',
      new.updated_by
    );
    insert into public.discovery_orchestration_worker_events(
      company_id,worker_identity_id,actor_user_id,event_type,worker_key_snapshot,
      stage_keys_snapshot,reason,details
    ) values(
      new.company_id,v_worker.id,new.updated_by,'worker_paused',v_worker.worker_key,v_worker.stage_keys,
      'Company worker grant was disabled, shortened or expired; worker identity paused immediately.',
      jsonb_build_object('source','company_worker_grant','newExpiresAt',new.expires_at)
    );
  end loop;
  return new;
end;
$trigger$;
drop trigger if exists discovery_orchestration_worker_company_grant_gate
  on public.discovery_company_worker_controls;
create trigger discovery_orchestration_worker_company_grant_gate
  after insert or update of enabled,expires_at on public.discovery_company_worker_controls
  for each row execute function public.prevent_worker_dispatch_when_company_grant_revoked();

create or replace function public.expire_discovery_orchestration_leases(
  p_company_id uuid,p_limit integer default 100
) returns integer
language plpgsql security definer
set search_path=public,pg_temp
as $expire$
declare v_lease record; v_count integer:=0;
begin
  if p_limit<1 or p_limit>500 then
    raise exception 'Lease expiry batch must be between 1 and 500.' using errcode='22023';
  end if;
  for v_lease in
    select l.id,l.execution_id,l.worker_identity_id,l.worker_identity,e.state,e.attempt_count,
           w.worker_key,w.stage_keys
    from public.discovery_orchestration_execution_leases l
    join public.discovery_orchestration_executions e
      on e.company_id=l.company_id and e.id=l.execution_id
    join public.discovery_orchestration_worker_identities w
      on w.company_id=l.company_id and w.id=l.worker_identity_id
    where l.company_id=p_company_id and l.released_at is null and l.expires_at<=clock_timestamp()
    order by l.expires_at for update of l,e skip locked limit p_limit
  loop
    update public.discovery_orchestration_execution_leases
      set released_at=clock_timestamp(),release_reason='Lease expired; E20.4 returned the execution to ready without incrementing attempt count.'
      where company_id=p_company_id and id=v_lease.id and released_at is null;
    update public.discovery_orchestration_executions set state='ready',updated_at=clock_timestamp()
      where company_id=p_company_id and id=v_lease.execution_id and state='leased';
    insert into public.discovery_orchestration_execution_events(
      company_id,execution_id,event_type,previous_state,new_state,attempt_number,reason,details
    ) values(
      p_company_id,v_lease.execution_id,'lease_expired',v_lease.state,'ready',v_lease.attempt_count,
      'Lease expired; the execution returned to ready without an attempt retry decision.',
      jsonb_build_object('workerKey',v_lease.worker_key,'leaseId',v_lease.id)
    );
    insert into public.discovery_orchestration_worker_events(
      company_id,worker_identity_id,event_type,worker_key_snapshot,stage_keys_snapshot,reason,details
    ) values(
      p_company_id,v_lease.worker_identity_id,'lease_expired',v_lease.worker_key,v_lease.stage_keys,
      'Lease expired; execution returned to ready.',
      jsonb_build_object('executionId',v_lease.execution_id,'leaseId',v_lease.id)
    );
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$expire$;

create or replace function public.claim_discovery_orchestration_lease(
  p_company_id uuid,p_worker_identity_id uuid,p_worker_credential_hash text,
  p_lease_token_hash text,p_lease_seconds integer default 120
) returns table(
  lease_id uuid,execution_id uuid,run_id uuid,step_id uuid,stage_key text,
  adapter_key text,worker_identity text,leased_at timestamptz,expires_at timestamptz
)
language plpgsql security definer
set search_path=public,pg_temp
as $claim$
declare
  v_now timestamptz:=clock_timestamp();
  v_worker public.discovery_orchestration_worker_identities%rowtype;
  v_execution public.discovery_orchestration_executions%rowtype;
  v_adapter public.discovery_orchestration_adapter_contracts%rowtype;
  v_run public.discovery_orchestration_runs%rowtype;
  v_company_worker_control public.discovery_company_worker_controls%rowtype;
  v_lease_id uuid;
  v_seconds integer;
  v_active integer;
begin
  if p_worker_credential_hash is null or p_worker_credential_hash !~ '^[a-f0-9]{64}$'
    or p_lease_token_hash is null or p_lease_token_hash !~ '^[a-f0-9]{64}$'
    or coalesce(p_lease_seconds,0) not between 15 and 300 then
    raise exception 'Worker credential, lease token or lease duration is invalid.' using errcode='22023';
  end if;
  -- Serialize claims within the company so adapter/company and run concurrency limits
  -- cannot race across two different scoped worker identities.
  perform 1 from public.companies where id=p_company_id for update;
  if not found then return; end if;

  -- Hold a shared lock on the existing one-hour global grant. Revocation obtains an
  -- exclusive row lock and then releases every active scoped lease after this claim commits.
  select * into v_company_worker_control
    from public.discovery_company_worker_controls
    where company_id=p_company_id and enabled=true and expires_at>v_now
    for share;
  if not found then return; end if;

  -- Lock the scoped worker before lease rows. Pause/revoke uses the same worker→lease order.
  select * into v_worker from public.discovery_orchestration_worker_identities
    where company_id=p_company_id and id=p_worker_identity_id
      and status='active' and expires_at>v_now and credential_hash=p_worker_credential_hash
    for update;
  if not found then return; end if;

  perform public.expire_discovery_orchestration_leases(p_company_id,100);

  select count(*)::integer into v_active
    from public.discovery_orchestration_execution_leases l
    where l.company_id=p_company_id and l.worker_identity_id=v_worker.id
      and l.released_at is null and l.expires_at>v_now;
  if v_active>=v_worker.max_active_leases then return; end if;

  select e.* into v_execution
    from public.discovery_orchestration_executions e
    join public.discovery_orchestration_steps s
      on s.company_id=e.company_id and s.id=e.step_id and s.run_id=e.run_id
    join public.discovery_orchestration_runs r
      on r.company_id=e.company_id and r.id=e.run_id
    join public.discovery_orchestration_stage_registry g
      on g.stage_key=s.stage_key and g.dispatch_ready=true and g.adapter_key=e.adapter_key
    join public.discovery_orchestration_company_stage_controls sc
      on sc.company_id=e.company_id and sc.stage_key=s.stage_key and sc.enabled=true
    join public.discovery_orchestration_adapter_contracts a
      on a.adapter_key=e.adapter_key and a.stage_key=s.stage_key and a.enabled=true
    join public.discovery_orchestration_step_preflight pf
      on pf.company_id=e.company_id and pf.run_id=e.run_id and pf.step_id=e.step_id
        and pf.dispatch_permitted=true and cardinality(pf.blocker_codes)=0
    where e.company_id=p_company_id and e.state='ready' and e.available_at<=v_now
      and e.attempt_count<e.max_attempts and r.status='approved_not_dispatched'
      and s.status in ('planned','ready') and s.stage_key=any(v_worker.stage_keys)
      and s.permission_class=a.required_permission_class
    order by e.available_at,e.created_at
    for update of e skip locked limit 1;
  if not found then return; end if;

  select * into v_adapter from public.discovery_orchestration_adapter_contracts
    where adapter_key=v_execution.adapter_key;
  select * into v_run from public.discovery_orchestration_runs
    where company_id=p_company_id and id=v_execution.run_id
    for update;
  select count(*)::integer into v_active
    from public.discovery_orchestration_execution_leases l
    join public.discovery_orchestration_executions e on e.company_id=l.company_id and e.id=l.execution_id
    where l.company_id=p_company_id and e.adapter_key=v_execution.adapter_key
      and l.released_at is null and l.expires_at>v_now;
  if v_active>=v_adapter.max_parallel_per_company then return; end if;

  select count(*)::integer into v_active
    from public.discovery_orchestration_execution_leases l
    join public.discovery_orchestration_executions e on e.company_id=l.company_id and e.id=l.execution_id
    where l.company_id=p_company_id and e.run_id=v_run.id
      and l.released_at is null and l.expires_at>v_now;
  if v_active>=v_run.max_parallel_steps then return; end if;

  v_seconds:=least(p_lease_seconds,v_worker.lease_seconds,v_adapter.lease_seconds,
    greatest(0,floor(extract(epoch from (v_worker.expires_at-v_now)))::integer),
    greatest(0,floor(extract(epoch from (v_company_worker_control.expires_at-v_now)))::integer));
  if v_seconds<15 then return; end if;

  insert into public.discovery_orchestration_execution_leases(
    company_id,execution_id,worker_identity_id,lease_token_hash,worker_identity,
    leased_at,expires_at,heartbeat_at
  ) values(
    p_company_id,v_execution.id,v_worker.id,p_lease_token_hash,v_worker.worker_key,
    v_now,v_now+make_interval(secs=>v_seconds),v_now
  ) returning id into v_lease_id;
  update public.discovery_orchestration_executions set state='leased',updated_at=v_now
    where company_id=p_company_id and id=v_execution.id;
  update public.discovery_orchestration_worker_identities set last_used_at=v_now,updated_at=v_now
    where company_id=p_company_id and id=v_worker.id;
  insert into public.discovery_orchestration_execution_events(
    company_id,execution_id,event_type,previous_state,new_state,attempt_number,reason,details
  ) values(
    p_company_id,v_execution.id,'lease_granted',v_execution.state,'leased',v_execution.attempt_count,
    'Worker acquired a scoped, time-limited orchestration lease.',
    jsonb_build_object('workerKey',v_worker.worker_key,'leaseId',v_lease_id,'stageKey',(
      select stage_key from public.discovery_orchestration_steps where company_id=p_company_id and id=v_execution.step_id
    ))
  );
  insert into public.discovery_orchestration_worker_events(
    company_id,worker_identity_id,event_type,worker_key_snapshot,stage_keys_snapshot,reason,details
  ) values(
    p_company_id,v_worker.id,'lease_granted',v_worker.worker_key,v_worker.stage_keys,
    'Worker acquired a scoped, time-limited orchestration lease.',
    jsonb_build_object('executionId',v_execution.id,'leaseId',v_lease_id)
  );

  return query select v_lease_id,v_execution.id,v_execution.run_id,v_execution.step_id,
    (select stage_key from public.discovery_orchestration_steps where company_id=p_company_id and id=v_execution.step_id),
    v_execution.adapter_key,v_worker.worker_key,v_now,v_now+make_interval(secs=>v_seconds);
end;
$claim$;

create or replace function public.heartbeat_discovery_orchestration_lease(
  p_company_id uuid,p_lease_id uuid,p_worker_identity_id uuid,
  p_worker_credential_hash text,p_lease_token_hash text,p_lease_seconds integer default 120
) returns boolean
language plpgsql security definer
set search_path=public,pg_temp
as $heartbeat$
declare
  v_now timestamptz:=clock_timestamp();
  v_worker public.discovery_orchestration_worker_identities%rowtype;
  v_lease public.discovery_orchestration_execution_leases%rowtype;
  v_company_worker_control public.discovery_company_worker_controls%rowtype;
  v_seconds integer;
begin
  if p_worker_credential_hash is null or p_worker_credential_hash !~ '^[a-f0-9]{64}$'
    or p_lease_token_hash is null or p_lease_token_hash !~ '^[a-f0-9]{64}$'
    or coalesce(p_lease_seconds,0) not between 15 and 300 then return false; end if;
  select * into v_company_worker_control
    from public.discovery_company_worker_controls
    where company_id=p_company_id and enabled=true and expires_at>v_now
    for share;
  if not found then return false; end if;
  select * into v_worker from public.discovery_orchestration_worker_identities
    where company_id=p_company_id and id=p_worker_identity_id
      and status='active' and expires_at>v_now and credential_hash=p_worker_credential_hash
    for update;
  if not found then return false; end if;
  select * into v_lease from public.discovery_orchestration_execution_leases
    where company_id=p_company_id and id=p_lease_id and worker_identity_id=v_worker.id
      and lease_token_hash=p_lease_token_hash and released_at is null and expires_at>v_now
    for update;
  if not found then return false; end if;
  -- Re-check live execution gates on every heartbeat. A pause, cancel, revoked
  -- stage gate or changed preflight policy prevents continued work.
  if not exists(
    select 1
    from public.discovery_orchestration_executions e
    join public.discovery_orchestration_steps s
      on s.company_id=e.company_id and s.id=e.step_id and s.run_id=e.run_id
    join public.discovery_orchestration_runs r
      on r.company_id=e.company_id and r.id=e.run_id
    join public.discovery_orchestration_stage_registry g
      on g.stage_key=s.stage_key and g.dispatch_ready=true and g.adapter_key=e.adapter_key
    join public.discovery_orchestration_company_stage_controls sc
      on sc.company_id=e.company_id and sc.stage_key=s.stage_key and sc.enabled=true
    join public.discovery_orchestration_adapter_contracts a
      on a.adapter_key=e.adapter_key and a.stage_key=s.stage_key and a.enabled=true
    join public.discovery_orchestration_step_preflight pf
      on pf.company_id=e.company_id and pf.run_id=e.run_id and pf.step_id=e.step_id
        and pf.dispatch_permitted=true and cardinality(pf.blocker_codes)=0
    where e.company_id=p_company_id and e.id=v_lease.execution_id
      and e.state='leased' and r.status='approved_not_dispatched'
  ) then return false; end if;
  v_seconds:=least(p_lease_seconds,v_worker.lease_seconds,
    greatest(0,floor(extract(epoch from (v_worker.expires_at-v_now)))::integer),
    greatest(0,floor(extract(epoch from (v_company_worker_control.expires_at-v_now)))::integer));
  if v_seconds<15 then return false; end if;
  update public.discovery_orchestration_execution_leases
    set heartbeat_at=v_now,expires_at=v_now+make_interval(secs=>v_seconds)
    where company_id=p_company_id and id=p_lease_id;
  update public.discovery_orchestration_worker_identities set last_used_at=v_now
    where company_id=p_company_id and id=v_worker.id;
  insert into public.discovery_orchestration_execution_events(
    company_id,execution_id,event_type,previous_state,new_state,attempt_number,reason,details
  ) select p_company_id,v_lease.execution_id,'lease_heartbeat','leased','leased',e.attempt_count,
      'Worker renewed its active orchestration lease.',
      jsonb_build_object('workerKey',v_worker.worker_key,'leaseId',p_lease_id)
    from public.discovery_orchestration_executions e
    where e.company_id=p_company_id and e.id=v_lease.execution_id;
  insert into public.discovery_orchestration_worker_events(
    company_id,worker_identity_id,event_type,worker_key_snapshot,stage_keys_snapshot,reason,details
  ) values(
    p_company_id,v_worker.id,'lease_heartbeat',v_worker.worker_key,v_worker.stage_keys,
    'Worker renewed its active orchestration lease.',jsonb_build_object('leaseId',p_lease_id)
  );
  return true;
end;
$heartbeat$;

create or replace function public.release_discovery_orchestration_lease(
  p_company_id uuid,p_lease_id uuid,p_worker_identity_id uuid,
  p_worker_credential_hash text,p_lease_token_hash text,p_reason text
) returns boolean
language plpgsql security definer
set search_path=public,pg_temp
as $release_lease$
declare
  v_now timestamptz:=clock_timestamp();
  v_worker public.discovery_orchestration_worker_identities%rowtype;
  v_lease public.discovery_orchestration_execution_leases%rowtype;
  v_execution public.discovery_orchestration_executions%rowtype;
begin
  if p_worker_credential_hash is null or p_worker_credential_hash !~ '^[a-f0-9]{64}$'
    or p_lease_token_hash is null or p_lease_token_hash !~ '^[a-f0-9]{64}$'
    or p_reason is null or length(trim(p_reason))<10 or length(p_reason)>1000 then return false; end if;
  select w.* into v_worker from public.discovery_orchestration_worker_identities w
    where w.company_id=p_company_id and w.id=p_worker_identity_id;
  if not found or v_worker.credential_hash<>p_worker_credential_hash then return false; end if;
  select * into v_lease from public.discovery_orchestration_execution_leases
    where company_id=p_company_id and id=p_lease_id and worker_identity_id=v_worker.id
      and lease_token_hash=p_lease_token_hash and released_at is null
    for update;
  if not found then return false; end if;
  update public.discovery_orchestration_execution_leases
    set released_at=v_now,release_reason=left(trim(p_reason),500)
    where company_id=p_company_id and id=p_lease_id;
  update public.discovery_orchestration_executions set state='ready',updated_at=v_now
    where company_id=p_company_id and id=v_lease.execution_id and state='leased'
    returning * into v_execution;
  insert into public.discovery_orchestration_execution_events(
    company_id,execution_id,event_type,previous_state,new_state,attempt_number,reason,details
  ) values(
    p_company_id,v_lease.execution_id,'lease_released','leased',coalesce(v_execution.state,'ready'),
    coalesce(v_execution.attempt_count,0),trim(p_reason),jsonb_build_object('workerKey',v_worker.worker_key,'leaseId',p_lease_id)
  );
  insert into public.discovery_orchestration_worker_events(
    company_id,worker_identity_id,event_type,worker_key_snapshot,stage_keys_snapshot,reason,details
  ) values(
    p_company_id,v_worker.id,'lease_released',v_worker.worker_key,v_worker.stage_keys,
    trim(p_reason),jsonb_build_object('leaseId',p_lease_id,'executionId',v_lease.execution_id)
  );
  return true;
end;
$release_lease$;

revoke all on function public.prevent_discovery_orchestration_worker_event_mutation() from public,anon,authenticated,service_role;
revoke all on function public.prevent_worker_dispatch_when_company_grant_revoked() from public,anon,authenticated,service_role;
revoke all on function public.grant_discovery_orchestration_worker_identity(uuid,text,text,text,text[],integer,integer,timestamptz,text)
  from public,anon,authenticated,service_role;
revoke all on function public.set_discovery_orchestration_worker_identity_status(uuid,uuid,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.expire_discovery_orchestration_leases(uuid,integer)
  from public,anon,authenticated,service_role;
revoke all on function public.claim_discovery_orchestration_lease(uuid,uuid,text,text,integer)
  from public,anon,authenticated,service_role;
revoke all on function public.heartbeat_discovery_orchestration_lease(uuid,uuid,uuid,text,text,integer)
  from public,anon,authenticated,service_role;
revoke all on function public.release_discovery_orchestration_lease(uuid,uuid,uuid,text,text,text)
  from public,anon,authenticated,service_role;

grant execute on function public.grant_discovery_orchestration_worker_identity(uuid,text,text,text,text[],integer,integer,timestamptz,text)
  to authenticated;
grant execute on function public.set_discovery_orchestration_worker_identity_status(uuid,uuid,text,text)
  to authenticated;
grant execute on function public.expire_discovery_orchestration_leases(uuid,integer)
  to service_role;
grant execute on function public.claim_discovery_orchestration_lease(uuid,uuid,text,text,integer)
  to service_role;
grant execute on function public.heartbeat_discovery_orchestration_lease(uuid,uuid,uuid,text,text,integer)
  to service_role;
grant execute on function public.release_discovery_orchestration_lease(uuid,uuid,uuid,text,text,text)
  to service_role;

-- Global company grant revocation pauses scoped identities and releases their active leases.
comment on table public.discovery_orchestration_worker_identities is
  'E20.4 least-privilege worker identities. Credentials are SHA-256 hashes only; grants are company/stage scoped and expire no later than the company worker grant.';
comment on view public.discovery_orchestration_worker_directory is
  'E20.4 owner/admin directory. Credential hashes are intentionally excluded.';
comment on view public.discovery_orchestration_execution_lease_inbox is
  'E20.4 safe lease inspector. Lease-token hashes are intentionally excluded.';
comment on function public.claim_discovery_orchestration_lease(uuid,uuid,text,text,integer) is
  'Service-role-only atomic lease claim. Requires a live company grant, active scoped worker, approved adapter and dispatch_permitted preflight; preflight remains false in E20.4.';
comment on function public.heartbeat_discovery_orchestration_lease(uuid,uuid,uuid,text,text,integer) is
  'Service-role-only heartbeat. Grant, identity, lease token and expiry are rechecked on every renewal.';
comment on function public.release_discovery_orchestration_lease(uuid,uuid,uuid,text,text,text) is
  'Service-role-only explicit lease release. It returns execution to ready without deciding retry policy.';

-- Safe invoker-visible worker gate projections. The original company worker-control table
-- remains service-role-only; company members see only the active/expiry decision and whether
-- any active scoped identity covers a given stage. No worker names, credentials or control
-- change reasons are exposed by these views.
create or replace view public.discovery_orchestration_company_worker_gate
with (security_barrier=true) as
select company_id,
       (enabled is true and expires_at>clock_timestamp()) as active,
       expires_at
from public.discovery_company_worker_controls
where current_setting('request.jwt.claim.role',true)='service_role'
   or public.is_company_member(company_id);
grant select on public.discovery_orchestration_company_worker_gate to authenticated,service_role;

create or replace view public.discovery_orchestration_active_worker_stage_scopes
with (security_barrier=true) as
select wi.company_id,requested.stage_key,
       bool_or(wi.status='active' and wi.expires_at>clock_timestamp()) as active
from public.discovery_orchestration_worker_identities wi
cross join lateral unnest(wi.stage_keys) as requested(stage_key)
where current_setting('request.jwt.claim.role',true)='service_role'
   or public.is_company_member(wi.company_id)
group by wi.company_id,requested.stage_key;
grant select on public.discovery_orchestration_active_worker_stage_scopes to authenticated,service_role;

-- Preflight now checks the existing one-hour company worker grant and scoped worker coverage.
-- Preserve every E20.3 column in-place; new inspector fields are appended.
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
  coalesce(ws.active,false) as worker_identity_scope_available
from public.discovery_orchestration_steps s
join public.discovery_orchestration_runs r
  on r.company_id=s.company_id and r.id=s.run_id
join public.discovery_orchestration_stage_registry g on g.stage_key=s.stage_key
left join public.discovery_orchestration_company_stage_controls c
  on c.company_id=s.company_id and c.stage_key=s.stage_key
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

commit;
