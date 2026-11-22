-- AXIVESTRA E05: deterministic extraction and schema normalisation.
-- No LLM provider, external search or source network access is used by this stage.
begin;
-- E05 adds an auditable retention terminal event to the existing fetch ledger.
alter table public.discovery_fetch_events
  drop constraint if exists discovery_fetch_events_event_type_check;
alter table public.discovery_fetch_events
  add constraint discovery_fetch_events_event_type_check check (event_type in (
    'request_started','response_received','request_failed','quota_denied',
    'robots_blocked','cache_hit','policy_rejected','worker_paused','retention_purged'
  ));

update storage.buckets
set allowed_mime_types = (
  select array_agg(distinct mime_type)
  from unnest(coalesce(allowed_mime_types, array[]::text[]) || array['text/csv','application/csv']) as mime_type
)
where id = 'discovery-evidence';


-- Extend the shared company audit ledger for explicit extraction-review receipts.
alter table public.discovery_audit_events
  drop constraint if exists discovery_audit_events_action_check;
alter table public.discovery_audit_events
  add constraint discovery_audit_events_action_check check (action in (
    'source_registered','source_approved','source_paused','source_rejected',
    'profile_created','profile_updated','profile_enabled','profile_disabled',
    'profile_source_attached','profile_source_detached',
    'discovery_job_queued','discovery_worker_grant_enabled','discovery_worker_grant_disabled',
    'extraction_review_recorded'
  ));
alter table public.discovery_audit_events
  drop constraint if exists discovery_audit_events_entity_type_check;
alter table public.discovery_audit_events
  add constraint discovery_audit_events_entity_type_check check (entity_type in (
    'source','profile','profile_source','discovery_job','discovery_worker_control','extraction_review_event'
  ));


alter table public.discovery_source_registry
  add column if not exists field_schema jsonb not null default '{}'::jsonb
  check (jsonb_typeof(field_schema) = 'object');

-- Existing sources receive a conservative exact-key schema. Owners may
-- refine data types and aliases through the source registry before next approval.
update public.discovery_source_registry s
set field_schema = (
  select coalesce(jsonb_object_agg(field_name,
    jsonb_build_object(
      'type', case
        when field_name in ('email','public_email','contact_email') then 'email'
        when field_name in ('phone','telephone','public_phone','contact_phone') then 'phone'
        when field_name in ('website','url','source_url') then 'url'
        when field_name in ('date','founded_date','registration_date','updated_date') then 'date'
        when field_name in ('turnover','annual_turnover','amount','ticket_size','revenue','assets_under_management') then 'currency'
        else 'string'
      end,
      'aliases', jsonb_build_array(field_name),
      'required', false,
      'entityKind', case
        when field_name in ('legal_name','company_name','organization_name','entity_name','institution_name') then 'organization'
        else null
      end
    )
  ), '{}'::jsonb)
  from unnest(s.allowed_fields) as field_name
)
where s.field_schema = '{}'::jsonb;

create unique index if not exists discovery_evidence_company_id_unique
  on public.discovery_evidence_items(company_id, id);

create table if not exists public.discovery_extraction_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  evidence_id uuid not null,
  source_id uuid not null,
  status text not null default 'queued'
    check (status in ('queued','running','succeeded','failed','cancelled')),
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
  unique(company_id, evidence_id),
  unique(company_id, id),
  unique(company_id, id, evidence_id, source_id),
  foreign key (company_id, evidence_id)
    references public.discovery_evidence_items(company_id, id) on delete cascade,
  foreign key (company_id, source_id)
    references public.discovery_source_registry(company_id, id) on delete restrict
);

create index if not exists discovery_extraction_jobs_claim_idx
  on public.discovery_extraction_jobs(status, available_at, created_at)
  where status in ('queued','running');
create index if not exists discovery_extraction_jobs_company_idx
  on public.discovery_extraction_jobs(company_id, created_at desc);

