-- AXIVESTRA E20.6: bounded retries, idempotent attempt receipts and lease recovery.
-- Each newly issued lease consumes exactly one attempt. No worker can dispatch while E20 preflight is hard-off.
begin;

create table if not exists public.discovery_orchestration_failure_policies (
  error_code text primary key check(error_code ~ '^[A-Z][A-Z0-9_]{2,79}$'),
  failure_class text not null check(failure_class in ('transient','rate_limited','permanent','policy_blocked','security_blocked','unknown')),
  retryable boolean not null,
  base_delay_seconds integer not null default 0 check(base_delay_seconds between 0 and 3600),
  max_delay_seconds integer not null default 0 check(max_delay_seconds between 0 and 7200),
  max_attempts integer not null default 1 check(max_attempts between 1 and 8),
  safe_summary text not null check(length(trim(safe_summary)) between 10 and 240),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check((retryable and base_delay_seconds>0 and max_delay_seconds>=base_delay_seconds)
     or (not retryable and base_delay_seconds=0 and max_delay_seconds=0))
);
insert into public.discovery_orchestration_failure_policies(
  error_code,failure_class,retryable,base_delay_seconds,max_delay_seconds,max_attempts,safe_summary
) values
  ('NETWORK_TIMEOUT','transient',true,15,240,6,'A network request timed out.'),
  ('REMOTE_5XX','transient',true,30,600,6,'The approved remote source returned a temporary server error.'),
  ('PROVIDER_UNAVAILABLE','transient',true,30,600,6,'The approved provider was temporarily unavailable.'),
  ('RATE_LIMITED','rate_limited',true,60,1800,5,'The approved source rate limit was reached.'),
  ('LEASE_EXPIRED','transient',true,15,240,5,'The worker lease expired before an outcome was recorded.'),
  ('WORKER_RELEASED','transient',true,15,120,4,'The worker released the lease without completing the attempt.'),
  ('WORKER_LOST','transient',true,30,300,4,'The worker stopped responding before completing the attempt.'),
  ('INVALID_INPUT','permanent',false,0,0,1,'The adapter rejected the input contract.'),
  ('SCHEMA_MISMATCH','permanent',false,0,0,1,'The adapter output did not satisfy its registered schema.'),
  ('SOURCE_REVOKED','policy_blocked',false,0,0,1,'The source approval is no longer valid.'),
  ('PURPOSE_REVOKED','policy_blocked',false,0,0,1,'The discovery purpose is no longer permitted.'),
  ('PERSONAL_DATA_BLOCKED','policy_blocked',false,0,0,1,'The personal-data policy gate blocked this attempt.'),
  ('AUTH_REVOKED','security_blocked',false,0,0,1,'The worker authorization is no longer valid.'),
  ('UNKNOWN_FAILURE','unknown',false,0,0,1,'The attempt failed with an unclassified error and will not be retried.')
on conflict(error_code) do update set
  failure_class=excluded.failure_class,retryable=excluded.retryable,
  base_delay_seconds=excluded.base_delay_seconds,max_delay_seconds=excluded.max_delay_seconds,
  max_attempts=excluded.max_attempts,safe_summary=excluded.safe_summary,
  enabled=true,updated_at=clock_timestamp();

alter table public.discovery_orchestration_execution_leases
  add column if not exists attempt_number integer not null default 0;
alter table public.discovery_orchestration_execution_leases
  drop constraint if exists discovery_orchestration_execution_leases_attempt_number_check;
alter table public.discovery_orchestration_execution_leases
  add constraint discovery_orchestration_execution_leases_attempt_number_check
  check(attempt_number between 0 and 8);

