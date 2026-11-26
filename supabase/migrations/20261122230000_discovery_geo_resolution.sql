-- AXIVESTRA E09: source-governed address normalisation and optional self-hosted geocoding.
-- Coordinates remain contextual place evidence; they never establish ownership, title or legal rights.
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
    'contact_point_review_recorded','place_resolution_review_recorded'
  ));
alter table public.discovery_audit_events
  drop constraint if exists discovery_audit_events_entity_type_check;
alter table public.discovery_audit_events
  add constraint discovery_audit_events_entity_type_check check (entity_type in (
    'source','profile','profile_source','discovery_job','discovery_worker_control',
    'extraction_review_event','entity_resolution_candidate','canonical_entity',
    'entity_relationship','professional_role_candidate','professional_person',
    'contact_point','place_candidate'
  ));

create table if not exists public.discovery_geo_resolution_jobs (
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
create index if not exists discovery_geo_resolution_jobs_claim_idx
  on public.discovery_geo_resolution_jobs(status,available_at,created_at)
  where status in ('queued','running');

create table if not exists public.discovery_place_candidates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  geo_job_id uuid not null,
  extraction_run_id uuid not null,
  extracted_entity_id uuid not null,
  entity_kind text not null check (entity_kind in ('organization','location')),
  place_label text not null check (length(trim(place_label)) between 1 and 300),
  address_components jsonb not null default '{}'::jsonb
    check (jsonb_typeof(address_components)='object' and octet_length(address_components::text)<=8000),
  source_coordinates jsonb
    check (source_coordinates is null or jsonb_typeof(source_coordinates)='object'),
  coordinate_state text not null check (coordinate_state in (
    'source_coordinates','not_supplied','invalid_or_incomplete_source_coordinates'
  )),
  source_coordinate_confidence numeric(4,3)
    check (source_coordinate_confidence is null or source_coordinate_confidence between 0 and 1),
  source_confidence numeric(4,3)
    check (source_confidence is null or source_confidence between 0 and 1),
  confidence_method text,
  address_completeness jsonb not null default '{}'::jsonb
    check (jsonb_typeof(address_completeness)='object'),
  provider text check (provider is null or provider='photon_self_hosted'),
  provider_candidates jsonb not null default '[]'::jsonb
    check (jsonb_typeof(provider_candidates)='array' and jsonb_array_length(provider_candidates)<=5
      and octet_length(provider_candidates::text)<=30000),
  provider_attribution text,
  source_span jsonb not null check (jsonb_typeof(source_span)='object'),
  evidence_id uuid not null,
  candidate_state text not null check (candidate_state in (
    'source_coordinates_available','needs_coordinate_review','address_ready_for_geocoding',
    'geocoder_candidates_pending_review','geocoder_no_match'
  )),
  rationale jsonb not null default '{}'::jsonb
    check (jsonb_typeof(rationale)='object' and octet_length(rationale::text)<=4000),
  review_state text not null default 'pending_review'
    check (review_state in ('pending_review','accepted','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique(company_id,id),
  unique(company_id,extraction_run_id,extracted_entity_id),
  foreign key (company_id,geo_job_id)
    references public.discovery_geo_resolution_jobs(company_id,id) on delete cascade,
  foreign key (company_id,extraction_run_id,extracted_entity_id)
    references public.discovery_extracted_entities(company_id,extraction_run_id,id) on delete cascade
);
create index if not exists discovery_place_candidates_review_idx
  on public.discovery_place_candidates(company_id,review_state,created_at desc);
create index if not exists discovery_place_candidates_entity_idx
  on public.discovery_place_candidates(company_id,extracted_entity_id);

create table if not exists public.discovery_place_resolution_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  candidate_id uuid,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  decision text not null check (decision in ('accepted','rejected')),
  reason text not null check (length(trim(reason)) between 1 and 1000),
  candidate_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(candidate_snapshot)='object'),
  occurred_at timestamptz not null default now(),
  foreign key (candidate_id) references public.discovery_place_candidates(id) on delete set null
);
create index if not exists discovery_place_resolution_events_company_idx
  on public.discovery_place_resolution_events(company_id,occurred_at desc);

alter table public.discovery_geo_resolution_jobs enable row level security;
alter table public.discovery_place_candidates enable row level security;
alter table public.discovery_place_resolution_events enable row level security;
revoke all on public.discovery_geo_resolution_jobs,public.discovery_place_candidates,
  public.discovery_place_resolution_events from public,anon,authenticated;