create table if not exists public.discovery_extraction_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  extraction_job_id uuid not null,
  evidence_id uuid not null,
  source_id uuid not null,
  extractor_version text not null,
  schema_hash text not null check (schema_hash ~ '^[a-f0-9]{64}$'),
  extraction_method text not null default 'deterministic',
  status text not null check (status in ('completed','completed_with_warnings','no_structured_facts')),
  extracted_entity_count integer not null default 0 check (extracted_entity_count >= 0),
  fact_count integer not null default 0 check (fact_count >= 0),
  invalid_fact_count integer not null default 0 check (invalid_fact_count >= 0),
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  source_content_hash text not null check (source_content_hash ~ '^[a-f0-9]{64}$'),
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(company_id, id),
  unique(company_id, id, evidence_id),
  foreign key (company_id, extraction_job_id, evidence_id, source_id)
    references public.discovery_extraction_jobs(company_id, id, evidence_id, source_id) on delete cascade,
  foreign key (company_id, evidence_id)
    references public.discovery_evidence_items(company_id, id) on delete cascade,
  foreign key (company_id, source_id)
    references public.discovery_source_registry(company_id, id) on delete restrict
);

create index if not exists discovery_extraction_runs_evidence_idx
  on public.discovery_extraction_runs(company_id, evidence_id, completed_at desc);

create table if not exists public.discovery_extracted_entities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  extraction_run_id uuid not null,
  evidence_id uuid not null,
  mention_key text not null check (length(mention_key) between 1 and 160),
  entity_kind text not null check (entity_kind in ('organization','person','location','unknown')),
  raw_name text not null check (length(trim(raw_name)) between 1 and 1000),
  normalized_name text not null check (length(trim(normalized_name)) between 1 and 1000),
  source_span jsonb not null check (jsonb_typeof(source_span) = 'object'),
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  extraction_method text not null default 'deterministic'
    check (extraction_method in ('deterministic','llm_experimental')),
  created_at timestamptz not null default now(),
  unique(extraction_run_id, mention_key),
  unique(company_id, id),
  unique(company_id, extraction_run_id, id),
  foreign key (company_id, extraction_run_id, evidence_id)
    references public.discovery_extraction_runs(company_id, id, evidence_id) on delete cascade,
  foreign key (company_id, evidence_id)
    references public.discovery_evidence_items(company_id, id) on delete cascade
);

create index if not exists discovery_extracted_entities_run_idx
  on public.discovery_extracted_entities(company_id, extraction_run_id);

create table if not exists public.discovery_extracted_facts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  extraction_run_id uuid not null,
  evidence_id uuid not null,
  extracted_entity_id uuid,
  field_name text not null check (length(trim(field_name)) between 1 and 128),
  value_type text not null check (value_type in (
    'string','number','boolean','date','email','phone','url','identifier',
    'currency','percentage','object','array'
  )),
  raw_value text not null check (length(raw_value) <= 20000),
  normalized_value jsonb,
  source_span jsonb not null check (jsonb_typeof(source_span) = 'object'),
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  validation_status text not null check (validation_status in ('valid','invalid')),
  validation_message text check (validation_message is null or length(validation_message) <= 500),
  extraction_method text not null default 'deterministic'
    check (extraction_method in ('deterministic','llm_experimental')),
  created_at timestamptz not null default now(),
  unique(company_id, id),
  unique(company_id, extraction_run_id, id),
  foreign key (company_id, extraction_run_id, evidence_id)
    references public.discovery_extraction_runs(company_id, id, evidence_id) on delete cascade,
  foreign key (company_id, evidence_id)
    references public.discovery_evidence_items(company_id, id) on delete cascade,
  foreign key (company_id, extraction_run_id, extracted_entity_id)
    references public.discovery_extracted_entities(company_id, extraction_run_id, id) on delete cascade
);

create index if not exists discovery_extracted_facts_run_idx
  on public.discovery_extracted_facts(company_id, extraction_run_id, field_name);
create index if not exists discovery_extracted_facts_evidence_idx
  on public.discovery_extracted_facts(company_id, evidence_id, field_name);

create table if not exists public.discovery_extraction_review_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  extraction_run_id uuid not null,
  fact_id uuid,
  extracted_entity_id uuid,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  decision text not null check (decision in ('accepted','rejected','corrected','escalated')),
  reason text not null check (length(trim(reason)) between 1 and 1000),
  corrected_value jsonb,
  occurred_at timestamptz not null default now(),
  check ((fact_id is null) <> (extracted_entity_id is null)),
  foreign key (company_id, extraction_run_id)
    references public.discovery_extraction_runs(company_id, id) on delete cascade,
  foreign key (company_id, extraction_run_id, fact_id)
    references public.discovery_extracted_facts(company_id, extraction_run_id, id) on delete cascade,
  foreign key (company_id, extraction_run_id, extracted_entity_id)
    references public.discovery_extracted_entities(company_id, extraction_run_id, id) on delete cascade
);

