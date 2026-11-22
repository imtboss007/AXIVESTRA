-- AXIVESTRA E06: Company & Entity Intelligence.
-- Canonical entities are only created/linked after explicit owner/admin review.
-- E06 is deterministic, company-scoped, evidence-bound and performs no network calls.
begin;

alter table public.discovery_audit_events
  drop constraint if exists discovery_audit_events_action_check;
alter table public.discovery_audit_events
  add constraint discovery_audit_events_action_check check (action in (
    'source_registered','source_approved','source_paused','source_rejected',
    'profile_created','profile_updated','profile_enabled','profile_disabled',
    'profile_source_attached','profile_source_detached',
    'discovery_job_queued','discovery_worker_grant_enabled','discovery_worker_grant_disabled',
    'extraction_review_recorded','entity_resolution_review_recorded'
  ));
alter table public.discovery_audit_events
  drop constraint if exists discovery_audit_events_entity_type_check;
alter table public.discovery_audit_events
  add constraint discovery_audit_events_entity_type_check check (entity_type in (
    'source','profile','profile_source','discovery_job','discovery_worker_control',
    'extraction_review_event','entity_resolution_candidate','canonical_entity'
  ));

create table if not exists public.discovery_canonical_entities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  entity_kind text not null default 'organization' check (entity_kind = 'organization'),
  legal_name text not null check (length(trim(legal_name)) between 1 and 1000),
  normalized_name text not null check (length(trim(normalized_name)) between 1 and 1000),
  jurisdiction text not null check (length(trim(jurisdiction)) between 2 and 80),
  entity_type text not null default 'unknown'
    check (entity_type in ('company','partnership','llp','fund','bank','nbfc','government_body','nonprofit','other','unknown')),
  status text not null default 'active' check (status in ('active','merged','rejected')),
  source_evidence_id uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(company_id,id)
  -- source_evidence_id is an immutable historical UUID reference, not a retention-blocking FK.
);
create index if not exists discovery_canonical_entities_name_idx
  on public.discovery_canonical_entities(company_id,jurisdiction,normalized_name);
create index if not exists discovery_canonical_entities_status_idx
  on public.discovery_canonical_entities(company_id,status,created_at desc);

create table if not exists public.discovery_entity_identifiers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  canonical_entity_id uuid not null,
  scheme text not null check (scheme ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  jurisdiction text not null check (length(trim(jurisdiction)) between 2 and 80),
  normalized_value text not null check (length(trim(normalized_value)) between 4 and 128),
  raw_value text not null check (length(trim(raw_value)) between 1 and 1000),
  field_name text not null check (length(trim(field_name)) between 1 and 128),
  source_evidence_id uuid not null,
  source_span jsonb not null default '{}'::jsonb check (jsonb_typeof(source_span)='object'),
  review_state text not null default 'owner_accepted'
    check (review_state in ('owner_accepted','needs_verification','rejected')),
  created_at timestamptz not null default now(),
  unique(company_id,id),
  foreign key (company_id,canonical_entity_id)
    references public.discovery_canonical_entities(company_id,id) on delete cascade
  -- source_evidence_id intentionally remains an immutable historical UUID reference.
);
create unique index if not exists discovery_entity_identifiers_accepted_unique
  on public.discovery_entity_identifiers(company_id,scheme,jurisdiction,normalized_value)
  where review_state='owner_accepted';
create index if not exists discovery_entity_identifiers_entity_idx
  on public.discovery_entity_identifiers(company_id,canonical_entity_id);

