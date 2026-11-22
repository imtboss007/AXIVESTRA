-- AXIVESTRA E07: restricted professional-role intelligence.
-- Source-backed role mentions only; no contact enrichment, profile scraping or automatic identity merge.
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
    'entity_relationship_review_recorded','professional_role_review_recorded'
  ));
alter table public.discovery_audit_events
  drop constraint if exists discovery_audit_events_entity_type_check;
alter table public.discovery_audit_events
  add constraint discovery_audit_events_entity_type_check check (entity_type in (
    'source','profile','profile_source','discovery_job','discovery_worker_control',
    'extraction_review_event','entity_resolution_candidate','canonical_entity',
    'entity_relationship','professional_role_candidate','professional_person'
  ));

create table if not exists public.discovery_professional_role_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  extraction_run_id uuid not null,
  evidence_id uuid not null,
  source_id uuid not null,
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
create index if not exists discovery_professional_role_jobs_claim_idx
  on public.discovery_professional_role_jobs(status,available_at,created_at)
  where status in ('queued','running');

create table if not exists public.discovery_professional_role_candidates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  role_job_id uuid not null,
  extraction_run_id uuid not null,
  extracted_person_id uuid not null,
  person_name text not null check (length(trim(person_name)) between 1 and 300),
  normalized_person_name text not null check (length(trim(normalized_person_name)) between 1 and 300),
  canonical_entity_id uuid,
  role_title text,
  department text,
  valid_from date,
  valid_to date,
  jurisdiction text,
  evidence_id uuid not null,
  source_span jsonb not null default '{}'::jsonb check (jsonb_typeof(source_span)='object'),
  confidence numeric(4,3) not null default 0 check (confidence between 0 and 1),
  relationship_method text,
  candidate_state text not null default 'insufficient_evidence'
    check (candidate_state in ('pending_review','insufficient_evidence')),
  missing_requirements jsonb not null default '[]'::jsonb
    check (jsonb_typeof(missing_requirements)='array' and octet_length(missing_requirements::text)<=4000),
  rationale jsonb not null default '{}'::jsonb
    check (jsonb_typeof(rationale)='object' and octet_length(rationale::text)<=4000),
  review_state text not null default 'pending_review'
    check (review_state in ('pending_review','created_new','linked_existing','rejected','escalated')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique(company_id,id),
  unique(company_id,extraction_run_id,extracted_person_id),
  foreign key (company_id,role_job_id)
    references public.discovery_professional_role_jobs(company_id,id) on delete cascade,
  foreign key (company_id,canonical_entity_id)
    references public.discovery_canonical_entities(company_id,id) on delete restrict
  -- evidence_id and extracted_person_id are historical UUIDs; raw evidence retention remains independent.
);
create index if not exists discovery_professional_role_candidates_review_idx
  on public.discovery_professional_role_candidates(company_id,review_state,created_at desc);
create index if not exists discovery_professional_role_candidates_entity_idx
  on public.discovery_professional_role_candidates(company_id,canonical_entity_id,role_title);

create table if not exists public.discovery_professional_people (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  full_name text not null check (length(trim(full_name)) between 1 and 300),
  normalized_name text not null check (length(trim(normalized_name)) between 1 and 300),
  public_professional_source boolean not null default true check (public_professional_source=true),
  purpose text not null check (length(trim(purpose)) between 1 and 300),
  source_evidence_id uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'active' check (status in ('active','restricted','rejected')),
  created_at timestamptz not null default now(),
  unique(company_id,id)
  -- source_evidence_id is a historical UUID reference; it does not block evidence retention cleanup.
);

create table if not exists public.discovery_professional_role_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  professional_person_id uuid not null,
  canonical_entity_id uuid not null,
  role_title text not null check (length(trim(role_title)) between 1 and 160),
  department text,
  valid_from date,
  valid_to date,
  source_evidence_id uuid not null,
  source_span jsonb not null default '{}'::jsonb check (jsonb_typeof(source_span)='object'),
  review_event_id uuid not null,
  created_at timestamptz not null default now(),
  unique(company_id,id),
  foreign key (company_id,professional_person_id)
    references public.discovery_professional_people(company_id,id) on delete restrict,
  foreign key (company_id,canonical_entity_id)
    references public.discovery_canonical_entities(company_id,id) on delete restrict
  -- review_event_id and source_evidence_id are historical UUID references.
);
create index if not exists discovery_professional_role_assignments_person_idx
  on public.discovery_professional_role_assignments(company_id,professional_person_id,created_at desc);