create table if not exists public.discovery_orchestration_execution_attempts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  execution_id uuid not null,
  lease_id uuid not null unique references public.discovery_orchestration_execution_leases(id) on delete cascade,
  attempt_number integer not null check(attempt_number between 1 and 8),
  idempotency_key text not null check(length(idempotency_key) between 8 and 160),
  status text not null default 'started' check(status in ('started','succeeded','failed','expired','released')),
  error_code text references public.discovery_orchestration_failure_policies(error_code) on delete restrict,
  failure_class text check(failure_class is null or failure_class in ('transient','rate_limited','permanent','policy_blocked','security_blocked','unknown')),
  retryable boolean not null default false,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  next_retry_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key(company_id,execution_id)
    references public.discovery_orchestration_executions(company_id,id) on delete cascade,
  unique(company_id,execution_id,attempt_number),
  unique(company_id,idempotency_key),
  check((status='started' and finished_at is null and next_retry_at is null and error_code is null)
     or (status<>'started' and finished_at is not null))
);
create index if not exists discovery_orchestration_attempts_execution_idx
  on public.discovery_orchestration_execution_attempts(company_id,execution_id,attempt_number desc);
create index if not exists discovery_orchestration_attempts_retry_idx
  on public.discovery_orchestration_execution_attempts(company_id,next_retry_at)
  where status='failed' and retryable=true;

create or replace function public.guard_discovery_orchestration_attempt_receipt()
returns trigger language plpgsql
as $attempt_guard$
begin
  if tg_op='DELETE' then
    raise exception 'Orchestration attempt receipts are immutable; retain the historical record.';
  end if;
  if old.status<>'started' then
    raise exception 'A finalized orchestration attempt receipt is immutable.';
  end if;
  if (new.id,new.company_id,new.execution_id,new.lease_id,new.attempt_number,
      new.idempotency_key,new.started_at,new.created_at)
     is distinct from
     (old.id,old.company_id,old.execution_id,old.lease_id,old.attempt_number,
      old.idempotency_key,old.started_at,old.created_at) then
    raise exception 'Orchestration attempt identity fields are immutable.';
  end if;
  if new.status='started' or new.finished_at is null then
    raise exception 'An attempt receipt can only transition once from started to a final outcome.';
  end if;
  return new;
end;
$attempt_guard$;
drop trigger if exists discovery_orchestration_attempts_immutable
  on public.discovery_orchestration_execution_attempts;
create trigger discovery_orchestration_attempts_immutable
  before update or delete on public.discovery_orchestration_execution_attempts
  for each row execute function public.guard_discovery_orchestration_attempt_receipt();
revoke all on function public.guard_discovery_orchestration_attempt_receipt() from public,anon,authenticated,service_role;

alter table public.discovery_orchestration_failure_policies enable row level security;
alter table public.discovery_orchestration_execution_attempts enable row level security;
drop policy if exists discovery_orchestration_failure_policies_read
  on public.discovery_orchestration_failure_policies;
create policy discovery_orchestration_failure_policies_read
  on public.discovery_orchestration_failure_policies for select to authenticated using(true);
drop policy if exists discovery_orchestration_execution_attempts_company_read
  on public.discovery_orchestration_execution_attempts;
create policy discovery_orchestration_execution_attempts_company_read
  on public.discovery_orchestration_execution_attempts for select to authenticated
  using(public.is_company_member(company_id));
revoke all on public.discovery_orchestration_failure_policies,
  public.discovery_orchestration_execution_attempts
  from public,anon,authenticated,service_role;
grant select on public.discovery_orchestration_failure_policies to authenticated,service_role;
grant select on public.discovery_orchestration_execution_attempts to service_role;

create or replace function public.begin_discovery_orchestration_attempt()
returns trigger language plpgsql security definer
set search_path=public,pg_temp
as $begin_attempt$
declare
  v_execution public.discovery_orchestration_executions%rowtype;
  v_now timestamptz:=clock_timestamp();