create table if not exists public.discovery_entity_aliases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  canonical_entity_id uuid not null,
  alias text not null check (length(trim(alias)) between 1 and 1000),
  normalized_alias text not null check (length(trim(normalized_alias)) between 1 and 1000),
  alias_type text not null default 'source_observed'
    check (alias_type in ('registered_name','trading_name','previous_name','branch_name','source_observed')),
  source_evidence_id uuid not null,
  source_span jsonb not null default '{}'::jsonb check (jsonb_typeof(source_span)='object'),
  review_state text not null default 'owner_accepted'
    check (review_state in ('owner_accepted','needs_verification','rejected')),
  created_at timestamptz not null default now(),
  unique(company_id,id),
  foreign key (company_id,canonical_entity_id)
    references public.discovery_canonical_entities(company_id,id) on delete cascade
  -- source_evidence_id intentionally remains an immutable historical UUID reference.
);
create index if not exists discovery_entity_aliases_lookup_idx
  on public.discovery_entity_aliases(company_id,normalized_alias)
  where review_state='owner_accepted';

create table if not exists public.discovery_entity_resolution_jobs (
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
create index if not exists discovery_entity_resolution_claim_idx
  on public.discovery_entity_resolution_jobs(status,available_at,created_at)
  where status in ('queued','running');

create table if not exists public.discovery_entity_match_candidates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  resolution_job_id uuid not null,
  extraction_run_id uuid not null,
  extracted_entity_id uuid not null,
  matched_entity_id uuid,
  match_type text not null check (match_type in (
    'exact_identifier','exact_legal_name','exact_alias','name_similarity',
    'ambiguous_identifier','ambiguous_name','ambiguous_name_similarity',
    'new_entity_proposal','insufficient_identity_data'
  )),
  proposed_name text not null check (length(trim(proposed_name)) between 1 and 1000),
  normalized_name text not null check (length(trim(normalized_name)) between 1 and 1000),
  jurisdiction text,
  identifier_proposals jsonb not null default '[]'::jsonb
    check (jsonb_typeof(identifier_proposals)='array' and octet_length(identifier_proposals::text)<=12000),
  match_score numeric(4,3) not null check (match_score between 0 and 1),
  rationale jsonb not null default '{}'::jsonb
    check (jsonb_typeof(rationale)='object' and octet_length(rationale::text)<=12000),
  review_state text not null default 'pending_review'
    check (review_state in ('pending_review','linked_existing','created_new','rejected','escalated')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique(company_id,id),
  unique(company_id,extraction_run_id,extracted_entity_id),
  foreign key (company_id,resolution_job_id)
    references public.discovery_entity_resolution_jobs(company_id,id) on delete cascade,
  foreign key (company_id,extraction_run_id,extracted_entity_id)
    references public.discovery_extracted_entities(company_id,extraction_run_id,id) on delete cascade,
  foreign key (company_id,matched_entity_id)
    references public.discovery_canonical_entities(company_id,id) on delete restrict
);
create index if not exists discovery_entity_match_review_idx
  on public.discovery_entity_match_candidates(company_id,review_state,created_at desc);
create index if not exists discovery_entity_match_type_idx
  on public.discovery_entity_match_candidates(company_id,match_type,match_score desc);

create table if not exists public.discovery_entity_review_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  candidate_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  decision text not null check (decision in ('linked_existing','created_new','rejected','escalated')),
  canonical_entity_id uuid,
  reason text not null check (length(trim(reason)) between 1 and 1000),
  occurred_at timestamptz not null default now(),
  unique(company_id,id),
  -- candidate_id remains a historical reference after E05 evidence retention.
  foreign key (company_id,canonical_entity_id)
    references public.discovery_canonical_entities(company_id,id) on delete restrict
);

create table if not exists public.discovery_entity_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  extraction_run_id uuid not null,
  extracted_entity_id uuid not null,
  canonical_entity_id uuid not null,
  source_evidence_id uuid not null,
  review_event_id uuid not null,
  assigned_at timestamptz not null default now(),
  unique(company_id,id),
  unique(company_id,extraction_run_id,extracted_entity_id),
  -- extraction_run_id, extracted_entity_id and source_evidence_id are historical
  -- provenance references. Keep accepted assignments after E05 evidence purge.
  foreign key (company_id,canonical_entity_id)
    references public.discovery_canonical_entities(company_id,id) on delete restrict,
  foreign key (company_id,review_event_id)
    references public.discovery_entity_review_events(company_id,id) on delete restrict
);

