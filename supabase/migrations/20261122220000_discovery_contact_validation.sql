-- AXIVESTRA E08: observed contact validation, not contact discovery or consent.
-- Contacts are accepted only from explicit source-allowlisted E05 email/phone facts.
-- Values are encrypted by the server worker before storage; raw values are never logged.
begin;

alter table public.discovery_audit_events
  drop constraint if exists discovery_audit_events_action_check;
alter table public.discovery_audit_events
  add constraint discovery_audit_events_action_check check (action in (
    'source_registered','source_approved','source_paused','source_rejected',
    'profile_created','profile_updated','profile_enabled','profile_disabled',
    'profile_source_attached','profile_source_detached',
    'discovery_job_queued','discovery_worker_grant_enabled','discovery_worker_grant_disabled',
    'extraction_review_recorded','entity_resolution_review_recorded',
    'entity_relationship_review_recorded','professional_role_review_recorded',
    'contact_point_review_recorded'
  ));
alter table public.discovery_audit_events
  drop constraint if exists discovery_audit_events_entity_type_check;
alter table public.discovery_audit_events
  add constraint discovery_audit_events_entity_type_check check (entity_type in (
    'source','profile','profile_source','discovery_job','discovery_worker_control',
    'extraction_review_event','entity_resolution_candidate','canonical_entity',
    'entity_relationship','professional_role_candidate','professional_person',
    'contact_point'
  ));

create table if not exists public.discovery_contact_validation_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  extraction_run_id uuid not null,
  evidence_id uuid not null,
  source_id uuid not null,
  field_schema_snapshot jsonb not null check (jsonb_typeof(field_schema_snapshot)='object'),
  allowed_fields_snapshot text[] not null default '{}',
  status text not null default 'queued'
    check (status in ('queued','running','succeeded','failed','cancelled')),
  attempts integer not null default 0 check (attempts>=0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 5),
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  last_error_code text,
  last_error_message text check (last_error_message is null or length(last_error_message)<=1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,id),
  unique(company_id,extraction_run_id),
  foreign key (company_id,extraction_run_id,evidence_id)
    references public.discovery_extraction_runs(company_id,id,evidence_id) on delete cascade,
  foreign key (company_id,source_id)
    references public.discovery_source_registry(company_id,id) on delete restrict
);
create index if not exists discovery_contact_validation_jobs_claim_idx
  on public.discovery_contact_validation_jobs(status,available_at,created_at)
  where status in ('queued','running');