grant all on public.discovery_geo_resolution_jobs,public.discovery_place_candidates,
  public.discovery_place_resolution_events to service_role;

create or replace function public.enqueue_discovery_geo_resolution_job()
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
      and item.field_name in (
        'address','formatted_address','full_address','address_line','address_line_1','address1',
        'street_address','premise','street','street_name','road','house_number','housenumber',
        'building_number','locality','neighbourhood','neighborhood','suburb','district','county',
        'city','town','municipality','village','state','state_name','province','region',
        'postal_code','postcode','zip','zip_code','country','country_name','country_code','countrycode',
        'latitude','lat','longitude','lon','lng'
      )
  ) then return new; end if;
  insert into public.discovery_geo_resolution_jobs(
    company_id,extraction_run_id,evidence_id,source_id,
    field_schema_snapshot,allowed_fields_snapshot,status
  ) values (
    new.company_id,new.id,new.evidence_id,new.source_id,
    v_source.field_schema,v_source.allowed_fields,'queued'
  ) on conflict(company_id,extraction_run_id) do nothing;
  return new;
end;
$enqueue$;
drop trigger if exists discovery_extraction_enqueue_geo_resolution on public.discovery_extraction_runs;
create trigger discovery_extraction_enqueue_geo_resolution
  after insert on public.discovery_extraction_runs
  for each row execute function public.enqueue_discovery_geo_resolution_job();

create or replace function public.claim_discovery_geo_resolution_job(
  p_worker_id text,p_lease_seconds integer default 90
) returns setof public.discovery_geo_resolution_jobs
language plpgsql security definer
set search_path=public,pg_temp
as $claim$
declare v_job public.discovery_geo_resolution_jobs%rowtype; v_now timestamptz:=clock_timestamp();
begin
  if p_worker_id is null or length(trim(p_worker_id))<1 or length(p_worker_id)>160 then
    raise exception 'E09 worker id is required' using errcode='22023';
  end if;
  if p_lease_seconds<15 or p_lease_seconds>300 then
    raise exception 'E09 lease must be 15 to 300 seconds' using errcode='22023';
  end if;
  update public.discovery_geo_resolution_jobs
    set status='queued',lease_owner=null,lease_expires_at=null,heartbeat_at=null,
      available_at=v_now,updated_at=v_now
    where status='running' and lease_expires_at<=v_now;
  select j.* into v_job
    from public.discovery_geo_resolution_jobs j
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
          and item.field_name in (
            'address','formatted_address','full_address','address_line','address_line_1','address1',
            'street_address','premise','street','street_name','road','house_number','housenumber',
            'building_number','locality','neighbourhood','neighborhood','suburb','district','county',
            'city','town','municipality','village','state','state_name','province','region',
            'postal_code','postcode','zip','zip_code','country','country_name','country_code','countrycode',
            'latitude','lat','longitude','lon','lng'
          )
      )
    order by j.available_at,j.created_at
    for update of j skip locked limit 1;
  if not found then return; end if;
  update public.discovery_geo_resolution_jobs
    set status='running',attempts=attempts+1,lease_owner=p_worker_id,
      lease_expires_at=v_now+make_interval(secs=>p_lease_seconds),
      heartbeat_at=v_now,started_at=coalesce(started_at,v_now),updated_at=v_now
    where id=v_job.id returning * into v_job;
  return next v_job;
end;
$claim$;

create or replace function public.heartbeat_discovery_geo_resolution_job(
  p_job_id uuid,p_worker_id text,p_lease_seconds integer default 90
) returns boolean language plpgsql security definer
set search_path=public,pg_temp
as $heartbeat$
declare v_count integer;
begin
  if p_lease_seconds<15 or p_lease_seconds>300 then
    raise exception 'E09 lease must be 15 to 300 seconds' using errcode='22023';
  end if;
  update public.discovery_geo_resolution_jobs j
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

create or replace function public.complete_discovery_geo_resolution_job(
  p_job_id uuid,p_worker_id text,p_candidates jsonb
) returns integer language plpgsql security definer
set search_path=public,pg_temp
as $complete$
declare
  v_job public.discovery_geo_resolution_jobs%rowtype;
  v_candidate jsonb;
  v_provider jsonb;
  v_source_fact record;
  v_count integer:=0;
  v_lat numeric;
  v_lon numeric;