create table if not exists public.discovery_entity_relationships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  from_entity_id uuid not null,
  to_entity_id uuid not null,
  relationship_type text not null check (relationship_type in (
    'parent','subsidiary','holding_company','branch_of','affiliate','joint_venture','successor','other'
  )),
  evidence_id uuid not null,
  source_span jsonb not null default '{}'::jsonb check (jsonb_typeof(source_span)='object'),
  review_state text not null default 'needs_verification'
    check (review_state in ('needs_verification','owner_accepted','rejected')),
  created_at timestamptz not null default now(),
  check (from_entity_id <> to_entity_id),
  unique(company_id,id),
  foreign key (company_id,from_entity_id)
    references public.discovery_canonical_entities(company_id,id) on delete cascade,
  foreign key (company_id,to_entity_id)
    references public.discovery_canonical_entities(company_id,id) on delete cascade
  -- evidence_id is retained as an immutable historical UUID reference.
);
create index if not exists discovery_entity_relationships_from_idx
  on public.discovery_entity_relationships(company_id,from_entity_id);
create index if not exists discovery_entity_relationships_to_idx
  on public.discovery_entity_relationships(company_id,to_entity_id);

alter table public.discovery_entity_resolution_jobs enable row level security;
alter table public.discovery_canonical_entities enable row level security;
alter table public.discovery_entity_identifiers enable row level security;
alter table public.discovery_entity_aliases enable row level security;
alter table public.discovery_entity_match_candidates enable row level security;
alter table public.discovery_entity_review_events enable row level security;
alter table public.discovery_entity_assignments enable row level security;
alter table public.discovery_entity_relationships enable row level security;

revoke all on public.discovery_entity_resolution_jobs,public.discovery_canonical_entities,
  public.discovery_entity_identifiers,public.discovery_entity_aliases,
  public.discovery_entity_match_candidates,public.discovery_entity_review_events,
  public.discovery_entity_assignments,public.discovery_entity_relationships
  from public,anon,authenticated;
grant all on public.discovery_entity_resolution_jobs,public.discovery_canonical_entities,
  public.discovery_entity_identifiers,public.discovery_entity_aliases,
  public.discovery_entity_match_candidates,public.discovery_entity_review_events,
  public.discovery_entity_assignments,public.discovery_entity_relationships
  to service_role;

create or replace function public.enqueue_discovery_entity_resolution_job()
returns trigger language plpgsql security definer
set search_path = public,pg_temp
as $trigger$
begin
  if new.status in ('completed','completed_with_warnings') and new.extracted_entity_count>0 then
    insert into public.discovery_entity_resolution_jobs(
      company_id,extraction_run_id,evidence_id,source_id,status
    ) values(new.company_id,new.id,new.evidence_id,new.source_id,'queued')
    on conflict(company_id,extraction_run_id) do nothing;
  end if;
  return new;
end;
$trigger$;
drop trigger if exists discovery_extraction_enqueue_entity_resolution on public.discovery_extraction_runs;
create trigger discovery_extraction_enqueue_entity_resolution
  after insert on public.discovery_extraction_runs
  for each row execute function public.enqueue_discovery_entity_resolution_job();