create table if not exists public.discovery_contact_candidates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  contact_job_id uuid not null,
  extraction_run_id uuid not null,
  extracted_fact_id uuid not null,
  extracted_entity_id uuid not null,
  entity_kind text not null check (entity_kind in ('person','organization','location','unknown')),
  contact_type text not null check (contact_type in ('email','phone')),
  field_name text not null check (length(trim(field_name)) between 1 and 128),
  value_ciphertext text not null check (length(value_ciphertext) between 1 and 800),
  value_nonce text not null check (length(value_nonce)<=64),
  value_auth_tag text not null check (length(value_auth_tag)<=64),
  value_fingerprint text not null check (value_fingerprint ~ '^[a-f0-9]{64}$'),
  encryption_version text not null check (encryption_version='aes-256-gcm-v1'),
  masked_value text not null check (length(masked_value) between 1 and 128),
  evidence_id uuid not null,
  source_span jsonb not null check (jsonb_typeof(source_span)='object'),
  validation_method text not null default 'syntax_only' check (validation_method='syntax_only'),
  validation_result text not null check (validation_result in ('syntax_valid','syntax_invalid')),
  validation_reason text,
  validation_confidence numeric(4,3) not null check (validation_confidence between 0 and 1),
  review_state text not null default 'pending_review'
    check (review_state in ('pending_review','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique(company_id,id),
  unique(company_id,extraction_run_id,extracted_fact_id),
  foreign key (company_id,contact_job_id)
    references public.discovery_contact_validation_jobs(company_id,id) on delete cascade,
  foreign key (company_id,extraction_run_id,extracted_fact_id)
    references public.discovery_extracted_facts(company_id,extraction_run_id,id) on delete cascade,
  foreign key (company_id,extraction_run_id,extracted_entity_id)
    references public.discovery_extracted_entities(company_id,extraction_run_id,id) on delete cascade
);
create index if not exists discovery_contact_candidates_review_idx
  on public.discovery_contact_candidates(company_id,review_state,created_at desc);
create index if not exists discovery_contact_candidates_fingerprint_idx
  on public.discovery_contact_candidates(company_id,contact_type,value_fingerprint);

create table if not exists public.discovery_contact_points (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  contact_type text not null check (contact_type in ('email','phone')),
  value_ciphertext text not null,
  value_nonce text not null,
  value_auth_tag text not null,
  value_fingerprint text not null check (value_fingerprint ~ '^[a-f0-9]{64}$'),
  encryption_version text not null check (encryption_version='aes-256-gcm-v1'),
  masked_value text not null,
  canonical_entity_id uuid,
  professional_person_id uuid,
  source_candidate_id uuid not null,
  source_evidence_id uuid not null,
  purpose text not null check (length(trim(purpose)) between 1 and 300),
  retention_until date not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'active' check (status in ('active','restricted','rejected')),
  created_at timestamptz not null default now(),
  unique(company_id,id),
  foreign key (company_id,canonical_entity_id)
    references public.discovery_canonical_entities(company_id,id) on delete restrict,
  foreign key (company_id,professional_person_id)
    references public.discovery_professional_people(company_id,id) on delete restrict
  -- source_candidate_id and source_evidence_id are historical identifiers.
);
create index if not exists discovery_contact_points_entity_idx
  on public.discovery_contact_points(company_id,canonical_entity_id,contact_type);
create index if not exists discovery_contact_points_person_idx
  on public.discovery_contact_points(company_id,professional_person_id,contact_type);
create index if not exists discovery_contact_points_retention_idx
  on public.discovery_contact_points(retention_until)
  where status in ('active','restricted');

create table if not exists public.discovery_contact_validation_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  contact_candidate_id uuid,
  contact_point_id uuid references public.discovery_contact_points(id) on delete set null,
  method text not null check (method in (
    'syntax_only','reacher_self_hosted','contracted_provider','inbound_bounce','manual_review'
  )),
  result text not null check (result in (
    'syntax_valid','syntax_invalid','reachable','not_reachable','catch_all',
    'mailbox_unknown','mx_found','no_mx','bounced','provider_unknown'
  )),
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  catch_all_result boolean,
  bounce_type text check (bounce_type is null or bounce_type in ('soft_bounce','hard_bounce','complaint')),
  provider_reference text check (provider_reference is null or length(provider_reference)<=200),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata)='object' and octet_length(metadata::text)<=4000),
  occurred_at timestamptz not null default now(),
  check (contact_candidate_id is not null or contact_point_id is not null)
);
create index if not exists discovery_contact_validation_events_candidate_idx
  on public.discovery_contact_validation_events(company_id,contact_candidate_id,occurred_at desc);
create index if not exists discovery_contact_validation_events_point_idx
  on public.discovery_contact_validation_events(company_id,contact_point_id,occurred_at desc);

alter table public.discovery_contact_validation_jobs enable row level security;
alter table public.discovery_contact_candidates enable row level security;
alter table public.discovery_contact_points enable row level security;
alter table public.discovery_contact_validation_events enable row level security;
revoke all on public.discovery_contact_validation_jobs,public.discovery_contact_candidates,
  public.discovery_contact_points,public.discovery_contact_validation_events
  from public,anon,authenticated;
grant all on public.discovery_contact_validation_jobs,public.discovery_contact_candidates,
  public.discovery_contact_points,public.discovery_contact_validation_events to service_role;