create index if not exists discovery_professional_role_assignments_entity_idx
  on public.discovery_professional_role_assignments(company_id,canonical_entity_id,role_title);

create table if not exists public.discovery_professional_role_review_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  candidate_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  decision text not null check (decision in ('created_new','linked_existing','rejected','escalated')),
  professional_person_id uuid,
  reason text not null check (length(trim(reason)) between 1 and 1000),
  occurred_at timestamptz not null default now(),
  unique(company_id,id),
  foreign key (company_id,candidate_id)
    references public.discovery_professional_role_candidates(company_id,id) on delete restrict,
  foreign key (company_id,professional_person_id)
    references public.discovery_professional_people(company_id,id) on delete restrict
);

alter table public.discovery_professional_role_jobs enable row level security;
alter table public.discovery_professional_role_candidates enable row level security;
alter table public.discovery_professional_people enable row level security;
alter table public.discovery_professional_role_assignments enable row level security;
alter table public.discovery_professional_role_review_events enable row level security;
revoke all on public.discovery_professional_role_jobs,public.discovery_professional_role_candidates,
  public.discovery_professional_people,public.discovery_professional_role_assignments,
  public.discovery_professional_role_review_events from public,anon,authenticated;
grant all on public.discovery_professional_role_jobs,public.discovery_professional_role_candidates,
  public.discovery_professional_people,public.discovery_professional_role_assignments,
  public.discovery_professional_role_review_events to service_role;

create or replace function public.enqueue_discovery_professional_role_job()
returns trigger language plpgsql security definer
set search_path=public,pg_temp
as $enqueue$
declare v_run public.discovery_extraction_runs%rowtype;
begin
  select * into v_run from public.discovery_extraction_runs
    where company_id=new.company_id and id=new.extraction_run_id
      and status in ('completed','completed_with_warnings');
  if not found then return new; end if;
  insert into public.discovery_professional_role_jobs(
    company_id,extraction_run_id,evidence_id,source_id,status
  ) values(new.company_id,new.extraction_run_id,v_run.evidence_id,v_run.source_id,'queued')
  on conflict(company_id,extraction_run_id) do nothing;
  return new;
end;
$enqueue$;
drop trigger if exists discovery_entity_assignment_enqueue_professional_roles on public.discovery_entity_assignments;
create trigger discovery_entity_assignment_enqueue_professional_roles
  after insert on public.discovery_entity_assignments
  for each row execute function public.enqueue_discovery_professional_role_job();

create or replace function public.claim_discovery_professional_role_job(
  p_worker_id text,p_lease_seconds integer default 90
) returns setof public.discovery_professional_role_jobs
language plpgsql security definer
set search_path=public,pg_temp
as $claim$
declare v_job public.discovery_professional_role_jobs%rowtype; v_now timestamptz:=clock_timestamp();
begin
  if p_worker_id is null or length(trim(p_worker_id))<8 or length(p_worker_id)>160 then
    raise exception 'Invalid E07 worker identity' using errcode='22023';
  end if;
  if p_lease_seconds<15 or p_lease_seconds>300 then
    raise exception 'E07 lease must be 15 to 300 seconds' using errcode='22023';
  end if;
  update public.discovery_professional_role_jobs
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
    from public.discovery_professional_role_jobs j
    join public.discovery_extraction_runs r
      on r.company_id=j.company_id and r.id=j.extraction_run_id
      and r.status in ('completed','completed_with_warnings')
    join public.discovery_evidence_items e
      on e.company_id=j.company_id and e.id=j.evidence_id
      and e.content_hash=r.source_content_hash
    join public.discovery_source_registry s
      on s.company_id=j.company_id and s.id=j.source_id and s.status='approved'
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
      )
    order by j.available_at,j.created_at
    for update of j skip locked limit 1;
  if not found then return; end if;
  update public.discovery_professional_role_jobs
    set status='running',attempts=attempts+1,lease_owner=p_worker_id,
      lease_expires_at=v_now+make_interval(secs=>p_lease_seconds),
      heartbeat_at=v_now,started_at=coalesce(started_at,v_now),updated_at=v_now
    where id=v_job.id returning * into v_job;
  return next v_job;