create index if not exists discovery_extraction_review_events_run_idx
  on public.discovery_extraction_review_events(company_id, extraction_run_id, occurred_at desc);

alter table public.discovery_extraction_jobs enable row level security;
alter table public.discovery_extraction_runs enable row level security;
alter table public.discovery_extracted_entities enable row level security;
alter table public.discovery_extracted_facts enable row level security;
alter table public.discovery_extraction_review_events enable row level security;

revoke all on public.discovery_extraction_jobs from public, anon, authenticated;
revoke all on public.discovery_extraction_runs from public, anon, authenticated;
revoke all on public.discovery_extracted_entities from public, anon, authenticated;
revoke all on public.discovery_extracted_facts from public, anon, authenticated;
revoke all on public.discovery_extraction_review_events from public, anon, authenticated;

grant all on public.discovery_extraction_jobs to service_role;
grant all on public.discovery_extraction_runs to service_role;
grant all on public.discovery_extracted_entities to service_role;
grant all on public.discovery_extracted_facts to service_role;
grant all on public.discovery_extraction_review_events to service_role;

-- An evidence snapshot becomes eligible for extraction once, and only once.
create or replace function public.enqueue_discovery_extraction_for_evidence()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $trigger$
begin
  insert into public.discovery_extraction_jobs(company_id, evidence_id, source_id, status)
    select new.company_id, new.id, new.source_id, 'queued'
    from public.discovery_source_registry s
    where s.company_id = new.company_id and s.id = new.source_id
      and s.status = 'approved'
      and new.content_type in (
        'text/html','text/plain','application/json','application/ld+json',
        'application/xml','text/xml','application/pdf','text/csv','application/csv'
      )
    on conflict (company_id, evidence_id) do nothing;
  return new;
end;
$trigger$;

drop trigger if exists discovery_evidence_enqueue_extraction on public.discovery_evidence_items;
create trigger discovery_evidence_enqueue_extraction
  after insert on public.discovery_evidence_items
  for each row execute function public.enqueue_discovery_extraction_for_evidence();

-- Queue already-captured evidence for the first E05 run. Require its parent
-- discovery job to have completed and the LENDER/CUSTOMER profile to remain enabled.
insert into public.discovery_extraction_jobs(company_id,evidence_id,source_id,status)
select e.company_id,e.id,e.source_id,'queued'
from public.discovery_evidence_items e
join public.discovery_source_registry s
  on s.company_id=e.company_id and s.id=e.source_id and s.status='approved'
join public.discovery_jobs dj
  on dj.company_id=e.company_id and dj.id=e.job_id and dj.status='succeeded'
join public.discovery_profiles p
  on p.company_id=dj.company_id and p.id=dj.profile_id and p.enabled=true
join public.discovery_profile_sources ps
  on ps.company_id=dj.company_id and ps.profile_id=dj.profile_id and ps.source_id=e.source_id
where e.content_type in (
  'text/html','text/plain','application/json','application/ld+json',
  'application/xml','text/xml','application/pdf','text/csv','application/csv'
)
on conflict (company_id,evidence_id) do nothing;

