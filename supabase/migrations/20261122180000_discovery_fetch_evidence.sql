-- AXIVESTRA E04: governed crawler/fetch worker evidence, cache and emergency control.
-- Private storage only. No source is activated and no worker is deployed by this migration.
begin;

create table if not exists public.discovery_company_worker_controls (
  company_id uuid primary key references public.companies(id) on delete cascade,
  enabled boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  reason text check (reason is null or length(reason) <= 500),
  updated_at timestamptz not null default now()
);

create table if not exists public.discovery_evidence_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid not null references public.discovery_jobs(id) on delete cascade,
  source_id uuid not null references public.discovery_source_registry(id) on delete restrict,
  canonical_url text not null,
  captured_at timestamptz not null default now(),
  source_published_at timestamptz,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  raw_blob_ref text not null,
  content_type text not null,
  byte_length bigint not null check (byte_length between 0 and 5000000),
  attribution text not null default '',
  jurisdiction text not null,
  licence_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(licence_snapshot) = 'object'),
  response_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(response_metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists discovery_evidence_job_idx
  on public.discovery_evidence_items(company_id, job_id, captured_at desc);
create index if not exists discovery_evidence_source_url_idx
  on public.discovery_evidence_items(source_id, canonical_url, captured_at desc);

create table if not exists public.discovery_fetch_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid not null references public.discovery_jobs(id) on delete cascade,
  source_id uuid not null references public.discovery_source_registry(id) on delete restrict,
  evidence_id uuid references public.discovery_evidence_items(id) on delete set null,
  event_type text not null check (event_type in (
    'request_started','response_received','request_failed','quota_denied',
    'robots_blocked','cache_hit','policy_rejected','worker_paused'
  )),
  url text not null,
  occurred_at timestamptz not null default now(),
  http_status integer check (http_status is null or http_status between 100 and 599),
  cache_key text,
  response_bytes bigint check (response_bytes is null or response_bytes >= 0),
  outcome text not null,
  error_code text,
  error_message text check (error_message is null or length(error_message) <= 1000),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object')
);

create index if not exists discovery_fetch_events_job_idx
  on public.discovery_fetch_events(company_id, job_id, occurred_at desc);
create index if not exists discovery_fetch_events_source_idx
  on public.discovery_fetch_events(source_id, occurred_at desc);

create table if not exists public.discovery_fetch_cache (
  source_id uuid not null references public.discovery_source_registry(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  cache_key text not null check (cache_key ~ '^[a-f0-9]{64}$'),
  canonical_url text not null,
  evidence_id uuid not null references public.discovery_evidence_items(id) on delete cascade,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  fetched_at timestamptz not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (source_id, cache_key)
);

create index if not exists discovery_fetch_cache_expiry_idx
  on public.discovery_fetch_cache(expires_at);

alter table public.discovery_company_worker_controls enable row level security;
alter table public.discovery_evidence_items enable row level security;
alter table public.discovery_fetch_events enable row level security;
alter table public.discovery_fetch_cache enable row level security;

revoke all on public.discovery_company_worker_controls from anon, authenticated;
revoke all on public.discovery_evidence_items from anon, authenticated;
revoke all on public.discovery_fetch_events from anon, authenticated;
revoke all on public.discovery_fetch_cache from anon, authenticated;

grant all on public.discovery_company_worker_controls to service_role;
grant all on public.discovery_evidence_items to service_role;
grant all on public.discovery_fetch_events to service_role;
grant all on public.discovery_fetch_cache to service_role;

-- A private, bounded object store for immutable raw response snapshots.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'discovery-evidence',
  'discovery-evidence',
  false,
  5000000,
  array['text/html','text/plain','application/json','application/ld+json','application/xml','text/xml','application/pdf','application/octet-stream']
)
on conflict (id) do update
  set public = false,
      file_size_limit = 5000000,
      allowed_mime_types = excluded.allowed_mime_types;

-- A company-level kill switch gates both queue claims and every outbound request.
create or replace function public.claim_enabled_discovery_job(
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
    join public.discovery_company_worker_controls wc
      on wc.company_id = j.company_id and wc.enabled = true
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

-- The quota reservation re-checks live source/profile/attachment/control state.
-- Workers MUST reserve immediately before each outbound request, including robots.txt and redirects.
create or replace function public.reserve_discovery_fetch_request(
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

  select j.* into v_job
    from public.discovery_jobs j
    join public.discovery_profiles p
      on p.company_id = j.company_id and p.id = j.profile_id and p.enabled = true
    join public.discovery_profile_sources ps
      on ps.company_id = j.company_id and ps.profile_id = j.profile_id and ps.source_id = j.source_id
    join public.discovery_company_worker_controls wc
      on wc.company_id = j.company_id and wc.enabled = true
    where j.id = p_job_id and j.company_id = p_company_id
      and j.source_id = p_source_id and j.status = 'running'
      and j.lease_owner = p_worker_id and j.lease_expires_at > v_now
    for share of j, p, ps, wc;
  if not found then
    raise exception 'Discovery job lease, profile, source link or worker enablement is no longer valid' using errcode = '42501';
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

revoke all on function public.claim_enabled_discovery_job(text,integer) from public, anon, authenticated;
revoke all on function public.reserve_discovery_fetch_request(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.claim_enabled_discovery_job(text,integer) to service_role;
grant execute on function public.reserve_discovery_fetch_request(uuid,uuid,uuid,text) to service_role;

comment on table public.discovery_company_worker_controls is
  'Company-scoped emergency kill switch. Missing rows mean disabled; only owner/admin actions may enable.';
comment on table public.discovery_evidence_items is
  'Metadata for private, content-addressed raw response snapshots; facts extracted later must reference these rows.';
comment on table public.discovery_fetch_events is
  'Append-only operational fetch event ledger: request, response, policy, quota, cache and failure outcomes.';
comment on table public.discovery_fetch_cache is
  'Persistent source-scoped response cache; cache hits still produce fetch events but make no outbound request.';

commit;