end;
$claim$;

create or replace function public.heartbeat_discovery_professional_role_job(
  p_job_id uuid,p_worker_id text,p_lease_seconds integer default 90
) returns boolean language plpgsql security definer
set search_path=public,pg_temp
as $heartbeat$
declare v_count integer;
begin
  if p_lease_seconds<15 or p_lease_seconds>300 then
    raise exception 'E07 lease must be 15 to 300 seconds' using errcode='22023';
  end if;
  update public.discovery_professional_role_jobs j
    set heartbeat_at=clock_timestamp(),
      lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),
      updated_at=clock_timestamp()
    where j.id=p_job_id and j.status='running' and j.lease_owner=p_worker_id
      and j.lease_expires_at>clock_timestamp()
      and exists(select 1 from public.discovery_source_registry s
        where s.company_id=j.company_id and s.id=j.source_id and s.status='approved')
      and exists(select 1 from public.discovery_extraction_runs r
        join public.discovery_evidence_items e on e.company_id=r.company_id and e.id=r.evidence_id
        join public.discovery_jobs dj on dj.company_id=e.company_id and dj.id=e.job_id and dj.status='succeeded'
        join public.discovery_profiles p on p.company_id=dj.company_id and p.id=dj.profile_id and p.enabled=true
        join public.discovery_profile_sources ps on ps.company_id=dj.company_id and ps.profile_id=dj.profile_id and ps.source_id=j.source_id
        where r.company_id=j.company_id and r.id=j.extraction_run_id and e.id=j.evidence_id
          and r.source_content_hash=e.content_hash and r.status in ('completed','completed_with_warnings'));
  get diagnostics v_count=row_count;
  return v_count=1;
end;
$heartbeat$;

create or replace function public.complete_discovery_professional_role_job(
  p_job_id uuid,p_worker_id text,p_candidates jsonb
) returns integer language plpgsql security definer
set search_path=public,pg_temp
as $complete$
declare
  v_job public.discovery_professional_role_jobs%rowtype;
  v_candidate jsonb;
  v_count integer:=0;