create or replace function public.claim_discovery_entity_resolution_job(
  p_worker_id text,p_lease_seconds integer default 90
) returns setof public.discovery_entity_resolution_jobs
language plpgsql security definer
set search_path=public,pg_temp
as $claim$
declare v_job public.discovery_entity_resolution_jobs%rowtype; v_now timestamptz:=clock_timestamp();
begin
  if p_worker_id is null or length(trim(p_worker_id))<8 or length(p_worker_id)>160 then
    raise exception 'Invalid E06 worker identity' using errcode='22023';
  end if;
  if p_lease_seconds<15 or p_lease_seconds>300 then
    raise exception 'E06 lease must be 15 to 300 seconds' using errcode='22023';
  end if;
  update public.discovery_entity_resolution_jobs
    set status=case when attempts>=max_attempts then 'failed' else 'queued' end,
      lease_owner=null,lease_expires_at=null,heartbeat_at=null,
      finished_at=case when attempts>=max_attempts then v_now else null end,
      available_at=case when attempts>=max_attempts then available_at
        else v_now+make_interval(secs=>least(30*greatest(attempts,1),300)) end,
      last_error_code=coalesce(last_error_code,'E06_LEASE_EXPIRED'),
      last_error_message=coalesce(last_error_message,'Previous E06 lease expired.'),
      updated_at=v_now
    where status='running' and lease_expires_at<=v_now;
  select j.* into v_job
    from public.discovery_entity_resolution_jobs j
    join public.discovery_extraction_runs r
      on r.company_id=j.company_id and r.id=j.extraction_run_id and r.status in ('completed','completed_with_warnings')
    join public.discovery_evidence_items e
      on e.company_id=j.company_id and e.id=j.evidence_id and e.content_hash=r.source_content_hash
    join public.discovery_source_registry s
      on s.company_id=j.company_id and s.id=j.source_id and s.status='approved'
    join public.discovery_jobs dj
      on dj.company_id=e.company_id and dj.id=e.job_id and dj.status='succeeded'
    join public.discovery_profiles p
      on p.company_id=dj.company_id and p.id=dj.profile_id and p.enabled=true
    join public.discovery_profile_sources ps
      on ps.company_id=dj.company_id and ps.profile_id=dj.profile_id and ps.source_id=j.source_id
    where j.status='queued' and j.available_at<=v_now and j.attempts<j.max_attempts
    order by j.available_at,j.created_at
    for update of j skip locked limit 1;
  if not found then return; end if;
  update public.discovery_entity_resolution_jobs
    set status='running',attempts=attempts+1,lease_owner=p_worker_id,
      lease_expires_at=v_now+make_interval(secs=>p_lease_seconds),
      heartbeat_at=v_now,started_at=coalesce(started_at,v_now),updated_at=v_now
    where id=v_job.id returning * into v_job;
  return next v_job;
end;
$claim$;

create or replace function public.heartbeat_discovery_entity_resolution_job(
  p_job_id uuid,p_worker_id text,p_lease_seconds integer default 90
) returns boolean
language plpgsql security definer
set search_path=public,pg_temp
as $heartbeat$
declare v_updated integer;
begin
  if p_lease_seconds<15 or p_lease_seconds>300 then
    raise exception 'E06 lease must be 15 to 300 seconds' using errcode='22023';
  end if;
  update public.discovery_entity_resolution_jobs j
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
        select 1 from public.discovery_extraction_runs r
        join public.discovery_evidence_items e on e.company_id=r.company_id and e.id=r.evidence_id
        join public.discovery_jobs dj on dj.company_id=e.company_id and dj.id=e.job_id and dj.status='succeeded'
        join public.discovery_profiles p on p.company_id=dj.company_id and p.id=dj.profile_id and p.enabled=true
        join public.discovery_profile_sources ps on ps.company_id=dj.company_id and ps.profile_id=dj.profile_id and ps.source_id=j.source_id
        where r.company_id=j.company_id and r.id=j.extraction_run_id and e.id=j.evidence_id
          and r.source_content_hash=e.content_hash and r.status in ('completed','completed_with_warnings')
      );
  get diagnostics v_updated=row_count;
  return v_updated=1;
end;
$heartbeat$;

