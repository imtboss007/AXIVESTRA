-- AXIVESTRA E07: Public People & Decision-Maker Intelligence.
-- Purpose-limited, source-backed public professional role observations only.
-- No private contact fields, personal identifiers, global person graph or profile scraping.
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
    'entity_relationship_review_recorded','public_person_role_review_recorded'
  ));
alter table public.discovery_audit_events
  drop constraint if exists discovery_audit_events_entity_type_check;
alter table public.discovery_audit_events
  add constraint discovery_audit_events_entity_type_check check (entity_type in (
    'source','profile','profile_source','discovery_job','discovery_worker_control',
    'extraction_review_event','entity_resolution_candidate','canonical_entity',
    'entity_relationship','public_person_role_candidate'
  ));

create table if not exists public.discovery_public_person_role_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  extraction_run_id uuid not null,
  evidence_id uuid not null,
  source_id uuid not null,
  canonical_entity_id uuid not null,
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
  unique(company_id,extraction_run_id,canonical_entity_id),
  foreign key (company_id,extraction_run_id,evidence_id)
    references public.discovery_extraction_runs(company_id,id,evidence_id) on delete cascade,
  foreign key (company_id,source_id)
    references public.discovery_source_registry(company_id,id) on delete restrict,
  foreign key (company_id,canonical_entity_id)
    references public.discovery_canonical_entities(company_id,id) on delete cascade
);
create index if not exists discovery_public_person_role_claim_idx
  on public.discovery_public_person_role_jobs(status,available_at,created_at)
  where status in ('queued','running');

create table if not exists public.discovery_public_person_role_candidates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid not null,
  extraction_run_id uuid not null,
  extracted_person_id uuid not null,
  canonical_entity_id uuid not null,
  source_evidence_id uuid not null,
  person_name text not null check (length(trim(person_name)) between 1 and 250),
  role_title text not null check (length(trim(role_title)) between 1 and 200),
  jurisdiction text,
  association_method text not null
    check (association_method in ('same_source_row','unique_company_run')),
  person_source_span jsonb not null check (
    jsonb_typeof(person_source_span)='object' and octet_length(person_source_span::text)<=8192
  ),
  role_source_span jsonb not null check (
    jsonb_typeof(role_source_span)='object' and octet_length(role_source_span::text)<=8192
  ),
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  rationale jsonb not null default '{}'::jsonb check (
    jsonb_typeof(rationale)='object' and octet_length(rationale::text)<=8192
  ),
  review_state text not null default 'pending_review'
    check (review_state in ('pending_review','accepted','rejected','escalated')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique(company_id,id),
  unique(company_id,extraction_run_id,extracted_person_id,canonical_entity_id,role_title),
  foreign key (company_id,job_id)
    references public.discovery_public_person_role_jobs(company_id,id) on delete cascade,
  foreign key (company_id,extraction_run_id,extracted_person_id)
    references public.discovery_extracted_entities(company_id,extraction_run_id,id) on delete cascade,
  foreign key (company_id,canonical_entity_id)
    references public.discovery_canonical_entities(company_id,id) on delete cascade,
  -- Public role candidates are still personal data: erase them with source evidence retention.
  foreign key (company_id,source_evidence_id)
    references public.discovery_evidence_items(company_id,id) on delete cascade
);
create index if not exists discovery_public_person_role_review_idx
  on public.discovery_public_person_role_candidates(company_id,review_state,created_at desc);
create index if not exists discovery_public_person_role_company_idx
  on public.discovery_public_person_role_candidates(company_id,canonical_entity_id,review_state);

create table if not exists public.discovery_public_person_role_review_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  candidate_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  decision text not null check (decision in ('accepted','rejected','escalated')),
  reason text not null check (length(trim(reason)) between 1 and 1000),
  occurred_at timestamptz not null default now(),
  unique(company_id,id),
  foreign key (company_id,candidate_id)
    references public.discovery_public_person_role_candidates(company_id,id) on delete cascade
);

alter table public.discovery_public_person_role_jobs enable row level security;
alter table public.discovery_public_person_role_candidates enable row level security;
alter table public.discovery_public_person_role_review_events enable row level security;
revoke all on public.discovery_public_person_role_jobs,
  public.discovery_public_person_role_candidates,
  public.discovery_public_person_role_review_events from public,anon,authenticated;
grant all on public.discovery_public_person_role_jobs,
  public.discovery_public_person_role_candidates,
  public.discovery_public_person_role_review_events to service_role;