begin
  if p_candidates is null or jsonb_typeof(p_candidates)<>'array' then
    raise exception 'E09 candidate batch must be a JSON array' using errcode='22023';
  end if;
  if jsonb_array_length(p_candidates)>500 or octet_length(p_candidates::text)>1000000 then
    raise exception 'E09 candidate batch is outside approved bounds' using errcode='22023';
  end if;
  select * into v_job from public.discovery_geo_resolution_jobs
    where id=p_job_id and status='running' and lease_owner=p_worker_id
      and lease_expires_at>clock_timestamp() for update;
  if not found then raise exception 'E09 lease is no longer valid' using errcode='42501'; end if;
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
  ) then raise exception 'E09 source, profile, worker grant or evidence is no longer eligible' using errcode='42501'; end if;

  for v_candidate in select value from jsonb_array_elements(p_candidates)
  loop
    if jsonb_typeof(v_candidate)<>'object'
      or v_candidate->>'entity_kind' not in ('organization','location')
      or length(trim(coalesce(v_candidate->>'place_label','')))=0
      or jsonb_typeof(coalesce(v_candidate->'address','{}'::jsonb))<>'object'
      or jsonb_typeof(coalesce(v_candidate->'source_span','{}'::jsonb))<>'object'
      or jsonb_typeof(coalesce(v_candidate->'provider_candidates','[]'::jsonb))<>'array'
      or jsonb_array_length(coalesce(v_candidate->'provider_candidates','[]'::jsonb))>5
      or v_candidate->>'coordinate_state' not in ('source_coordinates','not_supplied','invalid_or_incomplete_source_coordinates')
      or v_candidate->>'candidate_state' not in (
        'source_coordinates_available','needs_coordinate_review','address_ready_for_geocoding',
        'geocoder_candidates_pending_review','geocoder_no_match'
      )
      or (v_candidate->>'source_confidence') is not null and
        (v_candidate->>'source_confidence')::numeric not between 0 and 1 then
      raise exception 'E09 candidate payload failed schema or bounds validation' using errcode='22023';
    end if;
    if coalesce(v_candidate->>'provider','') not in ('','photon_self_hosted') then
      raise exception 'E09 geocoder provider is not approved' using errcode='22023';
    end if;
    if coalesce(v_candidate->>'provider','')='photon_self_hosted'
      and not exists (
        select 1 from public.discovery_source_registry s
        where s.company_id=v_job.company_id and s.id=v_job.source_id
          and s.status='approved' and 'geocoding'=any(s.allowed_purposes)
      ) then
      raise exception 'E09 Photon use requires an approved source geocoding purpose' using errcode='42501';
    end if;
    if v_candidate->'source_coordinates' is not null
      and jsonb_typeof(v_candidate->'source_coordinates') not in ('null','object') then
      raise exception 'E09 source_coordinates must be an object or null' using errcode='22023';
    end if;
    if jsonb_typeof(v_candidate->'source_coordinates')='object' then
      if v_candidate->>'coordinate_state'<>'source_coordinates' then
        raise exception 'E09 source coordinate state must agree with the source coordinate object' using errcode='22023';
      end if;
      if coalesce(v_candidate->'source_coordinates'->>'latitude','') !~ '^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$'
        or coalesce(v_candidate->'source_coordinates'->>'longitude','') !~ '^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$' then
        raise exception 'E09 source coordinates must be numeric latitude/longitude' using errcode='22023';
      end if;
      v_lat:=(v_candidate->'source_coordinates'->>'latitude')::numeric;
      v_lon:=(v_candidate->'source_coordinates'->>'longitude')::numeric;
      if v_lat < -90 or v_lat > 90 or v_lon < -180 or v_lon > 180 then
        raise exception 'E09 source coordinates are outside geographic bounds' using errcode='22023';
      end if;
    elsif v_candidate->>'coordinate_state'='source_coordinates' then
      raise exception 'E09 source coordinate state requires both coordinates' using errcode='22023';
    end if;
    if coalesce(v_candidate->>'provider','')='photon_self_hosted' then
      for v_provider in select value from jsonb_array_elements(v_candidate->'provider_candidates')
      loop
        if jsonb_typeof(v_provider)<>'object'
          or coalesce(v_provider->>'latitude','') !~ '^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$'
          or coalesce(v_provider->>'longitude','') !~ '^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$'
          or v_provider->>'attribution' not ilike '%OpenStreetMap contributors%' then
          raise exception 'E09 Photon result is missing coordinates or attribution' using errcode='22023';
        end if;
        v_lat:=(v_provider->>'latitude')::numeric;
        v_lon:=(v_provider->>'longitude')::numeric;
        if v_lat < -90 or v_lat > 90 or v_lon < -180 or v_lon > 180 then
          raise exception 'E09 Photon coordinates are outside geographic bounds' using errcode='22023';
        end if;
      end loop;
    elsif jsonb_array_length(coalesce(v_candidate->'provider_candidates','[]'::jsonb))>0 then
      raise exception 'E09 provider candidates require a declared provider' using errcode='22023';
    end if;
    if not exists (
      select 1 from public.discovery_extracted_entities x
      where x.company_id=v_job.company_id and x.extraction_run_id=v_job.extraction_run_id
        and x.id=(v_candidate->>'extracted_entity_id')::uuid
        and x.entity_kind=v_candidate->>'entity_kind'
        and x.entity_kind in ('organization','location')
    ) then raise exception 'E09 place entity does not belong to this extraction run' using errcode='42501'; end if;
    if not exists (
      select 1
      from jsonb_each(coalesce(v_candidate->'source_span'->'fields','{}'::jsonb)) s(field_name,span)
      join public.discovery_extracted_facts f
        on f.company_id=v_job.company_id and f.extraction_run_id=v_job.extraction_run_id
        and f.extracted_entity_id=(v_candidate->>'extracted_entity_id')::uuid
        and f.field_name=s.field_name and f.source_span=s.span and f.validation_status='valid'
      where s.field_name=any(v_job.allowed_fields_snapshot)
        and v_job.field_schema_snapshot ? s.field_name
    ) then raise exception 'E09 place has no valid source-backed allow-listed location fact' using errcode='42501'; end if;

    insert into public.discovery_place_candidates(
      company_id,geo_job_id,extraction_run_id,extracted_entity_id,entity_kind,place_label,
      address_components,source_coordinates,coordinate_state,source_coordinate_confidence,
      source_confidence,confidence_method,address_completeness,provider,provider_candidates,
      provider_attribution,source_span,evidence_id,candidate_state,rationale
    ) values (
      v_job.company_id,v_job.id,v_job.extraction_run_id,
      (v_candidate->>'extracted_entity_id')::uuid,
      v_candidate->>'entity_kind',left(trim(v_candidate->>'place_label'),300),
      coalesce(v_candidate->'address','{}'::jsonb),
      case when jsonb_typeof(v_candidate->'source_coordinates')='object'
        then v_candidate->'source_coordinates' else null end,
      v_candidate->>'coordinate_state',
      nullif(v_candidate->>'source_coordinate_confidence','')::numeric,
      nullif(v_candidate->>'source_confidence','')::numeric,
      nullif(left(v_candidate->>'confidence_method',80),''),
      coalesce(v_candidate->'address_completeness','{}'::jsonb),
      nullif(v_candidate->>'provider',''),
      coalesce(v_candidate->'provider_candidates','[]'::jsonb),
      nullif(left(v_candidate->>'provider_attribution',200),''),
      coalesce(v_candidate->'source_span','{}'::jsonb),
      v_job.evidence_id,v_candidate->>'candidate_state',
      coalesce(v_candidate->'rationale','{}'::jsonb)
    );
    v_count:=v_count+1;
  end loop;

  update public.discovery_geo_resolution_jobs
    set status='succeeded',finished_at=clock_timestamp(),lease_owner=null,
      lease_expires_at=null,heartbeat_at=null,updated_at=clock_timestamp()
    where id=v_job.id;
  return v_count;