create or replace function public.complete_discovery_entity_resolution(
  p_job_id uuid,p_worker_id text,p_candidates jsonb
) returns integer
language plpgsql security definer
set search_path=public,pg_temp
as $complete$
declare
  v_job public.discovery_entity_resolution_jobs%rowtype;
  v_run public.discovery_extraction_runs%rowtype;
  v_evidence public.discovery_evidence_items%rowtype;
  v_source public.discovery_source_registry%rowtype;
  v_candidate jsonb;
  v_count integer:=0;
begin
  if jsonb_typeof(p_candidates)<>'array' or jsonb_array_length(p_candidates)>500
    or octet_length(p_candidates::text)>500000 then
    raise exception 'E06 candidate batch is outside approved bounds' using errcode='22023';
  end if;
  select * into v_job from public.discovery_entity_resolution_jobs
    where id=p_job_id and status='running' and lease_owner=p_worker_id
      and lease_expires_at>clock_timestamp() for update;
  if not found then raise exception 'E06 lease is no longer valid' using errcode='42501'; end if;
  select * into v_run from public.discovery_extraction_runs
    where company_id=v_job.company_id and id=v_job.extraction_run_id
      and status in ('completed','completed_with_warnings') for share;
  if not found then raise exception 'E05 run is not complete' using errcode='42501'; end if;
  select * into v_evidence from public.discovery_evidence_items
    where company_id=v_job.company_id and id=v_job.evidence_id for share;
  if not found or v_evidence.content_hash<>v_run.source_content_hash or v_evidence.source_id<>v_job.source_id then
    raise exception 'E06 evidence snapshot does not match E05 run' using errcode='42501';
  end if;
  select * into v_source from public.discovery_source_registry
    where company_id=v_job.company_id and id=v_job.source_id and status='approved' for share;
  if not found then raise exception 'E06 source approval has been revoked' using errcode='42501'; end if;
  if not exists (
    select 1 from public.discovery_jobs dj
    join public.discovery_profiles p on p.company_id=dj.company_id and p.id=dj.profile_id and p.enabled=true
    join public.discovery_profile_sources ps on ps.company_id=dj.company_id and ps.profile_id=dj.profile_id and ps.source_id=v_job.source_id
    where dj.company_id=v_job.company_id and dj.id=v_evidence.job_id and dj.status='succeeded'
  ) then raise exception 'E06 parent discovery job or profile is no longer eligible' using errcode='42501'; end if;
  for v_candidate in select value from jsonb_array_elements(p_candidates)
  loop
    if jsonb_typeof(v_candidate)<>'object'
      or length(coalesce(v_candidate->>'extracted_entity_id',''))=0
      or coalesce(v_candidate->>'match_type','') not in (
        'exact_identifier','exact_legal_name','exact_alias','name_similarity',
        'ambiguous_identifier','ambiguous_name','ambiguous_name_similarity',
        'new_entity_proposal','insufficient_identity_data'
      )
      or length(trim(coalesce(v_candidate->>'proposed_name','')))=0
      or length(trim(coalesce(v_candidate->>'normalized_name','')))=0
      or not (v_candidate ? 'jurisdiction')
      or jsonb_typeof(coalesce(v_candidate->'identifier_proposals','[]'::jsonb))<>'array'
      or jsonb_typeof(coalesce(v_candidate->'rationale','{}'::jsonb))<>'object' then
      raise exception 'E06 candidate payload is invalid' using errcode='22023';
    end if;
    if not exists (
      select 1 from public.discovery_extracted_entities x
      where x.company_id=v_job.company_id and x.extraction_run_id=v_job.extraction_run_id
        and x.id=(v_candidate->>'extracted_entity_id')::uuid and x.entity_kind='organization'
    ) then
      raise exception 'E06 candidate is not an organization mention from this run' using errcode='42501';
    end if;
    if nullif(v_candidate->>'matched_entity_id','') is not null and not exists (
      select 1 from public.discovery_canonical_entities c
      where c.company_id=v_job.company_id and c.id=(v_candidate->>'matched_entity_id')::uuid
        and c.status='active' and c.jurisdiction=upper(v_candidate->>'jurisdiction')
    ) then
      raise exception 'E06 matched entity is not active in this company and jurisdiction' using errcode='42501';
    end if;
    insert into public.discovery_entity_match_candidates(
      company_id,resolution_job_id,extraction_run_id,extracted_entity_id,matched_entity_id,
      match_type,proposed_name,normalized_name,jurisdiction,identifier_proposals,
      match_score,rationale
    ) values (
      v_job.company_id,v_job.id,v_job.extraction_run_id,(v_candidate->>'extracted_entity_id')::uuid,
      nullif(v_candidate->>'matched_entity_id','')::uuid,
      v_candidate->>'match_type',left(trim(v_candidate->>'proposed_name'),1000),
      left(trim(v_candidate->>'normalized_name'),1000),
      nullif(left(trim(v_candidate->>'jurisdiction'),80),''),
      coalesce(v_candidate->'identifier_proposals','[]'::jsonb),
      greatest(0,least(1,(v_candidate->>'match_score')::numeric)),
      coalesce(v_candidate->'rationale','{}'::jsonb)
    );
    v_count:=v_count+1;
  end loop;
  update public.discovery_entity_resolution_jobs
    set status='succeeded',finished_at=clock_timestamp(),lease_owner=null,
      lease_expires_at=null,heartbeat_at=null,updated_at=clock_timestamp()
    where id=v_job.id;
  return v_count;