-- A separate job is queued for every owner-approved company assignment in a run.
create or replace function public.enqueue_discovery_public_person_role_job()
returns trigger language plpgsql security definer
set search_path=public,pg_temp
as $trigger$
declare
  v_run public.discovery_extraction_runs%rowtype;
  v_has_people boolean;
begin
  select * into v_run
    from public.discovery_extraction_runs
    where company_id=new.company_id and id=new.extraction_run_id
      and status in ('completed','completed_with_warnings');
  if not found then return new; end if;

  select exists (
    select 1 from public.discovery_extracted_entities x
    where x.company_id=new.company_id and x.extraction_run_id=new.extraction_run_id
      and x.entity_kind='person'
  ) into v_has_people;
  if not v_has_people then return new; end if;

  insert into public.discovery_public_person_role_jobs(
    company_id,extraction_run_id,evidence_id,source_id,canonical_entity_id,status
  ) values (
    new.company_id,new.extraction_run_id,v_run.evidence_id,v_run.source_id,
    new.canonical_entity_id,'queued'
  ) on conflict(company_id,extraction_run_id,canonical_entity_id) do nothing;
  return new;
end;
$trigger$;
drop trigger if exists discovery_entity_assignment_enqueue_public_roles on public.discovery_entity_assignments;
create trigger discovery_entity_assignment_enqueue_public_roles
  after insert on public.discovery_entity_assignments
  for each row execute function public.enqueue_discovery_public_person_role_job();

create or replace function public.claim_discovery_public_person_role_job(
  p_worker_id text,p_lease_seconds integer default 90
) returns setof public.discovery_public_person_role_jobs
language plpgsql security definer
set search_path=public,pg_temp
as $claim$
declare v_job public.discovery_public_person_role_jobs%rowtype; v_now timestamptz:=clock_timestamp();
begin
  if p_worker_id is null or length(trim(p_worker_id))<8 or length(p_worker_id)>160 then
    raise exception 'Invalid E07 worker identity' using errcode='22023';
  end if;
  if p_lease_seconds<15 or p_lease_seconds>300 then
    raise exception 'E07 lease must be 15 to 300 seconds' using errcode='22023';
  end if;

  update public.discovery_public_person_role_jobs
    set status=case when attempts>=max_attempts then 'failed' else 'queued' end,
      lease_owner=null,lease_expires_at=null,heartbeat_at=null,
      finished_at=case when attempts>=max_attempts then v_now else null end,
      available_at=case when attempts>=max_attempts then available_at
        else v_now+make_interval(secs=>least(30*greatest(attempts,1),300)) end,
      last_error_code=coalesce(last_error_code,'E07_LEASE_EXPIRED'),
      last_error_message=coalesce(last_error_message,'Previous E07 lease expired.'),
      updated_at=v_now
    where status='running' and lease_expires_at<=v_now;

  select j.* into v_job
    from public.discovery_public_person_role_jobs j
    join public.discovery_extraction_runs r
      on r.company_id=j.company_id and r.id=j.extraction_run_id
      and r.status in ('completed','completed_with_warnings')
    join public.discovery_evidence_items e
      on e.company_id=j.company_id and e.id=j.evidence_id
      and e.source_id=j.source_id and e.content_hash=r.source_content_hash
    join public.discovery_source_registry s
      on s.company_id=j.company_id and s.id=j.source_id and s.status='approved'
    join public.discovery_canonical_entities c
      on c.company_id=j.company_id and c.id=j.canonical_entity_id and c.status='active'
    join public.discovery_jobs dj
      on dj.company_id=e.company_id and dj.id=e.job_id and dj.status='succeeded'
    join public.discovery_profiles p
      on p.company_id=dj.company_id and p.id=dj.profile_id and p.enabled=true
    join public.discovery_profile_sources ps
      on ps.company_id=dj.company_id and ps.profile_id=dj.profile_id and ps.source_id=j.source_id
    where j.status='queued' and j.available_at<=v_now and j.attempts<j.max_attempts
      and exists (
        select 1 from public.discovery_entity_assignments a
        where a.company_id=j.company_id and a.extraction_run_id=j.extraction_run_id
          and a.canonical_entity_id=j.canonical_entity_id
      )
    order by j.available_at,j.created_at
    for update of j skip locked limit 1;
  if not found then return; end if;

  update public.discovery_public_person_role_jobs
    set status='running',attempts=attempts+1,lease_owner=p_worker_id,
      lease_expires_at=v_now+make_interval(secs=>p_lease_seconds),
      heartbeat_at=v_now,started_at=coalesce(started_at,v_now),updated_at=v_now
    where id=v_job.id returning * into v_job;
  return next v_job;