begin
  if jsonb_typeof(p_candidates)<>'array' or jsonb_array_length(p_candidates)>500
    or octet_length(p_candidates::text)>500000 then
    raise exception 'E07 candidate batch is outside approved bounds' using errcode='22023';
  end if;
  select * into v_job from public.discovery_professional_role_jobs
    where id=p_job_id and status='running' and lease_owner=p_worker_id
      and lease_expires_at>clock_timestamp() for update;
  if not found then raise exception 'E07 lease is no longer valid' using errcode='42501'; end if;
  if not exists (
    select 1 from public.discovery_extraction_runs r
    join public.discovery_evidence_items e on e.company_id=r.company_id and e.id=r.evidence_id
    join public.discovery_source_registry s on s.company_id=r.company_id and s.id=r.source_id and s.status='approved'
    join public.discovery_jobs dj on dj.company_id=e.company_id and dj.id=e.job_id and dj.status='succeeded'
    join public.discovery_profiles p on p.company_id=dj.company_id and p.id=dj.profile_id and p.enabled=true
    join public.discovery_profile_sources ps on ps.company_id=dj.company_id and ps.profile_id=dj.profile_id and ps.source_id=r.source_id
    where r.company_id=v_job.company_id and r.id=v_job.extraction_run_id
      and r.status in ('completed','completed_with_warnings')
      and r.evidence_id=v_job.evidence_id and r.source_id=v_job.source_id
      and r.source_content_hash=e.content_hash
  ) then raise exception 'E07 source, profile or evidence is no longer eligible' using errcode='42501'; end if;
  for v_candidate in select value from jsonb_array_elements(p_candidates)
  loop
    if jsonb_typeof(v_candidate)<>'object'
      or length(trim(coalesce(v_candidate->>'person_name','')))=0
      or length(trim(coalesce(v_candidate->>'normalized_person_name','')))=0
      or length(coalesce(v_candidate->>'extracted_person_id',''))=0
      or coalesce(v_candidate->>'candidate_state','') not in ('pending_review','insufficient_evidence')
      or jsonb_typeof(coalesce(v_candidate->'source_span','{}'::jsonb))<>'object'
      or jsonb_typeof(coalesce(v_candidate->'missing_requirements','[]'::jsonb))<>'array'
      or jsonb_typeof(coalesce(v_candidate->'rationale','{}'::jsonb))<>'object' then
      raise exception 'E07 candidate payload is invalid' using errcode='22023';
    end if;
    if not exists (
      select 1 from public.discovery_extracted_entities x
      where x.company_id=v_job.company_id and x.extraction_run_id=v_job.extraction_run_id
        and x.id=(v_candidate->>'extracted_person_id')::uuid and x.entity_kind='person'
    ) then raise exception 'E07 person is not a source mention from this extraction run' using errcode='42501'; end if;
    if nullif(v_candidate->>'canonical_entity_id','') is not null and not exists (
      select 1 from public.discovery_entity_assignments a
      join public.discovery_canonical_entities c on c.company_id=a.company_id and c.id=a.canonical_entity_id and c.status='active'
      where a.company_id=v_job.company_id and a.extraction_run_id=v_job.extraction_run_id
        and a.canonical_entity_id=(v_candidate->>'canonical_entity_id')::uuid
    ) then raise exception 'E07 employer link is not an owner-reviewed E06 assignment' using errcode='42501'; end if;
    insert into public.discovery_professional_role_candidates(
      company_id,role_job_id,extraction_run_id,extracted_person_id,person_name,
      normalized_person_name,canonical_entity_id,role_title,department,valid_from,valid_to,
      jurisdiction,evidence_id,source_span,confidence,relationship_method,
      candidate_state,missing_requirements,rationale
    ) values (
      v_job.company_id,v_job.id,v_job.extraction_run_id,
      (v_candidate->>'extracted_person_id')::uuid,
      left(trim(v_candidate->>'person_name'),300),
      left(trim(v_candidate->>'normalized_person_name'),300),
      nullif(v_candidate->>'canonical_entity_id','')::uuid,
      nullif(left(trim(v_candidate->>'role_title'),160),''),
      nullif(left(trim(v_candidate->>'department'),160),''),
      nullif(v_candidate->>'valid_from','')::date,
      nullif(v_candidate->>'valid_to','')::date,
      nullif(left(trim(v_candidate->>'jurisdiction'),80),''),
      v_job.evidence_id,coalesce(v_candidate->'source_span','{}'::jsonb),
      greatest(0,least(1,coalesce((v_candidate->>'confidence')::numeric,0))),
      nullif(left(trim(v_candidate->>'relationship_method'),80),''),
      v_candidate->>'candidate_state',
      coalesce(v_candidate->'missing_requirements','[]'::jsonb),
      coalesce(v_candidate->'rationale','{}'::jsonb)
    );
    v_count:=v_count+1;
  end loop;
  update public.discovery_professional_role_jobs
    set status='succeeded',finished_at=clock_timestamp(),lease_owner=null,
      lease_expires_at=null,heartbeat_at=null,updated_at=clock_timestamp()
    where id=v_job.id;
  return v_count;
end;
$complete$;

create or replace function public.record_discovery_professional_role_review(
  p_company_id uuid,p_actor_user_id uuid,p_candidate_id uuid,
  p_decision text,p_reason text,p_existing_person_id uuid default null,
  p_purpose text default 'professional role verification'
) returns public.discovery_professional_role_review_events
language plpgsql security definer
set search_path=public,pg_temp
as $review$
declare
  v_role text;
  v_candidate public.discovery_professional_role_candidates%rowtype;
  v_person public.discovery_professional_people%rowtype;
  v_event public.discovery_professional_role_review_events%rowtype;