begin
  select e.* into v_execution
    from public.discovery_orchestration_executions e
    where e.company_id=new.company_id and e.id=new.execution_id
    for update;
  if not found then
    raise exception 'The orchestration execution does not exist in this company.' using errcode='P0002';
  end if;
  if v_execution.state not in ('ready','retry_wait')
    or v_execution.available_at>v_now
    or v_execution.attempt_count>=v_execution.max_attempts then
    raise exception 'The execution is not eligible for another bounded attempt.' using errcode='55000';
  end if;
  if not exists(
    select 1
    from public.discovery_orchestration_steps s
    join public.discovery_orchestration_runs r
      on r.company_id=s.company_id and r.id=s.run_id
    where s.company_id=new.company_id and s.id=v_execution.step_id
      and s.run_id=v_execution.run_id and s.status in ('planned','ready')
      and r.status='approved_not_dispatched'
  ) then
    raise exception 'The orchestration step or parent run is not eligible for another attempt.' using errcode='55000';
  end if;
  new.attempt_number:=v_execution.attempt_count+1;
  update public.discovery_orchestration_executions
    set attempt_count=new.attempt_number,state='leased',updated_at=v_now
    where company_id=new.company_id and id=new.execution_id;
  return new;
end;
$begin_attempt$;
drop trigger if exists discovery_orchestration_attempt_before_lease
  on public.discovery_orchestration_execution_leases;
create trigger discovery_orchestration_attempt_before_lease
  before insert on public.discovery_orchestration_execution_leases
  for each row execute function public.begin_discovery_orchestration_attempt();

create or replace function public.record_discovery_orchestration_attempt_start()
returns trigger language plpgsql security definer
set search_path=public,pg_temp
as $attempt_start$
begin
  insert into public.discovery_orchestration_execution_attempts(
    company_id,execution_id,lease_id,attempt_number,idempotency_key
  ) values(
    new.company_id,new.execution_id,new.id,new.attempt_number,'lease:'||new.id::text
  );
  return new;
end;
$attempt_start$;
drop trigger if exists discovery_orchestration_attempt_after_lease
  on public.discovery_orchestration_execution_leases;
create trigger discovery_orchestration_attempt_after_lease
  after insert on public.discovery_orchestration_execution_leases
  for each row execute function public.record_discovery_orchestration_attempt_start();

create or replace function public.finalize_discovery_orchestration_attempt(
  p_company_id uuid,p_lease_id uuid,p_outcome text,p_error_code text default null
) returns jsonb
language plpgsql security definer
set search_path=public,pg_temp
as $finalize_attempt$
declare
  v_lease public.discovery_orchestration_execution_leases%rowtype;
  v_execution public.discovery_orchestration_executions%rowtype;
  v_attempt public.discovery_orchestration_execution_attempts%rowtype;
  v_policy public.discovery_orchestration_failure_policies%rowtype;
  v_run_status text;
  v_now timestamptz:=clock_timestamp();
  v_error_code text;
  v_status text;
  v_next_state text;
  v_retryable boolean:=false;
  v_next_retry_at timestamptz;
  v_delay integer:=0;
  v_event_type text;
  v_reason text;
  v_final_error_code text;
  v_effective_outcome text;