end;
$complete$;

create or replace function public.fail_discovery_entity_resolution_job(
  p_job_id uuid,p_worker_id text,p_error_code text,p_error_message text
) returns boolean
language plpgsql security definer
set search_path=public,pg_temp
as $fail$
declare v_job public.discovery_entity_resolution_jobs%rowtype;
begin
  select * into v_job from public.discovery_entity_resolution_jobs
    where id=p_job_id and status='running' and lease_owner=p_worker_id
      and lease_expires_at>clock_timestamp() for update;
  if not found then return false; end if;
  update public.discovery_entity_resolution_jobs
    set status=case when attempts>=max_attempts then 'failed' else 'queued' end,
      available_at=clock_timestamp()+make_interval(secs=>least(30*greatest(attempts,1),300)),
      lease_owner=null,lease_expires_at=null,heartbeat_at=null,
      finished_at=case when attempts>=max_attempts then clock_timestamp() else null end,
      last_error_code=left(coalesce(p_error_code,'E06_FAILED'),100),
      last_error_message=left(coalesce(p_error_message,'E06 failed.'),1000),
      updated_at=clock_timestamp()
    where id=v_job.id;
  return true;
end;
$fail$;

create or replace function public.record_discovery_entity_resolution_review(
  p_company_id uuid,p_actor_user_id uuid,p_candidate_id uuid,p_decision text,p_reason text
) returns public.discovery_entity_review_events
language plpgsql security definer
set search_path=public,pg_temp
as $review$
declare
  v_role text;
  v_candidate public.discovery_entity_match_candidates%rowtype;
  v_evidence_id uuid;
  v_canonical public.discovery_canonical_entities%rowtype;
  v_event public.discovery_entity_review_events%rowtype;
  v_identifier jsonb;
  v_scheme text;