create or replace function public.enqueue_discovery_contact_validation_job()
returns trigger language plpgsql security definer
set search_path=public,pg_temp
as $enqueue$
declare v_source public.discovery_source_registry%rowtype;
begin
  if new.status not in ('completed','completed_with_warnings') then return new; end if;
  select * into v_source from public.discovery_source_registry
    where company_id=new.company_id and id=new.source_id and status='approved';
  if not found then return new; end if;
  if not exists (
    select 1 from jsonb_each(v_source.field_schema) as item(field_name,definition)
    where item.field_name=any(v_source.allowed_fields)
      and item.definition->>'type' in ('email','phone')
  ) then return new; end if;
  insert into public.discovery_contact_validation_jobs(
    company_id,extraction_run_id,evidence_id,source_id,
    field_schema_snapshot,allowed_fields_snapshot,status
  ) values (
    new.company_id,new.id,new.evidence_id,new.source_id,
    v_source.field_schema,v_source.allowed_fields,'queued'
  ) on conflict(company_id,extraction_run_id) do nothing;
  return new;
end;
$enqueue$;
drop trigger if exists discovery_extraction_enqueue_contact_validation on public.discovery_extraction_runs;
create trigger discovery_extraction_enqueue_contact_validation
  after insert on public.discovery_extraction_runs
  for each row execute function public.enqueue_discovery_contact_validation_job();

create or replace function public.claim_discovery_contact_validation_job(
  p_worker_id text,p_lease_seconds integer default 90
) returns setof public.discovery_contact_validation_jobs
language plpgsql security definer
set search_path=public,pg_temp
as $claim$
declare v_job public.discovery_contact_validation_jobs%rowtype; v_now timestamptz:=clock_timestamp();
begin
  if p_worker_id is null or length(trim(p_worker_id))<1 or length(p_worker_id)>160 then
    raise exception 'E08 worker id is required' using errcode='22023';
  end if;
  if p_lease_seconds<15 or p_lease_seconds>300 then
    raise exception 'E08 lease must be 15 to 300 seconds' using errcode='22023';
  end if;
  update public.discovery_contact_validation_jobs
    set status='queued',lease_owner=null,lease_expires_at=null,heartbeat_at=null,
      available_at=v_now,updated_at=v_now
    where status='running' and lease_expires_at<=v_now;
  select j.* into v_job
    from public.discovery_contact_validation_jobs j
    join public.discovery_extraction_runs r
      on r.company_id=j.company_id and r.id=j.extraction_run_id
      and r.status in ('completed','completed_with_warnings')
    join public.discovery_evidence_items e
      on e.company_id=j.company_id and e.id=j.evidence_id and e.content_hash=r.source_content_hash
    join public.discovery_source_registry s
      on s.company_id=j.company_id and s.id=j.source_id and s.status='approved'
      and s.field_schema=j.field_schema_snapshot and s.allowed_fields=j.allowed_fields_snapshot
    join public.discovery_jobs dj
      on dj.company_id=e.company_id and dj.id=e.job_id and dj.status='succeeded'
    join public.discovery_profiles p
      on p.company_id=dj.company_id and p.id=dj.profile_id and p.enabled=true
    join public.discovery_profile_sources ps
      on ps.company_id=dj.company_id and ps.profile_id=dj.profile_id and ps.source_id=j.source_id
    join public.discovery_company_worker_controls wc
      on wc.company_id=j.company_id and wc.enabled=true and wc.expires_at>v_now
    where j.status='queued' and j.available_at<=v_now and j.attempts<j.max_attempts
      and exists (
        select 1 from jsonb_each(j.field_schema_snapshot) as item(field_name,definition)
        where item.field_name=any(j.allowed_fields_snapshot)
          and item.definition->>'type' in ('email','phone')
      )
    order by j.available_at,j.created_at
    for update of j skip locked limit 1;
  if not found then return; end if;
  update public.discovery_contact_validation_jobs
    set status='running',attempts=attempts+1,lease_owner=p_worker_id,
      lease_expires_at=v_now+make_interval(secs=>p_lease_seconds),
      heartbeat_at=v_now,started_at=coalesce(started_at,v_now),updated_at=v_now
    where id=v_job.id returning * into v_job;
  return next v_job;
