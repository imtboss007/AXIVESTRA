-- AXIVESTRA E04.2: durable discovery queue and atomic source request quotas.
-- Schema/functions only. No worker is deployed and no source is contacted.
begin;

create table if not exists public.discovery_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null,
  source_id uuid not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'queued'
    check (status in ('queued','running','succeeded','failed','cancelled')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  idempotency_key text not null check (length(trim(idempotency_key)) between 8 and 160),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 5),
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  last_error_code text,
  last_error_message text check (last_error_message is null or length(last_error_message) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, idempotency_key),
  foreign key (company_id, profile_id)
    references public.discovery_profiles(company_id, id) on delete cascade,
  foreign key (company_id, source_id)
    references public.discovery_source_registry(company_id, id) on delete restrict
);

create index if not exists discovery_jobs_claim_idx
  on public.discovery_jobs(status, available_at, created_at)
  where status in ('queued','running');

create index if not exists discovery_jobs_company_history_idx
  on public.discovery_jobs(company_id, created_at desc);

create table if not exists public.discovery_source_quota_windows (
  source_id uuid primary key references public.discovery_source_registry(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  requests_used integer not null default 0 check (requests_used >= 0),
  updated_at timestamptz not null default now()
);

alter table public.discovery_jobs enable row level security;
alter table public.discovery_source_quota_windows enable row level security;
revoke all on public.discovery_jobs from anon, authenticated;
revoke all on public.discovery_source_quota_windows from anon, authenticated;

-- One outbound request must obtain a reservation immediately before it is sent.
-- A single row lock serializes reservations for a source across all workers.
create or replace function public.reserve_discovery_source_request(
  p_company_id uuid,
  p_source_id uuid,
  p_job_id uuid,
  p_worker_id text
) returns table (allowed boolean, remaining integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source public.discovery_source_registry%rowtype;
  v_job public.discovery_jobs%rowtype;
  v_quota public.discovery_source_quota_windows%rowtype;
  v_now timestamptz := clock_timestamp();
  v_limit integer;
  v_elapsed numeric;
begin
  if p_worker_id is null or length(trim(p_worker_id)) < 8 or length(p_worker_id) > 160 then
    raise exception 'Invalid discovery worker identity' using errcode = '22023';
  end if;

  select * into v_source
    from public.discovery_source_registry
    where id = p_source_id and company_id = p_company_id and status = 'approved'
    for share;
  if not found then
    raise exception 'Discovery source is not approved for this company' using errcode = '42501';
  end if;

  select * into v_job
    from public.discovery_jobs
    where id = p_job_id and company_id = p_company_id
      and source_id = p_source_id and status = 'running'
      and lease_owner = p_worker_id and lease_expires_at > v_now
    for share;
  if not found then
    raise exception 'Discovery job lease is not held by this worker' using errcode = '42501';
  end if;

  insert into public.discovery_source_quota_windows(source_id, window_started_at, requests_used, updated_at)
    values (p_source_id, v_now, 0, v_now)
    on conflict (source_id) do nothing;

  select * into v_quota from public.discovery_source_quota_windows
    where source_id = p_source_id for update;

  v_limit := v_source.rate_limit_per_minute;
  v_elapsed := extract(epoch from (v_now - v_quota.window_started_at));

  if v_elapsed >= 60 then
    update public.discovery_source_quota_windows
      set window_started_at = v_now, requests_used = 1, updated_at = v_now
      where source_id = p_source_id;
    return query select true, greatest(v_limit - 1, 0), 0;
    return;
  end if;

  if v_quota.requests_used >= v_limit then
    return query select false, 0, greatest(1, ceil(60 - v_elapsed)::integer);
    return;
  end if;

  update public.discovery_source_quota_windows
    set requests_used = requests_used + 1, updated_at = v_now
    where source_id = p_source_id;

  return query select true, greatest(v_limit - v_quota.requests_used - 1, 0), 0;
end;
$$;

-- Claim one eligible job. SKIP LOCKED prevents two workers from claiming the
-- same queued row. Expired leases are re-queued or failed after max attempts.
create or replace function public.claim_discovery_job(
  p_worker_id text,
  p_lease_seconds integer default 90
) returns setof public.discovery_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.discovery_jobs%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_worker_id is null or length(trim(p_worker_id)) < 8 or length(p_worker_id) > 160 then
    raise exception 'Invalid discovery worker identity' using errcode = '22023';
  end if;
  if p_lease_seconds < 15 or p_lease_seconds > 300 then
    raise exception 'Lease duration must be between 15 and 300 seconds' using errcode = '22023';
  end if;

  update public.discovery_jobs
    set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
        lease_owner = null, lease_expires_at = null, heartbeat_at = null,
        finished_at = case when attempts >= max_attempts then v_now else null end,
        available_at = case when attempts >= max_attempts then available_at
          else v_now + make_interval(secs => least(30 * greatest(attempts, 1), 300)) end,
        last_error_code = coalesce(last_error_code, 'WORKER_LEASE_EXPIRED'),
        last_error_message = coalesce(last_error_message, 'Previous worker lease expired before completion.'),
        updated_at = v_now
    where status = 'running' and lease_expires_at <= v_now;

  select j.* into v_job
    from public.discovery_jobs j
    join public.discovery_profiles p
      on p.company_id = j.company_id and p.id = j.profile_id and p.enabled = true
    join public.discovery_source_registry s
      on s.company_id = j.company_id and s.id = j.source_id and s.status = 'approved'
    join public.discovery_profile_sources ps
      on ps.company_id = j.company_id and ps.profile_id = j.profile_id and ps.source_id = j.source_id
    where j.status = 'queued' and j.available_at <= v_now and j.attempts < j.max_attempts
    order by j.available_at, j.created_at
    for update of j skip locked
    limit 1;

  if not found then return; end if;

  update public.discovery_jobs
    set status = 'running', attempts = attempts + 1,
        lease_owner = p_worker_id,
        lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
        heartbeat_at = v_now,
        started_at = coalesce(started_at, v_now),
        updated_at = v_now
    where id = v_job.id
    returning * into v_job;

  return next v_job;
end;
$$;

create or replace function public.heartbeat_discovery_job(
  p_job_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 90
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_updated integer;
begin
  if p_lease_seconds < 15 or p_lease_seconds > 300 then
    raise exception 'Lease duration must be between 15 and 300 seconds' using errcode = '22023';
  end if;
  update public.discovery_jobs
    set heartbeat_at = clock_timestamp(),
        lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
        updated_at = clock_timestamp()
    where id = p_job_id and status = 'running'
      and lease_owner = p_worker_id and lease_expires_at > clock_timestamp();
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.finish_discovery_job(
  p_job_id uuid,
  p_worker_id text,
  p_succeeded boolean,
  p_error_code text default null,
  p_error_message text default null
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_updated integer;
begin
  update public.discovery_jobs
    set status = case when p_succeeded then 'succeeded'
      when attempts >= max_attempts then 'failed' else 'queued' end,
        available_at = case when p_succeeded or attempts >= max_attempts
          then available_at else clock_timestamp() + make_interval(secs => least(30 * attempts, 300)) end,
        lease_owner = null, lease_expires_at = null, heartbeat_at = null,
        finished_at = case when p_succeeded or attempts >= max_attempts then clock_timestamp() else null end,
        last_error_code = case when p_succeeded then null else left(coalesce(p_error_code, 'DISCOVERY_JOB_FAILED'), 100) end,
        last_error_message = case when p_succeeded then null else left(coalesce(p_error_message, 'Discovery job failed.'), 1000) end,
        updated_at = clock_timestamp()
    where id = p_job_id and status = 'running'
      and lease_owner = p_worker_id and lease_expires_at > clock_timestamp();
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.reserve_discovery_source_request(uuid,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.claim_discovery_job(text,integer) from public, anon, authenticated;
revoke all on function public.heartbeat_discovery_job(uuid,text,integer) from public, anon, authenticated;
revoke all on function public.finish_discovery_job(uuid,text,boolean,text,text) from public, anon, authenticated;
grant execute on function public.reserve_discovery_source_request(uuid,uuid,uuid,text) to service_role;
grant execute on function public.claim_discovery_job(text,integer) to service_role;
grant execute on function public.heartbeat_discovery_job(uuid,text,integer) to service_role;
grant execute on function public.finish_discovery_job(uuid,text,boolean,text,text) to service_role;

comment on table public.discovery_jobs is
  'Durable company-scoped discovery work queue. Workers claim jobs using leased SKIP LOCKED RPC; no client writes.';
comment on table public.discovery_source_quota_windows is
  'Atomic rolling 60-second per-source request budget shared by all workers.';
comment on function public.reserve_discovery_source_request(uuid,uuid,uuid,text) is
  'Must be called immediately before every external source request; atomically enforces source-wide quota.';
comment on function public.claim_discovery_job(text,integer) is
  'Claims one eligible discovery job with a bounded lease; expired leases are recovered with capped attempts.';

commit;
