-- AXIVESTRA E04: governed crawler/fetch worker evidence, cache and emergency control.
-- Private storage only. No source is activated and no worker is deployed by this migration.
begin;

-- Optional Playwright rendering is source-specific and defaults to static HTTP.
alter table public.discovery_source_registry
  add column if not exists render_mode text not null default 'http'
  check (render_mode in ('http','browser'));
alter table public.discovery_evidence_items
  add column if not exists evidence_kind text not null default 'raw_response'
  check (evidence_kind in ('raw_response','rendered_dom'));
alter table public.discovery_evidence_items
  add column if not exists parent_evidence_id uuid references public.discovery_evidence_items(id) on delete set null;



-- E04 extends the original governance audit vocabulary for job queue and
-- temporary worker authority receipts. Preserve the same company-scoped ledger.
alter table public.discovery_audit_events
  drop constraint if exists discovery_audit_events_action_check;
alter table public.discovery_audit_events
  add constraint discovery_audit_events_action_check check (action in (
    'source_registered','source_approved','source_paused','source_rejected',
    'profile_created','profile_updated','profile_enabled','profile_disabled',
    'profile_source_attached','profile_source_detached',
    'discovery_job_queued','discovery_worker_grant_enabled','discovery_worker_grant_disabled'
  ));
alter table public.discovery_audit_events
  drop constraint if exists discovery_audit_events_entity_type_check;
alter table public.discovery_audit_events
  add constraint discovery_audit_events_entity_type_check check (entity_type in (
    'source','profile','profile_source','discovery_job','discovery_worker_control'
  ));