end;
$claim$;

create or replace function public.heartbeat_discovery_contact_validation_job(
  p_job_id uuid,p_worker_id text,p_lease_seconds integer default 90
) returns boolean language plpgsql security definer
set search_path=public,pg_temp
as $heartbeat$
declare v_count integer;
begin
  if p_lease_seconds<15 or p_lease_seconds>300 then
    raise exception 'E08 lease must be 15 to 300 seconds' using errcode='22023';
  end if;
  update public.discovery_contact_validation_jobs j
    set heartbeat_at=clock_timestamp(),
      lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),
      updated_at=clock_timestamp()
    where j.id=p_job_id and j.status='running' and j.lease_owner=p_worker_id
      and j.lease_expires_at>clock_timestamp()
      and exists (
        select 1 from public.discovery_source_registry s
        join public.discovery_evidence_items e on e.company_id=s.company_id
        join public.discovery_extraction_runs r on r.company_id=e.company_id and r.evidence_id=e.id
        join public.discovery_jobs dj on dj.company_id=e.company_id and dj.id=e.job_id and dj.status='succeeded'
        join public.discovery_profiles p on p.company_id=dj.company_id and p.id=dj.profile_id and p.enabled=true
        join public.discovery_profile_sources ps on ps.company_id=dj.company_id and ps.profile_id=dj.profile_id and ps.source_id=s.id
        join public.discovery_company_worker_controls wc on wc.company_id=s.company_id and wc.enabled=true and wc.expires_at>clock_timestamp()
        where s.company_id=j.company_id and s.id=j.source_id and s.status='approved'
          and s.field_schema=j.field_schema_snapshot and s.allowed_fields=j.allowed_fields_snapshot
          and e.id=j.evidence_id and e.content_hash=r.source_content_hash
          and r.id=j.extraction_run_id and r.status in ('completed','completed_with_warnings')
      );
  get diagnostics v_count=row_count;
  return v_count=1;
end;
$heartbeat$;

create or replace function public.complete_discovery_contact_validation_job(
  p_job_id uuid,p_worker_id text,p_candidates jsonb
) returns integer language plpgsql security definer
set search_path=public,pg_temp
as $complete$
declare
  v_job public.discovery_contact_validation_jobs%rowtype;
  v_candidate jsonb;
  v_count integer:=0;
  v_type text;
  v_field text;