begin
  if p_company_id is null or p_actor_user_id is null or p_candidate_id is null then
    raise exception 'Company, actor and candidate are required' using errcode='22023';
  end if;
  if p_decision not in ('linked_existing','created_new','rejected','escalated') then
    raise exception 'Unsupported E06 review decision' using errcode='22023';
  end if;
  if p_reason is null or length(trim(p_reason))<1 or length(p_reason)>1000 then
    raise exception 'E06 review reason is required' using errcode='22023';
  end if;
  select role into v_role from public.company_memberships
    where company_id=p_company_id and user_id=p_actor_user_id for share;
  if v_role is null or v_role not in ('owner','admin') then
    raise exception 'Only a company owner or admin can review entity matches' using errcode='42501';
  end if;
  select * into v_candidate from public.discovery_entity_match_candidates
    where company_id=p_company_id and id=p_candidate_id and review_state='pending_review'
    for update;
  if not found then raise exception 'Pending E06 candidate was not found in this company' using errcode='P0002'; end if;
  select evidence_id into v_evidence_id from public.discovery_extraction_runs
    where company_id=p_company_id and id=v_candidate.extraction_run_id;

  if p_decision='linked_existing' then
    if v_candidate.matched_entity_id is null then
      raise exception 'This candidate has no single suggested canonical entity; create new or escalate after review' using errcode='22023';
    end if;
    select * into v_canonical from public.discovery_canonical_entities
      where company_id=p_company_id and id=v_candidate.matched_entity_id and status='active'
        and jurisdiction=v_candidate.jurisdiction for share;
    if not found then raise exception 'Suggested canonical entity is no longer active in this jurisdiction' using errcode='42501'; end if;
  elsif p_decision='created_new' then
    insert into public.discovery_canonical_entities(
      company_id,entity_kind,legal_name,normalized_name,jurisdiction,status,source_evidence_id,created_by
    ) values (
      p_company_id,'organization',v_candidate.proposed_name,v_candidate.normalized_name,
      coalesce(v_candidate.jurisdiction,'UNKNOWN'),'active',v_evidence_id,p_actor_user_id
    ) returning * into v_canonical;
    for v_identifier in select value from jsonb_array_elements(v_candidate.identifier_proposals)
    loop
      v_scheme:=upper(coalesce(v_identifier->>'scheme',''));
      if v_scheme !~ '^[A-Z][A-Z0-9_]{1,39}$'
        or length(coalesce(v_identifier->>'normalized_value',''))<4
        or length(coalesce(v_identifier->>'normalized_value',''))>128 then
        raise exception 'E06 identifier proposal is invalid' using errcode='22023';
      end if;
      insert into public.discovery_entity_identifiers(
        company_id,canonical_entity_id,scheme,jurisdiction,normalized_value,
        raw_value,field_name,source_evidence_id,source_span,review_state
      ) values (
        p_company_id,v_canonical.id,v_scheme,
        coalesce(v_identifier->>'jurisdiction',v_candidate.jurisdiction,'UNKNOWN'),
        v_identifier->>'normalized_value',
        left(coalesce(v_identifier->>'raw_value',v_identifier->>'normalized_value'),1000),
        left(coalesce(v_identifier->>'field_name','registration_id'),128),
        v_evidence_id,coalesce(v_identifier->'source_span','{}'::jsonb),'owner_accepted'
      );
    end loop;
  end if;

  insert into public.discovery_entity_review_events(
    company_id,candidate_id,actor_user_id,decision,canonical_entity_id,reason
  ) values (
    p_company_id,p_candidate_id,p_actor_user_id,p_decision,
    case when p_decision in ('linked_existing','created_new') then v_canonical.id else null end,
    trim(p_reason)
  ) returning * into v_event;

  if p_decision in ('linked_existing','created_new') then
    if p_decision='linked_existing' and v_candidate.normalized_name<>v_canonical.normalized_name then
      insert into public.discovery_entity_aliases(
        company_id,canonical_entity_id,alias,normalized_alias,alias_type,
        source_evidence_id,source_span,review_state
      )
      select p_company_id,v_canonical.id,v_candidate.proposed_name,v_candidate.normalized_name,
        'source_observed',v_evidence_id,x.source_span,'owner_accepted'
      from public.discovery_extracted_entities x
      where x.company_id=p_company_id and x.extraction_run_id=v_candidate.extraction_run_id
        and x.id=v_candidate.extracted_entity_id;
    end if;
    insert into public.discovery_entity_assignments(
      company_id,extraction_run_id,extracted_entity_id,canonical_entity_id,source_evidence_id,review_event_id
    ) values (
      p_company_id,v_candidate.extraction_run_id,v_candidate.extracted_entity_id,
      v_canonical.id,v_evidence_id,v_event.id
    );
  end if;

  update public.discovery_entity_match_candidates
    set review_state=p_decision,reviewed_at=clock_timestamp()
    where company_id=p_company_id and id=p_candidate_id;
  insert into public.discovery_audit_events(
    company_id,actor_user_id,action,entity_type,entity_id,details
  ) values (
    p_company_id,p_actor_user_id,'entity_resolution_review_recorded',
    case when p_decision='created_new' then 'canonical_entity' else 'entity_resolution_candidate' end,
    case when p_decision='created_new' then v_canonical.id else p_candidate_id end,
    jsonb_build_object('candidateId',p_candidate_id,'decision',p_decision,
      'canonicalEntityId',case when p_decision in ('linked_existing','created_new') then v_canonical.id else null end)
  );
  return v_event;