create or replace function public.claim_discovery_extraction_job(
  p_worker_id text,
  p_lease_seconds integer default 90
) returns setof public.discovery_extraction_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $claim$
declare
  v_job public.discovery_extraction_jobs%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_worker_id is null or length(trim(p_worker_id)) < 8 or length(p_worker_id) > 160 then
    raise exception 'Invalid extraction worker identity' using errcode = '22023';
  end if;
  if p_lease_seconds < 15 or p_lease_seconds > 300 then
    raise exception 'Extraction lease duration must be 15 to 300 seconds' using errcode = '22023';
  end if;

  update public.discovery_extraction_jobs
    set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
        lease_owner = null, lease_expires_at = null, heartbeat_at = null,
        finished_at = case when attempts >= max_attempts then v_now else null end,
        available_at = case when attempts >= max_attempts then available_at
          else v_now + make_interval(secs => least(30 * greatest(attempts,1),300)) end,
        last_error_code = coalesce(last_error_code,'EXTRACTION_LEASE_EXPIRED'),
        last_error_message = coalesce(last_error_message,'Previous extraction worker lease expired.'),
        updated_at = v_now
    where status = 'running' and lease_expires_at <= v_now;

  select j.* into v_job
    from public.discovery_extraction_jobs j
    join public.discovery_source_registry s
      on s.company_id = j.company_id and s.id = j.source_id and s.status = 'approved'
    join public.discovery_evidence_items e
      on e.company_id = j.company_id and e.id = j.evidence_id
    join public.discovery_jobs dj
      on dj.company_id = e.company_id and dj.id = e.job_id and dj.status = 'succeeded'
    join public.discovery_profiles p
      on p.company_id = dj.company_id and p.id = dj.profile_id and p.enabled = true
    join public.discovery_profile_sources ps
      on ps.company_id = dj.company_id and ps.profile_id = dj.profile_id and ps.source_id = j.source_id
    where j.status = 'queued' and j.available_at <= v_now and j.attempts < j.max_attempts
    order by j.available_at, j.created_at
    for update of j skip locked
    limit 1;

  if not found then return; end if;

  update public.discovery_extraction_jobs
    set status = 'running', attempts = attempts + 1,
        lease_owner = p_worker_id,
        lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
        heartbeat_at = v_now, started_at = coalesce(started_at,v_now),
        updated_at = v_now
    where id = v_job.id
    returning * into v_job;

  return next v_job;
end;
$claim$;