begin
  if p_candidates is null or jsonb_typeof(p_candidates)<>'array' then
    raise exception 'E08 candidate batch must be a JSON array' using errcode='22023';
  end if;
  if jsonb_array_length(p_candidates)>500 or octet_length(p_candidates::text)>500000 then
    raise exception 'E08 candidate batch is outside approved bounds' using errcode='22023';
  end if;
  select * into v_job from public.discovery_contact_validation_jobs
    where id=p_job_id and status='running' and lease_owner=p_worker_id
      and lease_expires_at>clock_timestamp() for update;
  if not found then raise exception 'E08 lease is no longer valid' using errcode='42501'; end if;
  if not exists (
    select 1 from public.discovery_extraction_runs r
    join public.discovery_evidence_items e on e.company_id=r.company_id and e.id=r.evidence_id
    join public.discovery_source_registry s on s.company_id=r.company_id and s.id=r.source_id and s.status='approved'
      and s.field_schema=v_job.field_schema_snapshot and s.allowed_fields=v_job.allowed_fields_snapshot
    join public.discovery_jobs dj on dj.company_id=e.company_id and dj.id=e.job_id and dj.status='succeeded'
    join public.discovery_profiles p on p.company_id=dj.company_id and p.id=dj.profile_id and p.enabled=true
    join public.discovery_profile_sources ps on ps.company_id=dj.company_id and ps.profile_id=dj.profile_id and ps.source_id=r.source_id
    join public.discovery_company_worker_controls wc on wc.company_id=r.company_id and wc.enabled=true and wc.expires_at>clock_timestamp()
    where r.company_id=v_job.company_id and r.id=v_job.extraction_run_id
      and r.evidence_id=v_job.evidence_id and r.source_id=v_job.source_id
      and r.status in ('completed','completed_with_warnings') and r.source_content_hash=e.content_hash
  ) then raise exception 'E08 source, profile, worker grant or evidence is no longer eligible' using errcode='42501'; end if;

  for v_candidate in select value from jsonb_array_elements(p_candidates)
  loop
    if jsonb_typeof(v_candidate)<>'object' then
      raise exception 'E08 contact candidate payload must be an object' using errcode='22023';
    end if;
    v_type:=v_candidate->>'contact_type';
    v_field:=v_candidate->>'field_name';
    if v_type is null or v_type not in ('email','phone')
      or v_field is null or not (v_field=any(v_job.allowed_fields_snapshot))
      or v_job.field_schema_snapshot->v_field->>'type' is distinct from v_type
      or v_candidate->>'validation_method'<>'syntax_only'
      or v_candidate->>'validation_result' not in ('syntax_valid','syntax_invalid')
      or (v_candidate->>'validation_confidence')::numeric not between 0 and 1
      or v_candidate->>'encryption_version'<>'aes-256-gcm-v1'
      or coalesce(v_candidate->>'value_fingerprint','') !~ '^[a-f0-9]{64}$'
      or coalesce(v_candidate->>'value_ciphertext','') !~ '^[A-Za-z0-9+/]+={0,2}$'
      or coalesce(v_candidate->>'value_nonce','') !~ '^[A-Za-z0-9+/]+={0,2}$'
      or coalesce(v_candidate->>'value_auth_tag','') !~ '^[A-Za-z0-9+/]+={0,2}$'
      or jsonb_typeof(coalesce(v_candidate->'source_span','{}'::jsonb))<>'object' then
      raise exception 'E08 contact candidate payload failed source/type/encryption validation' using errcode='22023';
    end if;
    if not exists (
      select 1 from public.discovery_extracted_facts f
      where f.company_id=v_job.company_id and f.extraction_run_id=v_job.extraction_run_id
        and f.id=(v_candidate->>'extracted_fact_id')::uuid
        and f.field_name=v_field and f.value_type=v_type and f.validation_status='valid'
        and f.source_span=coalesce(v_candidate->'source_span','{}'::jsonb)
        and f.extracted_entity_id=(v_candidate->>'extracted_entity_id')::uuid
    ) then raise exception 'E08 contact must match a valid source-backed E05 fact exactly' using errcode='42501'; end if;
    if not exists (
      select 1 from public.discovery_extracted_entities x
      where x.company_id=v_job.company_id and x.extraction_run_id=v_job.extraction_run_id
        and x.id=(v_candidate->>'extracted_entity_id')::uuid
        and x.entity_kind=v_candidate->>'entity_kind'
    ) then raise exception 'E08 source entity does not belong to this extraction run' using errcode='42501'; end if;

    insert into public.discovery_contact_candidates(
      company_id,contact_job_id,extraction_run_id,extracted_fact_id,extracted_entity_id,
      entity_kind,contact_type,field_name,value_ciphertext,value_nonce,value_auth_tag,
      value_fingerprint,encryption_version,masked_value,evidence_id,source_span,
      validation_method,validation_result,validation_reason,validation_confidence
    ) values (
      v_job.company_id,v_job.id,v_job.extraction_run_id,
      (v_candidate->>'extracted_fact_id')::uuid,
      (v_candidate->>'extracted_entity_id')::uuid,
      v_candidate->>'entity_kind',v_type,v_field,
      v_candidate->>'value_ciphertext',v_candidate->>'value_nonce',v_candidate->>'value_auth_tag',
      v_candidate->>'value_fingerprint',v_candidate->>'encryption_version',
      left(v_candidate->>'masked_value',128),v_job.evidence_id,
      coalesce(v_candidate->'source_span','{}'::jsonb),'syntax_only',
      v_candidate->>'validation_result',nullif(left(v_candidate->'validation'->>'reason',250),''),
      greatest(0,least(1,(v_candidate->>'validation_confidence')::numeric))
    );
    insert into public.discovery_contact_validation_events(
      company_id,contact_candidate_id,method,result,confidence,catch_all_result,bounce_type,metadata
    ) values (
      v_job.company_id,
      (select id from public.discovery_contact_candidates
       where company_id=v_job.company_id and extraction_run_id=v_job.extraction_run_id
         and extracted_fact_id=(v_candidate->>'extracted_fact_id')::uuid),
      'syntax_only',v_candidate->>'validation_result',
      greatest(0,least(1,(v_candidate->>'validation_confidence')::numeric)),
      null,null,jsonb_build_object('reason',nullif(left(v_candidate->'validation'->>'reason',250),''))
    );
    v_count:=v_count+1;
  end loop;

  update public.discovery_contact_validation_jobs
    set status='succeeded',finished_at=clock_timestamp(),lease_owner=null,
      lease_expires_at=null,heartbeat_at=null,updated_at=clock_timestamp()
    where id=v_job.id;
  return v_count;