end;
$complete$;

create or replace function public.fail_discovery_geo_resolution_job(
  p_job_id uuid,p_worker_id text,p_error_code text,p_error_message text
) returns boolean language plpgsql security definer
set search_path=public,pg_temp
as $fail$
declare v_job public.discovery_geo_resolution_jobs%rowtype;
begin
  select * into v_job from public.discovery_geo_resolution_jobs
    where id=p_job_id and status='running' and lease_owner=p_worker_id
      and lease_expires_at>clock_timestamp() for update;
  if not found then return false; end if;
  update public.discovery_geo_resolution_jobs
    set status=case when attempts>=max_attempts then 'failed' else 'queued' end,
      available_at=clock_timestamp()+make_interval(secs=>least(30*greatest(attempts,1),300)),
      lease_owner=null,lease_expires_at=null,heartbeat_at=null,
      finished_at=case when attempts>=max_attempts then clock_timestamp() else null end,
      last_error_code=left(coalesce(p_error_code,'E09_FAILED'),100),
      last_error_message=left(coalesce(p_error_message,'E09 failed.'),1000),
      updated_at=clock_timestamp()
    where id=v_job.id;
  return true;
end;
$fail$;

create or replace function public.record_discovery_place_review(
  p_company_id uuid,p_actor_user_id uuid,p_candidate_id uuid,
  p_decision text,p_reason text
) returns public.discovery_place_resolution_events
language plpgsql security definer
set search_path=public,pg_temp
as $review$
declare
  v_role text;
  v_candidate public.discovery_place_candidates%rowtype;
  v_event public.discovery_place_resolution_events%rowtype;