begin
  if p_decision not in ('created_new','linked_existing','rejected','escalated') then
    raise exception 'Unsupported E07 review decision' using errcode='22023';
  end if;
  if p_reason is null or length(trim(p_reason))<1 or length(p_reason)>1000 then
    raise exception 'E07 review reason is required' using errcode='22023';
  end if;
  if p_purpose is null or length(trim(p_purpose))<1 or length(p_purpose)>300 then
    raise exception 'E07 processing purpose is required' using errcode='22023';
  end if;
  select role into v_role from public.company_memberships
    where company_id=p_company_id and user_id=p_actor_user_id for share;
  if v_role is null or v_role not in ('owner','admin') then
    raise exception 'Only a company owner or admin can review professional roles' using errcode='42501';
  end if;
  select * into v_candidate from public.discovery_professional_role_candidates
    where company_id=p_company_id and id=p_candidate_id and review_state='pending_review'
    for update;
  if not found then raise exception 'Pending E07 candidate was not found in this company' using errcode='P0002'; end if;
  if v_candidate.candidate_state<>'pending_review' or v_candidate.canonical_entity_id is null
    or v_candidate.role_title is null or v_candidate.evidence_id is null then
    raise exception 'E07 candidate lacks a source-backed role or reviewed employer link' using errcode='22023';
  end if;
  if p_decision='created_new' then
    insert into public.discovery_professional_people(
      company_id,full_name,normalized_name,public_professional_source,purpose,
      source_evidence_id,created_by,status
    ) values (
      p_company_id,v_candidate.person_name,v_candidate.normalized_person_name,true,
      trim(p_purpose),v_candidate.evidence_id,p_actor_user_id,'active'
    ) returning * into v_person;
  elsif p_decision='linked_existing' then
    if p_existing_person_id is null then raise exception 'Existing professional person ID is required' using errcode='22023'; end if;
    select * into v_person from public.discovery_professional_people
      where company_id=p_company_id and id=p_existing_person_id and status='active' for share;
    if not found then raise exception 'Existing professional person is not active in this company' using errcode='42501'; end if;
  end if;
  insert into public.discovery_professional_role_review_events(
    company_id,candidate_id,actor_user_id,decision,professional_person_id,reason
  ) values (
    p_company_id,p_candidate_id,p_actor_user_id,p_decision,
    case when p_decision in ('created_new','linked_existing') then v_person.id else null end,
    trim(p_reason)
  ) returning * into v_event;
  if p_decision in ('created_new','linked_existing') then
    insert into public.discovery_professional_role_assignments(
      company_id,professional_person_id,canonical_entity_id,role_title,department,
      valid_from,valid_to,source_evidence_id,source_span,review_event_id
    ) values (
      p_company_id,v_person.id,v_candidate.canonical_entity_id,v_candidate.role_title,
      v_candidate.department,v_candidate.valid_from,v_candidate.valid_to,
      v_candidate.evidence_id,v_candidate.source_span,v_event.id
    );
  end if;
  update public.discovery_professional_role_candidates
    set review_state=p_decision,reviewed_at=clock_timestamp()
    where company_id=p_company_id and id=p_candidate_id;
  insert into public.discovery_audit_events(
    company_id,actor_user_id,action,entity_type,entity_id,details
  ) values (
    p_company_id,p_actor_user_id,'professional_role_review_recorded',
    case when p_decision='created_new' then 'professional_person' else 'professional_role_candidate' end,
    case when p_decision='created_new' then v_person.id else p_candidate_id end,
    jsonb_build_object('candidateId',p_candidate_id,'decision',p_decision,
      'professionalPersonId',case when p_decision in ('created_new','linked_existing') then v_person.id else null end)
  );
  return v_event;
end;
$review$;

revoke all on function public.claim_discovery_professional_role_job(text,integer) from public,anon,authenticated;
revoke all on function public.heartbeat_discovery_professional_role_job(uuid,text,integer) from public,anon,authenticated;
revoke all on function public.complete_discovery_professional_role_job(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.record_discovery_professional_role_review(uuid,uuid,uuid,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_discovery_professional_role_job(text,integer) to service_role;
grant execute on function public.heartbeat_discovery_professional_role_job(uuid,text,integer) to service_role;
grant execute on function public.complete_discovery_professional_role_job(uuid,text,jsonb) to service_role;
grant execute on function public.record_discovery_professional_role_review(uuid,uuid,uuid,text,text,uuid,text) to service_role;

comment on table public.discovery_professional_role_candidates is
  'E07 source-backed public professional role candidates; no contact details and no auto-promotion.';
comment on table public.discovery_professional_people is
  'Minimal professional identity records created only after explicit owner/admin review for a stated purpose.';
comment on table public.discovery_professional_role_assignments is
  'Reviewed role-to-company association with source evidence and historical validity dates.';

commit;