begin
  if p_outcome is null or p_outcome not in ('succeeded','failed','expired','released') then
    raise exception 'The attempt outcome is not supported.' using errcode='22023';
  end if;
  select l.* into v_lease from public.discovery_orchestration_execution_leases l
    where l.company_id=p_company_id and l.id=p_lease_id
    for update;
  if not found then raise exception 'The orchestration lease was not found.' using errcode='P0002'; end if;
  v_effective_outcome:=case when p_outcome='released' and v_lease.expires_at<=v_now then 'expired' else p_outcome end;
  select a.* into v_attempt from public.discovery_orchestration_execution_attempts a
    where a.company_id=p_company_id and a.lease_id=p_lease_id
    for update;
  if not found then raise exception 'The lease has no attempt receipt.' using errcode='P0002'; end if;
  select e.* into v_execution from public.discovery_orchestration_executions e
    where e.company_id=p_company_id and e.id=v_attempt.execution_id
    for update;
  if not found then raise exception 'The execution was not found.' using errcode='P0002'; end if;

  v_error_code:=case v_effective_outcome
    when 'expired' then 'LEASE_EXPIRED'
    when 'released' then 'WORKER_RELEASED'
    else p_error_code
  end;

  if v_attempt.status<>'started' then
    if (p_outcome='succeeded' and v_attempt.status='succeeded' and v_attempt.error_code is null)
      or (p_outcome='failed' and v_attempt.status='failed' and v_attempt.error_code=p_error_code)
      or (p_outcome='expired' and v_attempt.status='expired' and v_attempt.error_code='LEASE_EXPIRED')
      or (p_outcome='released' and v_attempt.status='released' and v_attempt.error_code='WORKER_RELEASED')
      or (p_outcome='released' and v_attempt.status='expired' and v_attempt.error_code='LEASE_EXPIRED') then
      return jsonb_build_object(
        'executionState',v_execution.state,'attemptStatus',v_attempt.status,
        'attemptNumber',v_attempt.attempt_number,'nextRetryAt',v_attempt.next_retry_at,
        'idempotent',true
      );
    end if;
    raise exception 'This lease already has a different final attempt outcome.' using errcode='23505';
  end if;

  if v_effective_outcome in ('succeeded','failed') and (v_lease.released_at is not null or v_lease.expires_at<=v_now) then
    raise exception 'The lease is no longer active; expired or released attempts cannot be completed.' using errcode='55000';
  end if;
  if v_effective_outcome='expired' and v_lease.expires_at>v_now then
    raise exception 'The lease has not expired.' using errcode='55000';
  end if;
  if v_effective_outcome='succeeded' then
    if p_error_code is not null then
      raise exception 'A successful attempt cannot include an error code.' using errcode='22023';
    end if;
    update public.discovery_orchestration_execution_attempts
      set status='succeeded',retryable=false,finished_at=v_now
      where company_id=p_company_id and id=v_attempt.id;
    update public.discovery_orchestration_executions
      set state='succeeded',last_error_code=null,last_error_summary=null,updated_at=v_now
      where company_id=p_company_id and id=v_execution.id;
    update public.discovery_orchestration_steps
      set status='succeeded',updated_at=v_now
      where company_id=p_company_id and id=v_execution.step_id;
    update public.discovery_orchestration_execution_leases
      set released_at=v_now,release_reason='Attempt completed successfully.'
      where company_id=p_company_id and id=p_lease_id;
    insert into public.discovery_orchestration_execution_events(
      company_id,execution_id,event_type,previous_state,new_state,attempt_number,reason,details
    ) values(
      p_company_id,v_execution.id,'attempt_succeeded','leased','succeeded',v_attempt.attempt_number,
      'The governed adapter attempt completed successfully.',
      jsonb_build_object('attemptId',v_attempt.id,'leaseId',p_lease_id)
    );
    return jsonb_build_object(
      'executionState','succeeded','attemptStatus','succeeded',
      'attemptNumber',v_attempt.attempt_number,'nextRetryAt',null,'idempotent',false
    );
  end if;

  select p.* into v_policy from public.discovery_orchestration_failure_policies p
    where p.error_code=v_error_code and p.enabled=true;
  if not found then
    raise exception 'The failure code is not in the approved retry classification catalogue.' using errcode='22023';
  end if;
  select r.status into v_run_status
    from public.discovery_orchestration_runs r
    where r.company_id=p_company_id and r.id=v_execution.run_id;
  v_retryable:=v_policy.retryable and v_attempt.attempt_number<least(v_execution.max_attempts,v_policy.max_attempts);
  if v_run_status in ('cancelled','rejected') then
    v_next_state:='cancelled';
    v_retryable:=false;
  elsif v_retryable then
    v_delay:=least(
      v_policy.max_delay_seconds,
      (v_policy.base_delay_seconds::numeric * power(2::numeric,greatest(0,v_attempt.attempt_number-1)))::integer
    );
    v_next_retry_at:=v_now+make_interval(secs=>v_delay);
    v_next_state:='retry_wait';
  else
    v_next_state:='failed';
  end if;
  v_status:=case v_effective_outcome when 'expired' then 'expired' when 'released' then 'released' else 'failed' end;
  v_event_type:=case v_effective_outcome when 'expired' then 'lease_expired' when 'released' then 'lease_released' else 'attempt_failed' end;
  v_reason:=case v_effective_outcome
    when 'expired' then 'The worker lease expired; the attempt was classified by the bounded retry policy.'
    when 'released' then 'The worker released its attempt; the bounded retry policy determined the next state.'
    else 'The worker reported a failure using an approved error code; the bounded retry policy determined the next state.'
  end;

  update public.discovery_orchestration_execution_attempts
    set status=v_status,error_code=v_policy.error_code,failure_class=v_policy.failure_class,
        retryable=v_retryable,finished_at=v_now,next_retry_at=v_next_retry_at
    where company_id=p_company_id and id=v_attempt.id;
  update public.discovery_orchestration_executions
    set state=v_next_state,available_at=coalesce(v_next_retry_at,v_now),
        last_error_code=v_policy.error_code,last_error_summary=v_policy.safe_summary,updated_at=v_now
    where company_id=p_company_id and id=v_execution.id;
  update public.discovery_orchestration_steps
    set status=case when v_next_state='retry_wait' then 'ready' when v_next_state='cancelled' then 'cancelled' else 'failed' end,
        updated_at=v_now
    where company_id=p_company_id and id=v_execution.step_id;
  update public.discovery_orchestration_execution_leases
    set released_at=v_now,release_reason=left(v_reason,500)
    where company_id=p_company_id and id=p_lease_id;
  insert into public.discovery_orchestration_execution_events(
    company_id,execution_id,event_type,previous_state,new_state,attempt_number,reason,details
  ) values(
    p_company_id,v_execution.id,v_event_type,'leased',v_next_state,v_attempt.attempt_number,v_reason,
    jsonb_build_object('attemptId',v_attempt.id,'leaseId',p_lease_id,'errorCode',v_policy.error_code,
      'failureClass',v_policy.failure_class,'retryable',v_retryable,'nextRetryAt',v_next_retry_at)
  );
  if v_next_state='retry_wait' then
    insert into public.discovery_orchestration_execution_events(
      company_id,execution_id,event_type,previous_state,new_state,attempt_number,reason,details
    ) values(
      p_company_id,v_execution.id,'retry_scheduled','leased','retry_wait',v_attempt.attempt_number,
      'The approved retry policy scheduled a bounded retry with exponential backoff.',
      jsonb_build_object('errorCode',v_policy.error_code,'delaySeconds',v_delay,'nextRetryAt',v_next_retry_at)
    );
  end if;
  return jsonb_build_object(
    'executionState',v_next_state,'attemptStatus',v_status,
    'attemptNumber',v_attempt.attempt_number,'nextRetryAt',v_next_retry_at,'idempotent',false,
    'errorCode',v_policy.error_code,'failureClass',v_policy.failure_class,'retryable',v_retryable
  );