end;
$claim$;

create or replace function public.heartbeat_discovery_public_person_role_job(
  p_job_id uuid,p_worker_id text,p_lease_seconds integer default 90
) returns boolean
language plpgsql security definer
set search_path=public,pg_temp
as $heartbeat$
declare v_updated integer;
begin
  if p_lease_seconds<15 or p_lease_seconds>300 then
    raise exception 'E07 lease must be 15 to 300 seconds' using errcode='22023';
  end if;
  update public.discovery_public_person_role_jobs j
    set heartbeat_at=clock_timestamp(),
      lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),
      updated_at=clock_timestamp()
    where j.id=p_job_id and j.status='running' and j.lease_owner=p_worker_id
      and j.lease_expires_at>clock_timestamp()
      and exists (
        select 1 from public.discovery_source_registry s
        where s.company_id=j.company_id and s.id=j.source_id and s.status='approved'
      )
      and exists (
        select 1 from public.discovery_entity_assignments a
        join public.discovery_evidence_items e on e.company_id=j.company_id and e.id=j.evidence_id
        join public.discovery_extraction_runs r on r.company_id=j.company_id and r.id=j.extraction_run_id
          and r.status in ('completed','completed_with_warnings') and r.source_content_hash=e.content_hash
        join public.discovery_canonical_entities c on c.company_id=j.company_id and c.id=j.canonical_entity_id and c.status='active'
        where a.company_id=j.company_id and a.extraction_run_id=j.extraction_run_id
          and a.canonical_entity_id=j.canonical_entity_id
      );
  get diagnostics v_updated=row_count;
  return v_updated=1;
end;
$heartbeat$;

create or replace function public.complete_discovery_public_person_roles(
  p_job_id uuid,p_worker_id text,p_candidates jsonb
) returns integer
language plpgsql security definer
set search_path=public,pg_temp
as $complete$
declare
  v_job public.discovery_public_person_role_jobs%rowtype;
  v_run public.discovery_extraction_runs%rowtype;
  v_evidence public.discovery_evidence_items%rowtype;
  v_source public.discovery_source_registry%rowtype;
  v_candidate jsonb;
  v_count integer:=0;
  v_person_id uuid;
  v_canonical_id uuid;