create or replace function public.heartbeat_discovery_extraction_job(
  p_job_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 90
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $heartbeat$
declare v_updated integer;
begin
  if p_lease_seconds < 15 or p_lease_seconds > 300 then
    raise exception 'Extraction lease duration must be 15 to 300 seconds' using errcode = '22023';
  end if;
  update public.discovery_extraction_jobs j
    set heartbeat_at = clock_timestamp(),
        lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
        updated_at = clock_timestamp()
    where j.id = p_job_id and j.status = 'running'
      and j.lease_owner = p_worker_id and j.lease_expires_at > clock_timestamp()
      and exists (
        select 1 from public.discovery_source_registry s
        where s.company_id = j.company_id and s.id = j.source_id and s.status = 'approved'
      )
      and exists (
        select 1 from public.discovery_evidence_items e
        join public.discovery_jobs dj on dj.company_id=e.company_id and dj.id=e.job_id and dj.status='succeeded'
        join public.discovery_profiles p on p.company_id=dj.company_id and p.id=dj.profile_id and p.enabled=true
        join public.discovery_profile_sources ps on ps.company_id=dj.company_id and ps.profile_id=dj.profile_id and ps.source_id=j.source_id
        where e.company_id=j.company_id and e.id=j.evidence_id
      );
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$heartbeat$;

create or replace function public.complete_discovery_extraction(
  p_job_id uuid,
  p_worker_id text,
  p_run jsonb,
  p_entities jsonb,
  p_facts jsonb
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $complete$
declare
  v_job public.discovery_extraction_jobs%rowtype;
  v_source public.discovery_source_registry%rowtype;
  v_run_id uuid;
  v_entity jsonb;
  v_fact jsonb;
  v_entity_id uuid;
  v_entity_map jsonb := '{}'::jsonb;
  v_mention_key text;
  v_field text;
  v_fact_count integer := 0;
  v_entity_count integer := 0;
  v_evidence public.discovery_evidence_items%rowtype;
begin
  if jsonb_typeof(p_run) <> 'object' or jsonb_typeof(p_entities) <> 'array'
    or jsonb_typeof(p_facts) <> 'array'
    or (p_run ? 'warnings' and jsonb_typeof(p_run->'warnings') <> 'array')
    or jsonb_array_length(p_entities) > 500
    or jsonb_array_length(p_facts) > 2000 then
    raise exception 'Extraction result payload is outside approved bounds' using errcode = '22023';
  end if;

  select * into v_job from public.discovery_extraction_jobs
    where id = p_job_id and status = 'running'
      and lease_owner = p_worker_id and lease_expires_at > clock_timestamp()
    for update;
  if not found then
    raise exception 'Extraction job lease is no longer valid' using errcode = '42501';
  end if;

  select * into v_source from public.discovery_source_registry
    where company_id = v_job.company_id and id = v_job.source_id and status = 'approved'
    for share;
  if not found then
    raise exception 'Extraction source approval has been revoked' using errcode = '42501';
  end if;
  select * into v_evidence from public.discovery_evidence_items
    where company_id = v_job.company_id and id = v_job.evidence_id
    for share;
  if not found or v_evidence.source_id <> v_job.source_id
    or v_evidence.content_hash is distinct from p_run->>'source_content_hash' then
    raise exception 'Extraction evidence hash or source does not match the immutable snapshot' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.discovery_jobs dj
    join public.discovery_profiles p
      on p.company_id = dj.company_id and p.id = dj.profile_id and p.enabled = true
    join public.discovery_profile_sources ps
      on ps.company_id = dj.company_id and ps.profile_id = dj.profile_id and ps.source_id = v_job.source_id
    where dj.company_id = v_job.company_id and dj.id = v_evidence.job_id and dj.status = 'succeeded'
  ) then
    raise exception 'Parent discovery job, profile or source attachment is no longer eligible for extraction' using errcode = '42501';
  end if;
  if v_source.field_schema is distinct from p_run->'source_field_schema_snapshot'
    or to_jsonb(v_source.allowed_fields) is distinct from p_run->'source_allowed_fields_snapshot' then
    raise exception 'Source extraction schema changed during processing; retry against the current reviewed schema' using errcode = '40001';
  end if;

  insert into public.discovery_extraction_runs(
    company_id, extraction_job_id, evidence_id, source_id,
    extractor_version, schema_hash, extraction_method, status,
    extracted_entity_count, fact_count, invalid_fact_count, warnings,
    source_content_hash, completed_at
  ) values (
    v_job.company_id, v_job.id, v_job.evidence_id, v_job.source_id,
    left(coalesce(p_run->>'extractor_version','deterministic-v1'),80),
    p_run->>'schema_hash',
    'deterministic',
    case
      when jsonb_array_length(p_facts) = 0 then 'no_structured_facts'
      when coalesce((p_run->>'invalid_fact_count')::integer,0) > 0 then 'completed_with_warnings'
      when jsonb_array_length(p_run->'warnings') > 0 then 'completed_with_warnings'
      else 'completed'
    end,
    jsonb_array_length(p_entities), jsonb_array_length(p_facts),
    coalesce((p_run->>'invalid_fact_count')::integer,0),
    coalesce(p_run->'warnings','[]'::jsonb),
    p_run->>'source_content_hash',
    clock_timestamp()
  ) returning id into v_run_id;

  for v_entity in select value from jsonb_array_elements(p_entities)
  loop
    v_mention_key := v_entity->>'mention_key';
    if v_mention_key is null or length(v_mention_key) = 0 or length(v_mention_key) > 160 then
      raise exception 'Invalid extracted entity mention key' using errcode = '22023';
    end if;
    insert into public.discovery_extracted_entities(
      company_id, extraction_run_id, evidence_id, mention_key, entity_kind,
      raw_name, normalized_name, source_span, confidence, extraction_method
    ) values (
      v_job.company_id, v_run_id, v_job.evidence_id, v_mention_key,
      coalesce(v_entity->>'entity_kind','organization'),
      v_entity->>'raw_name', v_entity->>'normalized_name',
      coalesce(v_entity->'source_span','{}'::jsonb),
      (v_entity->>'confidence')::numeric, 'deterministic'
    ) returning id into v_entity_id;
    v_entity_map := jsonb_set(v_entity_map, array[v_mention_key], to_jsonb(v_entity_id), true);
    v_entity_count := v_entity_count + 1;
  end loop;

  for v_fact in select value from jsonb_array_elements(p_facts)
  loop
    v_field := v_fact->>'field_name';
    if v_field is null or not (v_field = any(v_source.allowed_fields)) then
      raise exception 'Extraction attempted a field outside the approved source allow-list' using errcode = '42501';
    end if;
    if not (v_source.field_schema ? v_field) then
      raise exception 'Extraction attempted a field without an approved field schema' using errcode = '42501';
    end if;
    if v_source.field_schema->v_field->>'type' is distinct from v_fact->>'value_type' then
      raise exception 'Extraction value type does not match the approved field schema' using errcode = '42501';
    end if;
    v_mention_key := nullif(v_fact->>'mention_key','');
    v_entity_id := null;
    if v_mention_key is not null then
      v_entity_id := nullif(v_entity_map->>v_mention_key,'')::uuid;
      if v_entity_id is null then
        raise exception 'Extracted fact references an unknown entity mention' using errcode = '22023';
      end if;
    end if;
    insert into public.discovery_extracted_facts(
      company_id, extraction_run_id, evidence_id, extracted_entity_id,
      field_name, value_type, raw_value, normalized_value, source_span,
      confidence, validation_status, validation_message, extraction_method
    ) values (
      v_job.company_id, v_run_id, v_job.evidence_id, v_entity_id,
      v_field, v_fact->>'value_type', left(coalesce(v_fact->>'raw_value',''),20000),
      v_fact->'normalized_value', coalesce(v_fact->'source_span','{}'::jsonb),
      (v_fact->>'confidence')::numeric,
      coalesce(v_fact->>'validation_status','valid'),
      left(v_fact->>'validation_message',500), 'deterministic'
    );
    v_fact_count := v_fact_count + 1;
  end loop;

  update public.discovery_extraction_jobs
    set status = 'succeeded', finished_at = clock_timestamp(),
        lease_owner = null, lease_expires_at = null, heartbeat_at = null,
        updated_at = clock_timestamp()
    where id = v_job.id;

  return v_run_id;
end;
$complete$;

create or replace function public.fail_discovery_extraction_job(
  p_job_id uuid,
  p_worker_id text,
  p_error_code text,
  p_error_message text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fail$
declare v_job public.discovery_extraction_jobs%rowtype;
begin
  select * into v_job from public.discovery_extraction_jobs
    where id = p_job_id and status = 'running'
      and lease_owner = p_worker_id and lease_expires_at > clock_timestamp()
    for update;
  if not found then return false; end if;

  update public.discovery_extraction_jobs
    set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
        available_at = clock_timestamp() + make_interval(secs => least(30 * greatest(attempts,1),300)),
        lease_owner = null, lease_expires_at = null, heartbeat_at = null,
        finished_at = case when attempts >= max_attempts then clock_timestamp() else null end,
        last_error_code = left(coalesce(p_error_code,'EXTRACTION_FAILED'),100),
        last_error_message = left(coalesce(p_error_message,'Extraction failed.'),1000),
        updated_at = clock_timestamp()
    where id = v_job.id;
  return true;
end;
$fail$;

-- Review decision and audit receipt must commit atomically. This RPC is
-- service-role only; company owner/admin authority is independently rechecked.
create or replace function public.record_discovery_extraction_review(
  p_company_id uuid,
  p_actor_user_id uuid,
  p_run_id uuid,
  p_fact_id uuid,
  p_entity_id uuid,
  p_decision text,
  p_reason text,
  p_corrected_value jsonb default null
) returns public.discovery_extraction_review_events
language plpgsql
security definer
set search_path = public, pg_temp
as $review$
declare
  v_role text;
  v_run public.discovery_extraction_runs%rowtype;
  v_review public.discovery_extraction_review_events%rowtype;
begin
  if p_company_id is null or p_actor_user_id is null or p_run_id is null then
    raise exception 'Company, actor and extraction run are required' using errcode = '22023';
  end if;
  if (p_fact_id is null) = (p_entity_id is null) then
    raise exception 'Review exactly one extracted fact or entity mention' using errcode = '22023';
  end if;
  if p_decision is null or p_decision not in ('accepted','rejected','corrected','escalated') then
    raise exception 'Unsupported extraction review decision' using errcode = '22023';
  end if;
  if p_reason is null or length(trim(p_reason)) < 1 or length(p_reason) > 1000 then
    raise exception 'Review reason is required and must not exceed 1000 characters' using errcode = '22023';
  end if;
  if (p_decision = 'corrected') <> (p_corrected_value is not null) then
    raise exception 'A corrected value is required only for a corrected decision' using errcode = '22023';
  end if;
  if p_corrected_value is not null and octet_length(p_corrected_value::text) > 4096 then
    raise exception 'Corrected value must not exceed 4 KB' using errcode = '22023';
  end if;

  select role into v_role
    from public.company_memberships
    where company_id = p_company_id and user_id = p_actor_user_id
    for share;
  if v_role is null or v_role not in ('owner','admin') then
    raise exception 'Only a company owner or admin can review extracted facts' using errcode = '42501';
  end if;

  select * into v_run
    from public.discovery_extraction_runs
    where company_id = p_company_id and id = p_run_id
    for share;
  if not found then
    raise exception 'Extraction run was not found in this company' using errcode = 'P0002';
  end if;

  if p_fact_id is not null and not exists (
    select 1 from public.discovery_extracted_facts
    where company_id = p_company_id and extraction_run_id = v_run.id and id = p_fact_id
  ) then
    raise exception 'Fact was not found in this extraction run' using errcode = 'P0002';
  end if;
  if p_entity_id is not null and not exists (
    select 1 from public.discovery_extracted_entities
    where company_id = p_company_id and extraction_run_id = v_run.id and id = p_entity_id
  ) then
    raise exception 'Entity mention was not found in this extraction run' using errcode = 'P0002';
  end if;

  insert into public.discovery_extraction_review_events(
    company_id, extraction_run_id, fact_id, extracted_entity_id,
    actor_user_id, decision, reason, corrected_value
  ) values (
    p_company_id, v_run.id, p_fact_id, p_entity_id,
    p_actor_user_id, p_decision, trim(p_reason), p_corrected_value
  ) returning * into v_review;

  insert into public.discovery_audit_events(
    company_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    p_company_id, p_actor_user_id, 'extraction_review_recorded',
    'extraction_review_event', v_review.id,
    jsonb_build_object(
      'extractionRunId', v_run.id,
      'factId', p_fact_id,
      'entityId', p_entity_id,
      'decision', p_decision
    )
  );

  return v_review;
end;
$review$;

revoke all on function public.record_discovery_extraction_review(uuid,uuid,uuid,uuid,uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.record_discovery_extraction_review(uuid,uuid,uuid,uuid,uuid,text,text,jsonb) to service_role;

-- Extraction results are immutable snapshots. Corrections are separate review events.
create or replace function public.prevent_discovery_extraction_update()
returns trigger language plpgsql as $guard$
begin
  raise exception 'Extraction output is append-only; record a review/correction event.';
end;
$guard$;

drop trigger if exists discovery_extraction_runs_no_update on public.discovery_extraction_runs;
create trigger discovery_extraction_runs_no_update before update on public.discovery_extraction_runs
  for each row execute function public.prevent_discovery_extraction_update();
drop trigger if exists discovery_extracted_entities_no_update on public.discovery_extracted_entities;
create trigger discovery_extracted_entities_no_update before update on public.discovery_extracted_entities
  for each row execute function public.prevent_discovery_extraction_update();
drop trigger if exists discovery_extracted_facts_no_update on public.discovery_extracted_facts;
create trigger discovery_extracted_facts_no_update before update on public.discovery_extracted_facts
  for each row execute function public.prevent_discovery_extraction_update();

drop trigger if exists discovery_extraction_review_events_no_update on public.discovery_extraction_review_events;
create trigger discovery_extraction_review_events_no_update before update on public.discovery_extraction_review_events
  for each row execute function public.prevent_discovery_extraction_update();

revoke all on function public.claim_discovery_extraction_job(text,integer) from public, anon, authenticated;
revoke all on function public.heartbeat_discovery_extraction_job(uuid,text,integer) from public, anon, authenticated;
revoke all on function public.complete_discovery_extraction(uuid,text,jsonb,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.fail_discovery_extraction_job(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.claim_discovery_extraction_job(text,integer) to service_role;
grant execute on function public.heartbeat_discovery_extraction_job(uuid,text,integer) to service_role;
grant execute on function public.complete_discovery_extraction(uuid,text,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.fail_discovery_extraction_job(uuid,text,text,text) to service_role;

comment on table public.discovery_extraction_runs is
  'Immutable deterministic extraction run metadata bound to one immutable source evidence snapshot.';
comment on table public.discovery_extracted_entities is
  'Unresolved entity mentions, not canonical companies or people. Entity resolution belongs to E06/E07.';
comment on table public.discovery_extracted_facts is
  'Typed extracted facts with exact evidence locator, raw value and schema-validation status. Nothing here is accepted as a verified business fact without review.';
comment on table public.discovery_extraction_review_events is
  'Append-only human review and correction history. Discovery/extraction never creates a workspace record or implies consent.';

commit;