end;
$finalize_attempt$;

create or replace function public.record_discovery_orchestration_attempt_outcome(
  p_company_id uuid,p_worker_identity_id uuid,p_worker_credential_hash text,
  p_lease_id uuid,p_lease_token_hash text,p_outcome text,p_error_code text default null
) returns jsonb
language plpgsql security definer
set search_path=public,pg_temp
as $record_outcome$
declare
  v_worker public.discovery_orchestration_worker_identities%rowtype;
  v_lease public.discovery_orchestration_execution_leases%rowtype;
  v_attempt public.discovery_orchestration_execution_attempts%rowtype;
  v_control public.discovery_company_worker_controls%rowtype;
begin
  if p_worker_credential_hash is null or p_worker_credential_hash !~ '^[a-f0-9]{64}$'
    or p_lease_token_hash is null or p_lease_token_hash !~ '^[a-f0-9]{64}$'
    or p_outcome is null or p_outcome not in ('succeeded','failed','released') then
    raise exception 'Worker credential, lease token or outcome is invalid.' using errcode='22023';
  end if;
  select wi.* into v_worker from public.discovery_orchestration_worker_identities wi
    where wi.company_id=p_company_id and wi.id=p_worker_identity_id
      and wi.credential_hash=p_worker_credential_hash;
  if not found then raise exception 'The scoped worker credential is no longer valid.' using errcode='42501'; end if;
  select l.* into v_lease from public.discovery_orchestration_execution_leases l
    where l.company_id=p_company_id and l.id=p_lease_id
      and l.worker_identity_id=v_worker.id and l.lease_token_hash=p_lease_token_hash;
  if not found then raise exception 'The lease token does not match this worker identity.' using errcode='42501'; end if;
  select a.* into v_attempt from public.discovery_orchestration_execution_attempts a
    where a.company_id=p_company_id and a.lease_id=p_lease_id;
  if not found then raise exception 'The lease has no attempt receipt.' using errcode='P0002'; end if;
  if v_attempt.status='started' then
    if v_worker.status<>'active' or v_worker.expires_at<=clock_timestamp() then
      raise exception 'The worker identity is paused, revoked or expired.' using errcode='42501';
    end if;
    select c.* into v_control from public.discovery_company_worker_controls c
      where c.company_id=p_company_id and c.enabled=true and c.expires_at>clock_timestamp()
      for share;
    if not found then raise exception 'The company worker grant is inactive or expired.' using errcode='42501'; end if;
    if p_outcome='failed' and (p_error_code is null or not exists(
      select 1 from public.discovery_orchestration_failure_policies p
      where p.error_code=p_error_code and p.enabled=true
    )) then
      raise exception 'Choose an enabled error code from the approved failure classification catalogue.' using errcode='22023';
    end if;
    if p_outcome='succeeded' and not exists(
      select 1 from public.discovery_orchestration_executions e
      join public.discovery_orchestration_step_preflight pf
        on pf.company_id=e.company_id and pf.run_id=e.run_id and pf.step_id=e.step_id
      where e.company_id=p_company_id and e.id=v_attempt.execution_id
        and pf.dispatch_permitted=true and cardinality(pf.blocker_codes)=0
    ) then
      raise exception 'A successful outcome requires every live dispatch and policy gate to remain clear.' using errcode='42501';
    end if;
    if p_outcome='released' then
      raise exception 'Use the lease release operation to release an unfinished attempt.' using errcode='22023';
    end if;
  end if;
  return public.finalize_discovery_orchestration_attempt(p_company_id,p_lease_id,p_outcome,p_error_code);