end;
$complete$;

create or replace function public.fail_discovery_contact_validation_job(
  p_job_id uuid,p_worker_id text,p_error_code text,p_error_message text
) returns boolean language plpgsql security definer
set search_path=public,pg_temp
as $fail$
declare v_job public.discovery_contact_validation_jobs%rowtype;
begin
  select * into v_job from public.discovery_contact_validation_jobs
    where id=p_job_id and status='running' and lease_owner=p_worker_id
      and lease_expires_at>clock_timestamp() for update;
  if not found then return false; end if;
  update public.discovery_contact_validation_jobs
    set status=case when attempts>=max_attempts then 'failed' else 'queued' end,
      available_at=clock_timestamp()+make_interval(secs=>least(30*greatest(attempts,1),300)),
      lease_owner=null,lease_expires_at=null,heartbeat_at=null,
      finished_at=case when attempts>=max_attempts then clock_timestamp() else null end,
      last_error_code=left(coalesce(p_error_code,'E08_FAILED'),100),
      last_error_message=left(coalesce(p_error_message,'E08 failed.'),1000),
      updated_at=clock_timestamp()
    where id=v_job.id;
  return true;
end;
$fail$;

-- Keep validation history append-only; correction is a new event, never an edit.
create or replace function public.prevent_discovery_contact_validation_event_mutation()
returns trigger language plpgsql
as $guard$
begin
  raise exception 'E08 contact validation events are append-only; record a new event instead.';
end;
$guard$;
drop trigger if exists discovery_contact_validation_events_no_update on public.discovery_contact_validation_events;
create trigger discovery_contact_validation_events_no_update
  before update or delete on public.discovery_contact_validation_events
  for each row execute function public.prevent_discovery_contact_validation_event_mutation();