create table if not exists public.discovery_company_worker_controls (
  company_id uuid primary key references public.companies(id) on delete cascade,
  enabled boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  reason text check (reason is null or length(reason) <= 500),
  expires_at timestamptz not null default (now() + interval '1 hour'),
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
  evidence_id uuid, -- retained as a historical identifier even after evidence retention purge
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


-- Evidence snapshots and fetch events are insert-only; retention may delete them,
-- but the recorded evidence/event content cannot be rewritten in place.
create or replace function public.prevent_discovery_evidence_update()
returns trigger
language plpgsql
as $guard$
begin
  raise exception 'Discovery evidence and fetch events are immutable; append a new record instead.';
end;
$guard$;

drop trigger if exists discovery_evidence_no_update on public.discovery_evidence_items;
create trigger discovery_evidence_no_update
  before update on public.discovery_evidence_items
  for each row execute function public.prevent_discovery_evidence_update();

drop trigger if exists discovery_fetch_events_no_update on public.discovery_fetch_events;
create trigger discovery_fetch_events_no_update
  before update on public.discovery_fetch_events
  for each row execute function public.prevent_discovery_evidence_update();

alter table public.discovery_company_worker_controls enable row level security;
alter table public.discovery_evidence_items enable row level security;
alter table public.discovery_fetch_events enable row level security;
alter table public.discovery_fetch_cache enable row level security;

revoke all on public.discovery_company_worker_controls from public, anon, authenticated;
revoke all on public.discovery_evidence_items from public, anon, authenticated;
revoke all on public.discovery_fetch_events from public, anon, authenticated;
revoke all on public.discovery_fetch_cache from public, anon, authenticated;

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


-- Enqueue and audit are one database transaction. Edge code validates candidate
-- URL paths; this RPC rechecks the mutable company/profile/source relationship
-- and performs full-payload idempotency under the database uniqueness lock.
create or replace function public.enqueue_discovery_job(
  p_company_id uuid,
  p_profile_id uuid,
  p_source_id uuid,
  p_requested_by uuid,
  p_payload jsonb,
  p_idempotency_key text,
  p_profile_updated_at timestamptz,
  p_source_updated_at timestamptz
) returns table (job public.discovery_jobs, duplicate boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $enqueue$
declare
  v_profile public.discovery_profiles%rowtype;
  v_source public.discovery_source_registry%rowtype;
  v_link public.discovery_profile_sources%rowtype;
  v_job public.discovery_jobs%rowtype;
  v_existing public.discovery_jobs%rowtype;
  v_purpose text;
  v_member_role text;
  v_candidate_count integer;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or octet_length(p_payload::text) > 48000 then
    raise exception 'Discovery payload must be an object no larger than 48 KB' using errcode = '22023';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8
    or length(p_idempotency_key) > 160 then
    raise exception 'Discovery idempotency key must be 8 to 160 characters' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload->'criteria') <> 'object'
    or octet_length((p_payload->'criteria')::text) > 8192 then
    raise exception 'Discovery criteria must be an object no larger than 8 KB' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload->'candidateUrls') <> 'array' then
    raise exception 'Discovery candidate URL list is required' using errcode = '22023';
  end if;
  v_candidate_count := jsonb_array_length(p_payload->'candidateUrls');

  select * into v_profile from public.discovery_profiles
    where id = p_profile_id and company_id = p_company_id and enabled = true
    for share;
  if not found then raise exception 'Discovery profile is not enabled for this company' using errcode = '42501'; end if;
  if p_profile_updated_at is null or v_profile.updated_at is distinct from p_profile_updated_at then
    raise exception 'Discovery profile changed during enqueue validation; refresh and retry' using errcode = '40001';
  end if;

  select * into v_source from public.discovery_source_registry
    where id = p_source_id and company_id = p_company_id and status = 'approved'
    for share;
  if not found then raise exception 'Discovery source is not approved for this company' using errcode = '42501'; end if;
  if p_source_updated_at is null or v_source.updated_at is distinct from p_source_updated_at then
    raise exception 'Discovery source policy changed during enqueue validation; refresh and retry' using errcode = '40001';
  end if;

  select * into v_link from public.discovery_profile_sources
    where company_id = p_company_id and profile_id = p_profile_id and source_id = p_source_id
    for share;
  if not found then raise exception 'Discovery source is not attached to the enabled profile' using errcode = '42501'; end if;

  v_purpose := p_payload->>'purpose';
  if v_purpose is null or v_purpose <> v_profile.purpose
    or not (v_purpose = any(v_source.allowed_purposes)) then
    raise exception 'Discovery job purpose is outside the approved profile/source scope' using errcode = '42501';
  end if;
  if v_candidate_count < 1 or v_candidate_count > v_source.max_pages_per_job then
    raise exception 'Discovery candidate count exceeds the approved source page budget' using errcode = '22023';
  end if;
  if p_requested_by is null then
    raise exception 'Discovery requester is required' using errcode = '22023';
  end if;
  select role into v_member_role from public.company_memberships
    where company_id = p_company_id and user_id = p_requested_by
    for share;
  if v_member_role is null then
    raise exception 'Discovery requester is not a member of this company' using errcode = '42501';
  end if;

  select * into v_existing from public.discovery_jobs
    where company_id = p_company_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.profile_id <> p_profile_id or v_existing.source_id <> p_source_id
      or v_existing.payload <> p_payload then
      raise exception 'Idempotency key is already used by a different discovery request' using errcode = '23505';
    end if;
    return query select v_existing, true;
    return;
  end if;

  begin
    insert into public.discovery_jobs(
      company_id, profile_id, source_id, requested_by, status, payload, idempotency_key
    ) values (
      p_company_id, p_profile_id, p_source_id, p_requested_by, 'queued', p_payload, p_idempotency_key
    ) returning * into v_job;
  exception when unique_violation then
    select * into v_existing from public.discovery_jobs
      where company_id = p_company_id and idempotency_key = p_idempotency_key;
    if not found or v_existing.profile_id <> p_profile_id or v_existing.source_id <> p_source_id
      or v_existing.payload <> p_payload then
      raise exception 'Idempotency key is already used by a different discovery request' using errcode = '23505';
    end if;
    return query select v_existing, true;
    return;
  end;

  insert into public.discovery_audit_events(
    company_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    p_company_id, p_requested_by, 'discovery_job_queued', 'discovery_job', v_job.id,
    jsonb_build_object(
      'profileId', p_profile_id,
      'sourceId', p_source_id,
      'purpose', v_purpose,
      'candidateCount', v_candidate_count
    )
  );

  return query select v_job, false;
end;
$enqueue$;