end;
$review$;

create or replace function public.prevent_discovery_entity_record_update()
returns trigger language plpgsql as $guard$
begin
  raise exception 'E06 evidence links are immutable; use a new review event or source capture.';
end;
$guard$;
create trigger discovery_entity_identifiers_no_update before update on public.discovery_entity_identifiers
  for each row execute function public.prevent_discovery_entity_record_update();
create trigger discovery_entity_aliases_no_update before update on public.discovery_entity_aliases
  for each row execute function public.prevent_discovery_entity_record_update();
create trigger discovery_entity_assignments_no_update before update on public.discovery_entity_assignments
  for each row execute function public.prevent_discovery_entity_record_update();
create trigger discovery_entity_relationships_no_update before update on public.discovery_entity_relationships
  for each row execute function public.prevent_discovery_entity_record_update();
create trigger discovery_entity_review_events_no_update before update on public.discovery_entity_review_events
  for each row execute function public.prevent_discovery_entity_record_update();
create trigger discovery_canonical_entities_no_update before update on public.discovery_canonical_entities
  for each row execute function public.prevent_discovery_entity_record_update();

revoke all on function public.claim_discovery_entity_resolution_job(text,integer) from public,anon,authenticated;
revoke all on function public.heartbeat_discovery_entity_resolution_job(uuid,text,integer) from public,anon,authenticated;
revoke all on function public.complete_discovery_entity_resolution(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.fail_discovery_entity_resolution_job(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.record_discovery_entity_resolution_review(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_discovery_entity_resolution_job(text,integer) to service_role;
grant execute on function public.heartbeat_discovery_entity_resolution_job(uuid,text,integer) to service_role;
grant execute on function public.complete_discovery_entity_resolution(uuid,text,jsonb) to service_role;
grant execute on function public.fail_discovery_entity_resolution_job(uuid,text,text,text) to service_role;
grant execute on function public.record_discovery_entity_resolution_review(uuid,uuid,uuid,text,text) to service_role;

comment on table public.discovery_canonical_entities is
  'Canonical organization identity created only after explicit company owner/admin resolution review. source_evidence_id remains a historical UUID reference after raw evidence retention purge.';
comment on table public.discovery_entity_match_candidates is
  'Evidence-backed E05-to-E06 identity suggestions. Exact and fuzzy matches remain pending human review.';
comment on table public.discovery_entity_identifiers is
  'Jurisdiction and scheme-scoped registry identifiers accepted from a reviewed source; not a legal title or solvency conclusion.';
comment on table public.discovery_entity_aliases is
  'Source-backed names and aliases linked to canonical organizations through a human review decision.';
comment on table public.discovery_entity_relationships is
  'Evidence-linked parent/subsidiary/holding/branch/affiliate/JV/successor relationship records; they are not inferred from a name alone.';

commit;