create or replace function public.record_discovery_contact_validation_event(
  p_contact_point_id uuid,p_method text,p_result text,p_confidence numeric,
  p_catch_all_result boolean default null,p_bounce_type text default null,
  p_provider_reference text default null,p_metadata jsonb default '{}'::jsonb
) returns public.discovery_contact_validation_events
language plpgsql security definer
set search_path=public,pg_temp
as $event$
declare v_point public.discovery_contact_points%rowtype; v_event public.discovery_contact_validation_events%rowtype;
begin
  select * into v_point from public.discovery_contact_points where id=p_contact_point_id and status='active' for share;
  if not found then raise exception 'Active E08 contact point was not found' using errcode='P0002'; end if;
  if p_method not in ('reacher_self_hosted','contracted_provider','inbound_bounce','manual_review') then
    raise exception 'E08 provider method is not approved for this event' using errcode='22023';
  end if;
  if p_result not in ('reachable','not_reachable','catch_all','mailbox_unknown','mx_found','no_mx','bounced','provider_unknown') then
    raise exception 'Unsupported E08 provider result' using errcode='22023';
  end if;
  if p_confidence is null or p_confidence<0 or p_confidence>1 then
    raise exception 'E08 confidence must be between zero and one' using errcode='22023';
  end if;
  if p_bounce_type is not null and p_bounce_type not in ('soft_bounce','hard_bounce','complaint') then
    raise exception 'Unsupported E08 bounce classification' using errcode='22023';
  end if;
  insert into public.discovery_contact_validation_events(
    company_id,contact_point_id,method,result,confidence,catch_all_result,bounce_type,provider_reference,metadata
  ) values (
    v_point.company_id,p_contact_point_id,p_method,p_result,p_confidence,
    p_catch_all_result,p_bounce_type,left(p_provider_reference,200),coalesce(p_metadata,'{}'::jsonb)
  ) returning * into v_event;
  return v_event;
end;
$event$;

create or replace function public.record_discovery_contact_review(
  p_company_id uuid,p_actor_user_id uuid,p_candidate_id uuid,p_decision text,
  p_reason text,p_purpose text default null,p_retention_until date default null,
  p_canonical_entity_id uuid default null,p_professional_person_id uuid default null
) returns public.discovery_contact_points
language plpgsql security definer
set search_path=public,pg_temp
as $review$
declare
  v_role text;
  v_candidate public.discovery_contact_candidates%rowtype;
  v_person public.discovery_professional_people%rowtype;
  v_point public.discovery_contact_points%rowtype;