revoke all on function public.enqueue_discovery_job(uuid,uuid,uuid,uuid,jsonb,text,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.enqueue_discovery_job(uuid,uuid,uuid,uuid,jsonb,text,timestamptz,timestamptz) to service_role;


-- Company admins issue a one-hour fetch grant. The grant and its audit receipt
-- are committed atomically; revoked/expired grants stop claims and heartbeats.
create or replace function public.set_discovery_company_worker_grant(
  p_company_id uuid,
  p_actor_user_id uuid,
  p_enabled boolean,
  p_reason text default null
) returns table (enabled boolean, expires_at timestamptz, updated_at timestamptz, reason text)
language plpgsql
security definer
set search_path = public, pg_temp
as $grant$
declare
  v_role text;
  v_row public.discovery_company_worker_controls%rowtype;
begin
  select role into v_role
    from public.company_memberships
    where company_id = p_company_id and user_id = p_actor_user_id
    for share;
  if p_actor_user_id is null or v_role is null or v_role not in ('owner','admin') then
    raise exception 'Only a company owner or admin can change the worker grant' using errcode = '42501';
  end if;

  insert into public.discovery_company_worker_controls(
    company_id, enabled, updated_by, reason, expires_at, updated_at
  ) values (
    p_company_id, coalesce(p_enabled,false), p_actor_user_id,
    left(coalesce(nullif(trim(p_reason),''), case when p_enabled then 'Owner/admin granted a one-hour fetch window.' else 'Paused by company owner/admin.' end), 500),
    case when p_enabled then clock_timestamp() + interval '1 hour' else clock_timestamp() end,
    clock_timestamp()
  )
  on conflict (company_id) do update set
    enabled = excluded.enabled,
    updated_by = excluded.updated_by,
    reason = excluded.reason,
    expires_at = excluded.expires_at,
    updated_at = excluded.updated_at
  returning * into v_row;

  insert into public.discovery_audit_events(
    company_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    p_company_id, p_actor_user_id,
    case when v_row.enabled then 'discovery_worker_grant_enabled' else 'discovery_worker_grant_disabled' end,
    'discovery_worker_control', p_company_id,
    jsonb_build_object('enabled',v_row.enabled,'expiresAt',v_row.expires_at,'reason',v_row.reason)
  );

  return query select v_row.enabled, v_row.expires_at, v_row.updated_at, v_row.reason;
end;
$grant$;

create or replace function public.list_expired_discovery_evidence(p_limit integer default 100)
returns table (id uuid, raw_blob_ref text, captured_at timestamptz, retention_days integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $retention$
begin
  if p_limit < 1 or p_limit > 500 then
    raise exception 'Retention sweep limit must be between 1 and 500' using errcode = '22023';
  end if;
  return query
    select e.id, e.raw_blob_ref, e.captured_at, s.retention_days
    from public.discovery_evidence_items e
    join public.discovery_source_registry s
      on s.company_id = e.company_id and s.id = e.source_id
    where e.captured_at <= clock_timestamp() - make_interval(days => greatest(1,s.retention_days))
    order by e.captured_at asc
    limit p_limit;
end;
$retention$;

revoke all on function public.set_discovery_company_worker_grant(uuid,uuid,boolean,text) from public, anon, authenticated;
grant execute on function public.set_discovery_company_worker_grant(uuid,uuid,boolean,text) to service_role;
revoke all on function public.list_expired_discovery_evidence(integer) from public, anon, authenticated;
grant execute on function public.list_expired_discovery_evidence(integer) to service_role;

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
      on wc.company_id = j.company_id and wc.enabled = true and wc.expires_at > v_now
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


-- Heartbeats also verify the temporary company-level grant. Turning it off or
-- letting it expire causes active workers to abort on their next heartbeat.
create or replace function public.heartbeat_discovery_job(
  p_job_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 90
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare v_updated integer;
begin
  if p_lease_seconds < 15 or p_lease_seconds > 300 then
    raise exception 'Lease duration must be between 15 and 300 seconds' using errcode = '22023';
  end if;
  update public.discovery_jobs j
    set heartbeat_at = clock_timestamp(),
        lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
        updated_at = clock_timestamp()
    where j.id = p_job_id and j.status = 'running'
      and j.lease_owner = p_worker_id and j.lease_expires_at > clock_timestamp()
      and exists (
        select 1 from public.discovery_company_worker_controls wc
        where wc.company_id = j.company_id and wc.enabled = true
          and wc.expires_at > clock_timestamp()
      );
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$function$;
revoke all on function public.heartbeat_discovery_job(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.heartbeat_discovery_job(uuid,text,integer) to service_role;

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
      on wc.company_id = j.company_id and wc.enabled = true and wc.expires_at > v_now
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


-- Retire the pre-E04.3 claim/quota RPCs: they predate the temporary company
-- worker grant and must not remain an alternate execution path.
revoke all on function public.claim_discovery_job(text,integer) from public, anon, authenticated, service_role;
revoke all on function public.reserve_discovery_source_request(uuid,uuid,uuid,text) from public, anon, authenticated, service_role;

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