end;
$record_outcome$;

create or replace function public.release_discovery_orchestration_worker_leases(
  p_company_id uuid,p_worker_identity_id uuid,p_reason text,p_actor_user_id uuid
) returns integer
language plpgsql security definer
set search_path=public,pg_temp
as $release_worker_leases$
declare
  v_lease record;
  v_count integer:=0;
begin
  for v_lease in
    select l.id,l.execution_id,l.worker_identity_id,l.worker_identity,w.worker_key,w.stage_keys
    from public.discovery_orchestration_execution_leases l
    join public.discovery_orchestration_worker_identities w
      on w.company_id=l.company_id and w.id=l.worker_identity_id
    where l.company_id=p_company_id and l.released_at is null
      and (p_worker_identity_id is null or l.worker_identity_id=p_worker_identity_id)
    for update of l skip locked
  loop
    perform public.finalize_discovery_orchestration_attempt(p_company_id,v_lease.id,'released',null);
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
$release_worker_leases$;

create or replace function public.expire_discovery_orchestration_leases(
  p_company_id uuid,p_limit integer default 100
) returns integer
language plpgsql security definer
set search_path=public,pg_temp
as $expire$
declare
  v_lease record;
  v_count integer:=0;
begin
  if p_limit<1 or p_limit>500 then
    raise exception 'Lease expiry batch must be between 1 and 500.' using errcode='22023';
  end if;
  for v_lease in
    select l.id,l.execution_id,l.worker_identity_id,l.worker_identity,w.worker_key,w.stage_keys
    from public.discovery_orchestration_execution_leases l
    join public.discovery_orchestration_worker_identities w
      on w.company_id=l.company_id and w.id=l.worker_identity_id
    where l.company_id=p_company_id and l.released_at is null and l.expires_at<=clock_timestamp()
    order by l.expires_at for update of l skip locked limit p_limit
  loop
    perform public.finalize_discovery_orchestration_attempt(p_company_id,v_lease.id,'expired','LEASE_EXPIRED');
    insert into public.discovery_orchestration_worker_events(
      company_id,worker_identity_id,event_type,worker_key_snapshot,stage_keys_snapshot,reason,details
    ) values(
      p_company_id,v_lease.worker_identity_id,'lease_expired',v_lease.worker_key,v_lease.stage_keys,
      'Lease expired and was classified by the bounded retry policy.',
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
  select c.* into v_company_worker_control
    from public.discovery_company_worker_controls as c
    where c.company_id=p_company_id and c.enabled=true and c.expires_at>v_now
    for share;
  if not found then return; end if;

  -- Lock the scoped worker before lease rows. Pause/revoke uses the same worker→lease order.
  select wi.* into v_worker from public.discovery_orchestration_worker_identities as wi
    where wi.company_id=p_company_id and wi.id=p_worker_identity_id
      and wi.status='active' and wi.expires_at>v_now and wi.credential_hash=p_worker_credential_hash
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
    where e.company_id=p_company_id and e.state in ('ready','retry_wait') and e.available_at<=v_now
      and e.attempt_count<e.max_attempts and r.status='approved_not_dispatched'
      and s.status in ('planned','ready') and s.stage_key=any(v_worker.stage_keys)
      and s.permission_class=a.required_permission_class
    order by e.available_at,e.created_at
    for update of e skip locked limit 1;
  if not found then return; end if;

  select ac.* into v_adapter from public.discovery_orchestration_adapter_contracts as ac
    where ac.adapter_key=v_execution.adapter_key;
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
    p_company_id,v_execution.id,'lease_granted',v_execution.state,'leased',v_execution.attempt_count+1,
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
    (select s.stage_key from public.discovery_orchestration_steps as s where s.company_id=p_company_id and s.id=v_execution.step_id),
    v_execution.adapter_key,v_worker.worker_key,v_now,v_now+make_interval(secs=>v_seconds);
end;
$claim$;

create or replace function public.release_discovery_orchestration_lease(
  p_company_id uuid,p_lease_id uuid,p_worker_identity_id uuid,
  p_worker_credential_hash text,p_lease_token_hash text,p_reason text
) returns boolean
language plpgsql security definer
set search_path=public,pg_temp
as $release_lease$
declare
  v_worker public.discovery_orchestration_worker_identities%rowtype;
  v_lease public.discovery_orchestration_execution_leases%rowtype;
begin
  if p_worker_credential_hash is null or p_worker_credential_hash !~ '^[a-f0-9]{64}$'
    or p_lease_token_hash is null or p_lease_token_hash !~ '^[a-f0-9]{64}$'
    or p_reason is null or length(trim(p_reason))<10 or length(p_reason)>1000 then return false; end if;
  select w.* into v_worker from public.discovery_orchestration_worker_identities w
    where w.company_id=p_company_id and w.id=p_worker_identity_id;
  if not found or v_worker.credential_hash<>p_worker_credential_hash then return false; end if;
  select l.* into v_lease from public.discovery_orchestration_execution_leases l
    where l.company_id=p_company_id and l.id=p_lease_id and l.worker_identity_id=v_worker.id
      and l.lease_token_hash=p_lease_token_hash and l.released_at is null
    for update;
  if not found then return false; end if;
  perform public.finalize_discovery_orchestration_attempt(p_company_id,p_lease_id,'released',null);
  insert into public.discovery_orchestration_worker_events(
    company_id,worker_identity_id,event_type,worker_key_snapshot,stage_keys_snapshot,reason,details
  ) values(
    p_company_id,v_worker.id,'lease_released',v_worker.worker_key,v_worker.stage_keys,
    trim(p_reason),jsonb_build_object('leaseId',p_lease_id,'executionId',v_lease.execution_id)
  );
  return true;
end;
$release_lease$;

-- Company-safe read models never expose worker credentials, lease-token hashes or caller input.
create or replace view public.discovery_orchestration_execution_inbox as
select e.company_id,e.id as execution_id,e.run_id,e.step_id,s.stage_key,e.adapter_key,
  e.state,e.attempt_count,e.max_attempts,e.available_at,e.last_error_code,e.last_error_summary,e.updated_at
from public.discovery_orchestration_executions e
join public.discovery_orchestration_steps s
  on s.company_id=e.company_id and s.id=e.step_id and s.run_id=e.run_id
where public.is_company_member(e.company_id);

create or replace view public.discovery_orchestration_attempt_inbox as
select a.company_id,a.id as attempt_id,a.execution_id,a.attempt_number,a.status,
  a.error_code,a.failure_class,a.retryable,a.started_at,a.finished_at,a.next_retry_at,
  e.run_id,e.step_id,s.stage_key,e.adapter_key
from public.discovery_orchestration_execution_attempts a
join public.discovery_orchestration_executions e
  on e.company_id=a.company_id and e.id=a.execution_id
join public.discovery_orchestration_steps s
  on s.company_id=e.company_id and s.id=e.step_id and s.run_id=e.run_id
where public.is_company_member(a.company_id);

grant select on public.discovery_orchestration_execution_inbox,
  public.discovery_orchestration_attempt_inbox to authenticated,service_role;

revoke all on function public.begin_discovery_orchestration_attempt() from public,anon,authenticated,service_role;
revoke all on function public.record_discovery_orchestration_attempt_start() from public,anon,authenticated,service_role;
revoke all on function public.finalize_discovery_orchestration_attempt(uuid,uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.record_discovery_orchestration_attempt_outcome(uuid,uuid,text,uuid,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.release_discovery_orchestration_worker_leases(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.expire_discovery_orchestration_leases(uuid,integer) from public,anon,authenticated,service_role;
revoke all on function public.claim_discovery_orchestration_lease(uuid,uuid,text,text,integer) from public,anon,authenticated,service_role;
revoke all on function public.release_discovery_orchestration_lease(uuid,uuid,uuid,text,text,text) from public,anon,authenticated,service_role;

grant execute on function public.record_discovery_orchestration_attempt_outcome(uuid,uuid,text,uuid,text,text,text) to service_role;
grant execute on function public.expire_discovery_orchestration_leases(uuid,integer) to service_role;
grant execute on function public.claim_discovery_orchestration_lease(uuid,uuid,text,text,integer) to service_role;
grant execute on function public.release_discovery_orchestration_lease(uuid,uuid,uuid,text,text,text) to service_role;

comment on function public.guard_discovery_orchestration_attempt_receipt() is
  'Allows only the one-way started-to-final transition; finalized attempt receipts and their identity are immutable.';
comment on table public.discovery_orchestration_execution_attempts is
  'E20.6 immutable-per-lease attempt receipts. One lease consumes one bounded attempt; outcomes are idempotent and audit-preserving.';
comment on table public.discovery_orchestration_failure_policies is
  'E20.6 fixed, platform-controlled failure taxonomy. Unknown error strings are never retried.';
comment on view public.discovery_orchestration_attempt_inbox is
  'E20.6 company-scoped attempt history; exposes safe error classifications only, not tokens or raw worker input.';
comment on function public.record_discovery_orchestration_attempt_outcome(uuid,uuid,text,uuid,text,text,text) is
  'E20.6 scoped worker outcome API. Success requires all live gates to be clear; failures use only the approved error-code taxonomy.';

commit;