begin
  if p_decision not in ('approved','rejected') then
    raise exception 'Unsupported E08 review decision' using errcode='22023';
  end if;
  if p_reason is null or length(trim(p_reason))<1 or length(p_reason)>1000 then
    raise exception 'E08 review reason is required' using errcode='22023';
  end if;
  select role into v_role from public.company_memberships
    where company_id=p_company_id and user_id=p_actor_user_id for share;
  if v_role is null or v_role not in ('owner','admin') then
    raise exception 'Only a company owner or admin can review contact points' using errcode='42501';
  end if;
  select * into v_candidate from public.discovery_contact_candidates
    where company_id=p_company_id and id=p_candidate_id and review_state='pending_review'
    for update;
  if not found then raise exception 'Pending E08 contact candidate was not found in this company' using errcode='P0002'; end if;

  if p_decision='approved' then
    if v_candidate.validation_result<>'syntax_valid' then
      raise exception 'E08 syntax-invalid contact cannot be approved' using errcode='22023';
    end if;
    if p_purpose is null or length(trim(p_purpose))<1 or length(p_purpose)>300 then
      raise exception 'E08 processing purpose is required' using errcode='22023';
    end if;
    if p_retention_until is null or p_retention_until<=current_date or p_retention_until>current_date+365 then
      raise exception 'E08 retention expiry must be explicit and no more than 365 days away' using errcode='22023';
    end if;
    if p_canonical_entity_id is null and p_professional_person_id is null then
      raise exception 'A reviewed company or professional-person association is required' using errcode='22023';
    end if;
    if p_canonical_entity_id is not null and not exists (
      select 1 from public.discovery_canonical_entities
      where company_id=p_company_id and id=p_canonical_entity_id
        and entity_kind='organization' and status='active'
    ) then raise exception 'E08 company association is not an active canonical company' using errcode='42501'; end if;
    if p_professional_person_id is not null then
      select * into v_person from public.discovery_professional_people
        where company_id=p_company_id and id=p_professional_person_id and status='active'
        and retention_until>=p_retention_until for share;
      if not found then raise exception 'E08 professional person is not active or its retention ends earlier' using errcode='42501'; end if;
      if p_canonical_entity_id is not null and not exists (
        select 1 from public.discovery_professional_role_assignments
        where company_id=p_company_id and professional_person_id=p_professional_person_id
          and canonical_entity_id=p_canonical_entity_id
      ) then raise exception 'E08 person is not reviewed as associated with this company' using errcode='42501'; end if;
    end if;

    insert into public.discovery_contact_points(
      company_id,contact_type,value_ciphertext,value_nonce,value_auth_tag,value_fingerprint,
      encryption_version,masked_value,canonical_entity_id,professional_person_id,
      source_candidate_id,source_evidence_id,purpose,retention_until,created_by,status
    ) values (
      p_company_id,v_candidate.contact_type,v_candidate.value_ciphertext,v_candidate.value_nonce,
      v_candidate.value_auth_tag,v_candidate.value_fingerprint,v_candidate.encryption_version,
      v_candidate.masked_value,p_canonical_entity_id,p_professional_person_id,
      v_candidate.id,v_candidate.evidence_id,trim(p_purpose),p_retention_until,p_actor_user_id,'active'
    ) returning * into v_point;

    insert into public.discovery_contact_validation_events(
      company_id,contact_candidate_id,contact_point_id,method,result,confidence,metadata
    ) values (
      p_company_id,v_candidate.id,v_point.id,'manual_review','provider_unknown',1,
      jsonb_build_object('decision','approved','reason',left(trim(p_reason),1000))
    );
  else
    insert into public.discovery_contact_validation_events(
      company_id,contact_candidate_id,method,result,confidence,metadata
    ) values (
      p_company_id,v_candidate.id,'manual_review','provider_unknown',1,
      jsonb_build_object('decision','rejected','reason',left(trim(p_reason),1000))
    );
  end if;

  update public.discovery_contact_candidates
    set review_state=p_decision,reviewed_at=clock_timestamp()
    where company_id=p_company_id and id=p_candidate_id;

  if p_decision='approved' then
    insert into public.discovery_audit_events(
      company_id,actor_user_id,action,entity_type,entity_id,details
    ) values (
      p_company_id,p_actor_user_id,'contact_point_review_recorded','contact_point',v_point.id,
      jsonb_build_object('candidateId',p_candidate_id,'decision',p_decision,
        'contactType',v_candidate.contact_type,'purpose',left(trim(p_purpose),300),
        'retentionUntil',p_retention_until)
    );
  end if;
  return v_point;
end;
$review$;

revoke all on function public.claim_discovery_contact_validation_job(text,integer) from public,anon,authenticated;
revoke all on function public.heartbeat_discovery_contact_validation_job(uuid,text,integer) from public,anon,authenticated;
revoke all on function public.complete_discovery_contact_validation_job(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.fail_discovery_contact_validation_job(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.record_discovery_contact_validation_event(uuid,text,text,numeric,boolean,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.record_discovery_contact_review(uuid,uuid,uuid,text,text,text,date,uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_discovery_contact_validation_job(text,integer) to service_role;
grant execute on function public.heartbeat_discovery_contact_validation_job(uuid,text,integer) to service_role;
grant execute on function public.complete_discovery_contact_validation_job(uuid,text,jsonb) to service_role;
grant execute on function public.fail_discovery_contact_validation_job(uuid,text,text,text) to service_role;
grant execute on function public.record_discovery_contact_validation_event(uuid,text,text,numeric,boolean,text,text,jsonb) to service_role;
grant execute on function public.record_discovery_contact_review(uuid,uuid,uuid,text,text,text,date,uuid,uuid) to service_role;

comment on table public.discovery_contact_candidates is
  'E08 encrypted candidates from observed, allow-listed E05 contact facts; syntax validation is not deliverability or consent.';
comment on table public.discovery_contact_points is
  'Owner/admin-approved encrypted contact points with explicit purpose and retention expiry; no consent inference.';
comment on table public.discovery_contact_validation_events is
  'Append-only validation history separating syntax, provider, catch-all and bounce signals; stores no plaintext contact value.';

commit;