begin
  if jsonb_typeof(p_candidates)<>'array' or jsonb_array_length(p_candidates)>500
    or octet_length(p_candidates::text)>500000 then
    raise exception 'E07 candidate batch is outside approved bounds' using errcode='22023';
  end if;
  select * into v_job from public.discovery_public_person_role_jobs
    where id=p_job_id and status='running' and lease_owner=p_worker_id
      and lease_expires_at>clock_timestamp() for update;
  if not found then raise exception 'E07 lease is no longer valid' using errcode='42501'; end if;

  select * into v_run from public.discovery_extraction_runs
    where company_id=v_job.company_id and id=v_job.extraction_run_id
      and status in ('completed','completed_with_warnings') for share;
  if not found then raise exception 'E05 extraction run is not complete' using errcode='42501'; end if;
  select * into v_evidence from public.discovery_evidence_items
    where company_id=v_job.company_id and id=v_job.evidence_id for share;
  if not found or v_evidence.content_hash<>v_run.source_content_hash
    or v_evidence.source_id<>v_job.source_id then
    raise exception 'E07 source evidence does not match the immutable E05 snapshot' using errcode='42501';
  end if;
  select * into v_source from public.discovery_source_registry
    where company_id=v_job.company_id and id=v_job.source_id and status='approved' for share;
  if not found then raise exception 'E07 source approval has been revoked' using errcode='42501'; end if;
  if not exists (
    select 1 from public.discovery_entity_assignments a
    join public.discovery_canonical_entities c
      on c.company_id=a.company_id and c.id=a.canonical_entity_id and c.status='active'
    where a.company_id=v_job.company_id and a.extraction_run_id=v_job.extraction_run_id
      and a.canonical_entity_id=v_job.canonical_entity_id
  ) then raise exception 'E07 company identity assignment is no longer active' using errcode='42501'; end if;
  if not exists (
    select 1 from public.discovery_jobs dj
    join public.discovery_profiles p on p.company_id=dj.company_id and p.id=dj.profile_id and p.enabled=true
    join public.discovery_profile_sources ps on ps.company_id=dj.company_id and ps.profile_id=dj.profile_id and ps.source_id=v_job.source_id
    where dj.company_id=v_job.company_id and dj.id=v_evidence.job_id and dj.status='succeeded'
  ) then raise exception 'E07 parent discovery job or profile is no longer eligible' using errcode='42501'; end if;

  for v_candidate in select value from jsonb_array_elements(p_candidates)
  loop
    if jsonb_typeof(v_candidate)<>'object'
      or not (v_candidate ?& array[
        'extracted_person_id','canonical_entity_id','person_name','role_title',
        'person_source_span','role_source_span','association_method','confidence'
      ])
      or (v_candidate - array[
        'extracted_person_id','canonical_entity_id','person_name','role_title',
        'jurisdiction','person_source_span','role_source_span','association_method',
        'confidence','rationale'
      ]) <> '{}'::jsonb
      or length(trim(coalesce(v_candidate->>'person_name',''))) not between 1 and 250
      or length(trim(coalesce(v_candidate->>'role_title',''))) not between 1 and 200
      or nullif(v_candidate->>'canonical_entity_id','') is null
      or (v_candidate->>'canonical_entity_id')::uuid<>v_job.canonical_entity_id
      or coalesce(v_candidate->>'association_method','') not in ('same_source_row','unique_company_run')
      or jsonb_typeof(v_candidate->'person_source_span')<>'object'
      or jsonb_typeof(v_candidate->'role_source_span')<>'object'
      or octet_length(v_candidate->'person_source_span'::text)>8192
      or octet_length(v_candidate->'role_source_span'::text)>8192
      or jsonb_typeof(v_candidate->'confidence')<>'number'
      or (v_candidate->>'confidence')::numeric<0 or (v_candidate->>'confidence')::numeric>1
      or jsonb_typeof(coalesce(v_candidate->'rationale','{}'::jsonb))<>'object' then
      raise exception 'E07 candidate payload is invalid or contains an unapproved data field' using errcode='22023';
    end if;
    v_person_id := (v_candidate->>'extracted_person_id')::uuid;
    v_canonical_id := (v_candidate->>'canonical_entity_id')::uuid;

    if not exists (
      select 1 from public.discovery_extracted_entities x
      where x.company_id=v_job.company_id and x.extraction_run_id=v_job.extraction_run_id
        and x.id=v_person_id and x.entity_kind='person'
        and coalesce(x.raw_name,x.normalized_name)=v_candidate->>'person_name'
        and x.source_span=v_candidate->'person_source_span'
    ) then
      raise exception 'E07 candidate must preserve the exact source-backed person mention name and locator' using errcode='42501';
    end if;
    if not exists (
      select 1 from public.discovery_extracted_facts f
      where f.company_id=v_job.company_id and f.extraction_run_id=v_job.extraction_run_id
        and f.validation_status='valid'
        and f.field_name=any(array[
          'role','role_title','professional_role','designation','designation_in_company',
          'position','position_title','office','job_title','board_position',
          'director_designation','officer_title','public_office'
        ])
        and coalesce(f.normalized_value #>> '{}',f.raw_value)=v_candidate->>'role_title'
        and f.source_span=v_candidate->'role_source_span'
    ) then
      raise exception 'E07 role title must match an approved source-backed role field and locator' using errcode='42501';
    end if;
    if not exists (
      select 1 from public.discovery_entity_assignments a
      where a.company_id=v_job.company_id and a.extraction_run_id=v_job.extraction_run_id
        and a.canonical_entity_id=v_canonical_id
    ) then
      raise exception 'E07 person role must link to an owner-approved company assignment' using errcode='42501';
    end if;

    if v_candidate->>'association_method'='unique_company_run'
      and (select count(distinct a.canonical_entity_id)
        from public.discovery_entity_assignments a
        where a.company_id=v_job.company_id and a.extraction_run_id=v_job.extraction_run_id)<>1 then
      raise exception 'E07 unique-company association is not valid for a multi-company extraction run' using errcode='42501';
    end if;

    if v_candidate->>'association_method'='same_source_row' and not exists (
      select 1
      from public.discovery_entity_assignments a
      join public.discovery_extracted_entities company_mention
        on company_mention.company_id=a.company_id
        and company_mention.extraction_run_id=a.extraction_run_id
        and company_mention.id=a.extracted_entity_id
      where a.company_id=v_job.company_id
        and a.extraction_run_id=v_job.extraction_run_id
        and a.canonical_entity_id=v_canonical_id
        and (
          (
            v_candidate->'person_source_span'->>'kind'='html-table-cell'
            and v_candidate->'role_source_span'->>'kind'='html-table-cell'
            and company_mention.source_span->>'kind'='html-table-cell'
            and split_part(v_candidate->'person_source_span'->>'locator',' ',1)||' '||
              split_part(v_candidate->'person_source_span'->>'locator',' ',2)=
              split_part(v_candidate->'role_source_span'->>'locator',' ',1)||' '||
              split_part(v_candidate->'role_source_span'->>'locator',' ',2)
            and split_part(v_candidate->'person_source_span'->>'locator',' ',1)||' '||
              split_part(v_candidate->'person_source_span'->>'locator',' ',2)=
              split_part(company_mention.source_span->>'locator',' ',1)||' '||
              split_part(company_mention.source_span->>'locator',' ',2)
          )
          or (
            v_candidate->'person_source_span'->>'kind'='csv-cell'
            and v_candidate->'role_source_span'->>'kind'='csv-cell'
            and company_mention.source_span->>'kind'='csv-cell'
            and v_candidate->'person_source_span'->>'row'=v_candidate->'role_source_span'->>'row'
            and v_candidate->'person_source_span'->>'row'=company_mention.source_span->>'row'
          )
          or (
            v_candidate->'person_source_span'->>'kind'='json-pointer'
            and v_candidate->'role_source_span'->>'kind'='json-pointer'
            and company_mention.source_span->>'kind'='json-pointer'
            and split_part(v_candidate->'person_source_span'->>'locator','/',1)||'/'||
              split_part(v_candidate->'person_source_span'->>'locator','/',2)||'/'||
              split_part(v_candidate->'person_source_span'->>'locator','/',3)=
              split_part(v_candidate->'role_source_span'->>'locator','/',1)||'/'||
              split_part(v_candidate->'role_source_span'->>'locator','/',2)||'/'||
              split_part(v_candidate->'role_source_span'->>'locator','/',3)
            and split_part(v_candidate->'person_source_span'->>'locator','/',3) ~ '^[0-9]+$'
            and split_part(v_candidate->'person_source_span'->>'locator','/',1)||'/'||
              split_part(v_candidate->'person_source_span'->>'locator','/',2)||'/'||
              split_part(v_candidate->'person_source_span'->>'locator','/',3)=
              split_part(company_mention.source_span->>'locator','/',1)||'/'||
              split_part(company_mention.source_span->>'locator','/',2)||'/'||
              split_part(company_mention.source_span->>'locator','/',3)
          )
        )
    ) then
      raise exception 'E07 same-row association must be supported by a shared source-record locator' using errcode='42501';
    end if;

    insert into public.discovery_public_person_role_candidates(
      company_id,job_id,extraction_run_id,extracted_person_id,canonical_entity_id,
      source_evidence_id,person_name,role_title,jurisdiction,association_method,
      person_source_span,role_source_span,confidence,rationale
    ) values (
      v_job.company_id,v_job.id,v_job.extraction_run_id,v_person_id,v_canonical_id,
      v_job.evidence_id,left(trim(v_candidate->>'person_name'),250),
      left(trim(v_candidate->>'role_title'),200),
      nullif(left(trim(coalesce(v_candidate->>'jurisdiction','')),80),''),
      v_candidate->>'association_method',
      v_candidate->'person_source_span',v_candidate->'role_source_span',
      (v_candidate->>'confidence')::numeric,
      coalesce(v_candidate->'rationale','{}'::jsonb)
    ) on conflict(company_id,extraction_run_id,extracted_person_id,canonical_entity_id,role_title)
      do nothing;
    v_count:=v_count+1;
  end loop;

  update public.discovery_public_person_role_jobs
    set status='succeeded',finished_at=clock_timestamp(),lease_owner=null,
      lease_expires_at=null,heartbeat_at=null,updated_at=clock_timestamp()
    where id=v_job.id;
  return v_count;
end;
$complete$;

create or replace function public.fail_discovery_public_person_role_job(
  p_job_id uuid,p_worker_id text,p_error_code text,p_error_message text
) returns boolean
language plpgsql security definer
set search_path=public,pg_temp
as $fail$
declare v_job public.discovery_public_person_role_jobs%rowtype;
begin
  select * into v_job from public.discovery_public_person_role_jobs
    where id=p_job_id and status='running' and lease_owner=p_worker_id
      and lease_expires_at>clock_timestamp() for update;
  if not found then return false; end if;
  update public.discovery_public_person_role_jobs
    set status=case when attempts>=max_attempts then 'failed' else 'queued' end,
      available_at=clock_timestamp()+make_interval(secs=>least(30*greatest(attempts,1),300)),
      lease_owner=null,lease_expires_at=null,heartbeat_at=null,
      finished_at=case when attempts>=max_attempts then clock_timestamp() else null end,
      last_error_code=left(coalesce(p_error_code,'E07_FAILED'),100),
      last_error_message=left(coalesce(p_error_message,'E07 failed.'),1000),
      updated_at=clock_timestamp()
    where id=v_job.id;
  return true;
end;
$fail$;

create or replace function public.record_discovery_public_person_role_review(
  p_company_id uuid,p_actor_user_id uuid,p_candidate_id uuid,p_decision text,p_reason text
) returns public.discovery_public_person_role_review_events
language plpgsql security definer
set search_path=public,pg_temp
as $review$
declare
  v_role text;
  v_candidate public.discovery_public_person_role_candidates%rowtype;
  v_event public.discovery_public_person_role_review_events%rowtype;
begin
  if p_company_id is null or p_actor_user_id is null or p_candidate_id is null then
    raise exception 'Company, reviewer and candidate are required' using errcode='22023';
  end if;
  if p_decision is null or p_decision not in ('accepted','rejected','escalated') then
    raise exception 'Unsupported public person role review decision' using errcode='22023';
  end if;
  if p_reason is null or length(trim(p_reason))<1 or length(p_reason)>1000 then
    raise exception 'E07 review reason is required and must not exceed 1000 characters' using errcode='22023';
  end if;
  select role into v_role from public.company_memberships
    where company_id=p_company_id and user_id=p_actor_user_id for share;
  if v_role is null or v_role not in ('owner','admin') then
    raise exception 'Only a company owner or admin can review public person roles' using errcode='42501';
  end if;
  select * into v_candidate from public.discovery_public_person_role_candidates
    where company_id=p_company_id and id=p_candidate_id and review_state='pending_review'
    for update;
  if not found then raise exception 'Pending public person role candidate was not found in this company' using errcode='P0002'; end if;
  if not exists (
    select 1 from public.discovery_evidence_items
    where company_id=p_company_id and id=v_candidate.source_evidence_id
  ) then raise exception 'Source evidence has expired; this public person role can no longer be reviewed' using errcode='P0002'; end if;

  insert into public.discovery_public_person_role_review_events(
    company_id,candidate_id,actor_user_id,decision,reason
  ) values(p_company_id,p_candidate_id,p_actor_user_id,p_decision,trim(p_reason))
  returning * into v_event;

  update public.discovery_public_person_role_candidates
    set review_state=p_decision,reviewed_at=clock_timestamp()
    where company_id=p_company_id and id=p_candidate_id;

  insert into public.discovery_audit_events(
    company_id,actor_user_id,action,entity_type,entity_id,details
  ) values(
    p_company_id,p_actor_user_id,'public_person_role_review_recorded',
    'public_person_role_candidate',p_candidate_id,
    jsonb_build_object('decision',p_decision,'canonicalEntityId',v_candidate.canonical_entity_id,
      'extractedPersonId',v_candidate.extracted_person_id)
  );
  return v_event;
end;
$review$;

revoke all on function public.claim_discovery_public_person_role_job(text,integer) from public,anon,authenticated;
revoke all on function public.heartbeat_discovery_public_person_role_job(uuid,text,integer) from public,anon,authenticated;
revoke all on function public.complete_discovery_public_person_roles(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.fail_discovery_public_person_role_job(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.record_discovery_public_person_role_review(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_discovery_public_person_role_job(text,integer) to service_role;
grant execute on function public.heartbeat_discovery_public_person_role_job(uuid,text,integer) to service_role;
grant execute on function public.complete_discovery_public_person_roles(uuid,text,jsonb) to service_role;
grant execute on function public.fail_discovery_public_person_role_job(uuid,text,text,text) to service_role;
grant execute on function public.record_discovery_public_person_role_review(uuid,uuid,uuid,text,text) to service_role;

comment on table public.discovery_public_person_role_candidates is
  'Source-backed public professional role candidates linked to one owner-approved company. No personal contact details or global canonical person profiles are stored. Candidate and review rows expire with raw source evidence under the approved retention period.';
comment on table public.discovery_public_person_role_review_events is
  'Append-only owner/admin decisions for E07 public role candidates; rows cascade when source evidence expires.';

commit;