begin
  if p_decision not in ('accepted','rejected') then
    raise exception 'Unsupported E09 review decision' using errcode='22023';
  end if;
  if p_reason is null or length(trim(p_reason))<1 or length(p_reason)>1000 then
    raise exception 'E09 review reason is required' using errcode='22023';
  end if;
  select role into v_role from public.company_memberships
    where company_id=p_company_id and user_id=p_actor_user_id for share;
  if v_role is null or v_role not in ('owner','admin') then
    raise exception 'Only a company owner or admin can review place candidates' using errcode='42501';
  end if;
  select * into v_candidate from public.discovery_place_candidates
    where company_id=p_company_id and id=p_candidate_id and review_state='pending_review'
    for update;
  if not found then raise exception 'Pending E09 place candidate was not found in this company' using errcode='P0002'; end if;

  insert into public.discovery_place_resolution_events(
    company_id,candidate_id,actor_user_id,decision,reason,candidate_snapshot
  ) values (
    p_company_id,p_candidate_id,p_actor_user_id,p_decision,trim(p_reason),
    jsonb_build_object(
      'entityKind',v_candidate.entity_kind,
      'candidateState',v_candidate.candidate_state,
      'coordinateState',v_candidate.coordinate_state,
      'provider',v_candidate.provider,
      'providerCandidateCount',jsonb_array_length(v_candidate.provider_candidates),
      'evidenceId',v_candidate.evidence_id
    )
  ) returning * into v_event;

  update public.discovery_place_candidates
    set review_state=p_decision,reviewed_at=clock_timestamp()
    where company_id=p_company_id and id=p_candidate_id;

  insert into public.discovery_audit_events(
    company_id,actor_user_id,action,entity_type,entity_id,details
  ) values (
    p_company_id,p_actor_user_id,'place_resolution_review_recorded','place_candidate',p_candidate_id,
    jsonb_build_object('decision',p_decision,'candidateId',p_candidate_id)
  );
  return v_event;
end;
$review$;

revoke all on function public.claim_discovery_geo_resolution_job(text,integer) from public,anon,authenticated;
revoke all on function public.heartbeat_discovery_geo_resolution_job(uuid,text,integer) from public,anon,authenticated;
revoke all on function public.complete_discovery_geo_resolution_job(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.fail_discovery_geo_resolution_job(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.record_discovery_place_review(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_discovery_geo_resolution_job(text,integer) to service_role;
grant execute on function public.heartbeat_discovery_geo_resolution_job(uuid,text,integer) to service_role;
grant execute on function public.complete_discovery_geo_resolution_job(uuid,text,jsonb) to service_role;
grant execute on function public.fail_discovery_geo_resolution_job(uuid,text,text,text) to service_role;
grant execute on function public.record_discovery_place_review(uuid,uuid,uuid,text,text) to service_role;

comment on table public.discovery_place_candidates is
  'E09 source-backed normalized organization/location places and optional Photon candidates; not ownership/title evidence.';
comment on table public.discovery_place_resolution_events is
  'Owner/admin decisions with minimised snapshots; receipt survives deletion of source-backed candidate at retention expiry.';

commit;
