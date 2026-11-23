-- AXIVESTRA technical E19: cross-stage verification and evidence-confidence workflow.
-- Roadmap alias: revised capability E13. This is additive to E05-E18; it does not
-- rename historical migrations or reinterpret the existing E13 provenance ledger.
-- Confidence is an explainable evidence index, never a probability or a substitute
-- for owner/admin judgement. No model, external verifier or network worker is started.

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
    'contact_point_review_recorded','place_resolution_review_recorded',
    'enrichment_observation_review_recorded','enrichment_conflict_review_recorded',
    'match_score_recorded','deduplication_review_recorded',
    'privacy_policy_recorded','privacy_request_created','privacy_request_verified',
    'privacy_subject_restricted','privacy_subject_erased','privacy_subject_retained',
    'privacy_request_fulfilled','privacy_retention_queued','privacy_retention_processed',
    'verification_case_opened','verification_evidence_classified',
    'verification_review_recorded','verification_case_reopened'
  ));
alter table public.discovery_audit_events
  drop constraint if exists discovery_audit_events_entity_type_check;
alter table public.discovery_audit_events
  add constraint discovery_audit_events_entity_type_check check (entity_type in (
    'source','profile','profile_source','discovery_job','discovery_worker_control',
    'extraction_review_event','entity_resolution_candidate','canonical_entity',
    'entity_relationship','professional_role_candidate','professional_person',
    'contact_point','place_candidate','enrichment_observation','enrichment_conflict',
    'match_result','deduplication_candidate','privacy_policy','privacy_request',
    'privacy_subject','privacy_retention_job','verification_case'
  ));

create table if not exists public.discovery_verification_cases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  subject_kind text not null check (subject_kind in (
    'extracted_fact','extracted_entity','canonical_entity','entity_assignment',
    'entity_identifier','entity_alias','entity_relationship',
    'professional_role_candidate','professional_role_assignment',
    'contact_point','place_candidate','enrichment_observation'
  )),
  subject_id uuid not null,
  status text not null default 'pending_review' check (status in (
    'pending_review','in_review','verified','partially_verified',
    'disputed','rejected','insufficient_evidence'
  )),
  opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  unique(company_id,id),
  unique(company_id,subject_kind,subject_id),
  check ((reviewed_by is null and reviewed_at is null)
      or (reviewed_by is not null and reviewed_at is not null))
);
create index if not exists discovery_verification_cases_inbox_idx
  on public.discovery_verification_cases(company_id,status,updated_at desc);
create index if not exists discovery_verification_cases_subject_idx
  on public.discovery_verification_cases(company_id,subject_kind,subject_id);

create table if not exists public.discovery_verification_evidence (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  case_id uuid not null,
  provenance_event_id uuid not null references public.discovery_provenance_events(id) on delete restrict,
  source_id uuid,
  source_name_snapshot text check (source_name_snapshot is null or length(source_name_snapshot)<=160),
  source_domain_snapshot text check (source_domain_snapshot is null or length(source_domain_snapshot)<=253),
  evidence_content_hash text check (
    evidence_content_hash is null or evidence_content_hash ~ '^[a-f0-9]{64}$'
  ),
  evidence_captured_at timestamptz,
  source_published_at timestamptz,
  provenance_event_type text not null check (length(provenance_event_type)<=80),
  default_classification text not null default 'context'
    check (default_classification in ('supporting','contradicting','context')),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(company_id,id),
  unique(company_id,case_id,provenance_event_id),
  foreign key(company_id,case_id)
    references public.discovery_verification_cases(company_id,id) on delete cascade
);
create index if not exists discovery_verification_evidence_case_idx
  on public.discovery_verification_evidence(company_id,case_id,occurred_at desc);
create index if not exists discovery_verification_evidence_source_idx
  on public.discovery_verification_evidence(company_id,case_id,source_id)
  where source_id is not null;

create table if not exists public.discovery_verification_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  case_id uuid not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in (
    'case_opened','evidence_added','evidence_classified',
    'review_decision','case_reopened_after_new_evidence'
  )),
  previous_status text,
  new_status text,
  provenance_event_id uuid,
  previous_classification text check (
    previous_classification is null or previous_classification in ('supporting','contradicting','context')
  ),
  new_classification text check (
    new_classification is null or new_classification in ('supporting','contradicting','context')
  ),
  confidence_index_snapshot numeric(5,2)
    check (confidence_index_snapshot is null or confidence_index_snapshot between 0 and 100),
  evidence_count_snapshot integer check (evidence_count_snapshot is null or evidence_count_snapshot>=0),
  independent_source_count_snapshot integer
    check (independent_source_count_snapshot is null or independent_source_count_snapshot>=0),
  reason text check (reason is null or length(reason)<=1000),
  occurred_at timestamptz not null default now(),
  unique(company_id,id),
  foreign key(company_id,case_id)
    references public.discovery_verification_cases(company_id,id) on delete cascade
);
create index if not exists discovery_verification_events_timeline_idx
  on public.discovery_verification_events(company_id,case_id,occurred_at desc);

alter table public.discovery_verification_cases enable row level security;
alter table public.discovery_verification_evidence enable row level security;
alter table public.discovery_verification_events enable row level security;
drop policy if exists discovery_verification_cases_company_read on public.discovery_verification_cases;
create policy discovery_verification_cases_company_read
  on public.discovery_verification_cases for select to authenticated
  using (public.is_company_member(company_id));
drop policy if exists discovery_verification_evidence_company_read on public.discovery_verification_evidence;
create policy discovery_verification_evidence_company_read
  on public.discovery_verification_evidence for select to authenticated
  using (public.is_company_member(company_id));
drop policy if exists discovery_verification_events_company_read on public.discovery_verification_events;
create policy discovery_verification_events_company_read
  on public.discovery_verification_events for select to authenticated
  using (public.is_company_member(company_id));

revoke all on public.discovery_verification_cases,public.discovery_verification_evidence,
  public.discovery_verification_events from public,anon,authenticated,service_role;
grant select on public.discovery_verification_cases,public.discovery_verification_evidence,
  public.discovery_verification_events to authenticated,service_role;

create or replace function public.prevent_discovery_verification_event_mutation()
returns trigger language plpgsql
as $guard$
begin
  raise exception 'Verification events are append-only; create a new event instead.';
end;
$guard$;
drop trigger if exists discovery_verification_events_immutable on public.discovery_verification_events;
create trigger discovery_verification_events_immutable
  before update or delete on public.discovery_verification_events
  for each row execute function public.prevent_discovery_verification_event_mutation();
revoke update,delete on public.discovery_verification_events from public,anon,authenticated,service_role;

create or replace function public.sync_discovery_verification_provenance()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $sync$
declare
  v_case_id uuid;
  v_inserted_case uuid;
  v_inserted_evidence uuid;
  v_previous_status text;
  v_default_classification text:='context';
begin
  if new.subject_kind not in (
    'extracted_fact','extracted_entity','canonical_entity','entity_assignment',
    'entity_identifier','entity_alias','entity_relationship',
    'professional_role_candidate','professional_role_assignment',
    'contact_point','place_candidate','enrichment_observation'
  ) then return new; end if;

  insert into public.discovery_verification_cases(company_id,subject_kind,subject_id)
  values(new.company_id,new.subject_kind,new.subject_id)
  on conflict(company_id,subject_kind,subject_id) do nothing
  returning id into v_inserted_case;

  select id,status into v_case_id,v_previous_status
  from public.discovery_verification_cases
  where company_id=new.company_id and subject_kind=new.subject_kind and subject_id=new.subject_id;

  if new.event_type in (
    'evidence_captured','source_observed','extraction_reviewed',
    'canonical_entity_created','entity_assigned','identifier_recorded','alias_recorded',
    'relationship_recorded','professional_role_observed','professional_role_assigned',
    'contact_candidate_observed','contact_point_recorded','place_candidate_observed',
    'place_reviewed','enrichment_observed','enrichment_observation_reviewed'
  ) and coalesce(new.decision,'')<>'rejected' then
    v_default_classification:='supporting';
  end if;

  insert into public.discovery_verification_evidence(
    company_id,case_id,provenance_event_id,source_id,source_name_snapshot,
    source_domain_snapshot,evidence_content_hash,evidence_captured_at,
    source_published_at,provenance_event_type,default_classification,occurred_at
  ) values (
    new.company_id,v_case_id,new.id,new.source_id,new.source_name_snapshot,
    new.source_domain_snapshot,new.evidence_content_hash,new.evidence_captured_at,
    new.source_published_at,new.event_type,v_default_classification,new.occurred_at
  )
  on conflict(company_id,case_id,provenance_event_id) do nothing
  returning id into v_inserted_evidence;

  if v_inserted_case is not null then
    insert into public.discovery_verification_events(
      company_id,case_id,actor_user_id,event_type,new_status,provenance_event_id,reason
    ) values (
      new.company_id,v_case_id,new.actor_user_id,'case_opened','pending_review',new.id,
      'Automatically opened from the first source-backed provenance event.'
    );
  elsif v_inserted_evidence is not null then
    if v_previous_status in ('verified','partially_verified','disputed','rejected','insufficient_evidence') then
      update public.discovery_verification_cases
        set status='pending_review',reviewed_by=null,reviewed_at=null,updated_at=clock_timestamp()
        where company_id=new.company_id and id=v_case_id;
      insert into public.discovery_verification_events(
        company_id,case_id,actor_user_id,event_type,previous_status,new_status,
        provenance_event_id,reason
      ) values (
        new.company_id,v_case_id,new.actor_user_id,'case_reopened_after_new_evidence',
        v_previous_status,'pending_review',new.id,
        'New source-backed provenance arrived after a prior verification decision.'
      );
    else
      insert into public.discovery_verification_events(
        company_id,case_id,actor_user_id,event_type,previous_status,new_status,
        provenance_event_id,reason
      ) values (
        new.company_id,v_case_id,new.actor_user_id,'evidence_added',
        v_previous_status,v_previous_status,new.id,
        'A new source-backed provenance event was attached to this verification case.'
      );
    end if;
  end if;
  return new;
end;
$sync$;

drop trigger if exists discovery_verification_from_provenance on public.discovery_provenance_events;
create trigger discovery_verification_from_provenance
  after insert on public.discovery_provenance_events
  for each row execute function public.sync_discovery_verification_provenance();

-- Backfill all eligible historical provenance subjects and their source-lineage references.
insert into public.discovery_verification_cases(company_id,subject_kind,subject_id)
select distinct company_id,subject_kind,subject_id
from public.discovery_provenance_events
where subject_kind in (
  'extracted_fact','extracted_entity','canonical_entity','entity_assignment',
  'entity_identifier','entity_alias','entity_relationship',
  'professional_role_candidate','professional_role_assignment',
  'contact_point','place_candidate','enrichment_observation'
)
on conflict(company_id,subject_kind,subject_id) do nothing;

insert into public.discovery_verification_evidence(
  company_id,case_id,provenance_event_id,source_id,source_name_snapshot,
  source_domain_snapshot,evidence_content_hash,evidence_captured_at,
  source_published_at,provenance_event_type,default_classification,occurred_at
)
select p.company_id,c.id,p.id,p.source_id,p.source_name_snapshot,p.source_domain_snapshot,
       p.evidence_content_hash,p.evidence_captured_at,p.source_published_at,p.event_type,
       case when p.event_type in (
         'evidence_captured','source_observed','extraction_reviewed',
         'canonical_entity_created','entity_assigned','identifier_recorded','alias_recorded',
         'relationship_recorded','professional_role_observed','professional_role_assigned',
         'contact_candidate_observed','contact_point_recorded','place_candidate_observed',
         'place_reviewed','enrichment_observed','enrichment_observation_reviewed'
       ) and coalesce(p.decision,'')<>'rejected' then 'supporting' else 'context' end,
       p.occurred_at
from public.discovery_provenance_events p
join public.discovery_verification_cases c
  on c.company_id=p.company_id and c.subject_kind=p.subject_kind and c.subject_id=p.subject_id
where p.subject_kind in (
  'extracted_fact','extracted_entity','canonical_entity','entity_assignment',
  'entity_identifier','entity_alias','entity_relationship',
  'professional_role_candidate','professional_role_assignment',
  'contact_point','place_candidate','enrichment_observation'
)
on conflict(company_id,case_id,provenance_event_id) do nothing;

insert into public.discovery_verification_events(
  company_id,case_id,event_type,new_status,reason
)
select c.company_id,c.id,'case_opened','pending_review',
       'Backfilled from the existing company-scoped provenance ledger.'
from public.discovery_verification_cases c
where not exists (
  select 1 from public.discovery_verification_events e
  where e.company_id=c.company_id and e.case_id=c.id and e.event_type='case_opened'
);

create or replace view public.discovery_verification_inbox
with (security_invoker=true) as
with classified as (
  select e.*,
    coalesce((
      select v.new_classification
      from public.discovery_verification_events v
      where v.company_id=e.company_id and v.case_id=e.case_id
        and v.provenance_event_id=e.provenance_event_id
        and v.event_type='evidence_classified'
      order by v.occurred_at desc,v.id desc limit 1
    ),e.default_classification) as current_classification
  from public.discovery_verification_evidence e
), totals as (
  select company_id,case_id,
    count(*)::integer as evidence_count,
    count(distinct coalesce(source_domain_snapshot,'source:'||source_id::text))
      filter(where source_id is not null)::integer as independent_source_count,
    count(*) filter(where evidence_content_hash is not null)::integer as hashed_evidence_count,
    count(*) filter(where current_classification='supporting')::integer as supporting_evidence_count,
    count(*) filter(where current_classification='contradicting')::integer as contradicting_evidence_count,
    count(*) filter(where current_classification='context')::integer as context_evidence_count,
    max(coalesce(evidence_captured_at,occurred_at)) as last_evidence_at
  from classified group by company_id,case_id
)
select c.id,c.company_id,c.subject_kind,c.subject_id,c.status,c.opened_at,c.updated_at,
       c.reviewed_by,c.reviewed_at,
       coalesce(t.evidence_count,0)::integer as evidence_count,
       coalesce(t.independent_source_count,0)::integer as independent_source_count,
       coalesce(t.hashed_evidence_count,0)::integer as hashed_evidence_count,
       coalesce(t.supporting_evidence_count,0)::integer as supporting_evidence_count,
       coalesce(t.contradicting_evidence_count,0)::integer as contradicting_evidence_count,
       coalesce(t.context_evidence_count,0)::integer as context_evidence_count,
       t.last_evidence_at,
       case when coalesce(t.evidence_count,0)=0 then 0::numeric
         else round((
           50.0*least(coalesce(t.independent_source_count,0),3)/3.0
           +30.0*coalesce(t.hashed_evidence_count,0)::numeric/nullif(t.evidence_count,0)
           +20.0*case when coalesce(t.supporting_evidence_count,0)+coalesce(t.contradicting_evidence_count,0)=0
             then 0 else t.supporting_evidence_count::numeric/
               (t.supporting_evidence_count+t.contradicting_evidence_count) end
         ),2) end as confidence_index,
       case
         when coalesce(t.evidence_count,0)=0 then 'none'
         when (
           50.0*least(coalesce(t.independent_source_count,0),3)/3.0
           +30.0*coalesce(t.hashed_evidence_count,0)::numeric/nullif(t.evidence_count,0)
           +20.0*case when coalesce(t.supporting_evidence_count,0)+coalesce(t.contradicting_evidence_count,0)=0
             then 0 else t.supporting_evidence_count::numeric/
               (t.supporting_evidence_count+t.contradicting_evidence_count) end
         )>=70 then 'high'
         when (
           50.0*least(coalesce(t.independent_source_count,0),3)/3.0
           +30.0*coalesce(t.hashed_evidence_count,0)::numeric/nullif(t.evidence_count,0)
           +20.0*case when coalesce(t.supporting_evidence_count,0)+coalesce(t.contradicting_evidence_count,0)=0
             then 0 else t.supporting_evidence_count::numeric/
               (t.supporting_evidence_count+t.contradicting_evidence_count) end
         )>=40 then 'moderate'
         else 'low'
       end as confidence_band
from public.discovery_verification_cases c
left join totals t on t.company_id=c.company_id and t.case_id=c.id;

grant select on public.discovery_verification_inbox to authenticated,service_role;

create or replace function public.record_discovery_verification_evidence_classification(
  p_company_id uuid,p_case_id uuid,p_provenance_event_id uuid,
  p_classification text,p_reason text
) returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $classify$
declare
  v_role text;
  v_case public.discovery_verification_cases%rowtype;
  v_score numeric(5,2);
  v_count integer;
  v_sources integer;
  v_event_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user context is required.' using errcode='42501';
  end if;
  select role into v_role from public.company_memberships
    where company_id=p_company_id and user_id=auth.uid();
  if coalesce(v_role,'') not in ('owner','admin') then
    raise exception 'Only company owners/admins can classify verification evidence.' using errcode='42501';
  end if;
  if p_classification not in ('supporting','contradicting','context') then
    raise exception 'Unsupported evidence classification.' using errcode='22023';
  end if;
  if p_reason is null or length(trim(p_reason))<10 or length(p_reason)>1000 then
    raise exception 'A classification reason of 10–1000 characters is required.' using errcode='22023';
  end if;
  select * into v_case from public.discovery_verification_cases
    where company_id=p_company_id and id=p_case_id for update;
  if not found then raise exception 'Verification case not found in this company.'; end if;
  if not exists(select 1 from public.discovery_verification_evidence e
    where e.company_id=p_company_id and e.case_id=p_case_id
      and e.provenance_event_id=p_provenance_event_id) then
    raise exception 'Evidence reference does not belong to this verification case.'; end if;

  insert into public.discovery_verification_events(
    company_id,case_id,actor_user_id,event_type,provenance_event_id,
    new_classification,reason
  ) values (
    p_company_id,p_case_id,auth.uid(),'evidence_classified',p_provenance_event_id,
    p_classification,trim(p_reason)
  ) returning id into v_event_id;

  select confidence_index,evidence_count,independent_source_count
    into v_score,v_count,v_sources
  from public.discovery_verification_inbox where company_id=p_company_id and id=p_case_id;

  if v_case.status<>'pending_review' and v_case.status<>'in_review' then
    update public.discovery_verification_cases
      set status='pending_review',reviewed_by=null,reviewed_at=null,updated_at=clock_timestamp()
      where company_id=p_company_id and id=p_case_id;
    insert into public.discovery_verification_events(
      company_id,case_id,actor_user_id,event_type,previous_status,new_status,
      confidence_index_snapshot,evidence_count_snapshot,independent_source_count_snapshot,
      reason
    ) values (
      p_company_id,p_case_id,auth.uid(),'review_decision',v_case.status,'pending_review',
      v_score,v_count,v_sources,'Evidence classification changed; a fresh verification decision is required.'
    );
  end if;

  insert into public.discovery_audit_events(company_id,actor_user_id,action,entity_type,entity_id,details)
  values(p_company_id,auth.uid(),'verification_evidence_classified','verification_case',p_case_id,
    jsonb_build_object('provenanceEventId',p_provenance_event_id,
      'classification',p_classification,'reason',trim(p_reason)));
  return v_event_id;
end;
$classify$;

create or replace function public.record_discovery_verification_review(
  p_company_id uuid,p_case_id uuid,p_decision text,p_reason text
) returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $review$
declare
  v_role text;
  v_case public.discovery_verification_cases%rowtype;
  v_score numeric(5,2);
  v_count integer;
  v_sources integer;
  v_support integer;
  v_contradict integer;
  v_event_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user context is required.' using errcode='42501';
  end if;
  select role into v_role from public.company_memberships
    where company_id=p_company_id and user_id=auth.uid();
  if coalesce(v_role,'') not in ('owner','admin') then
    raise exception 'Only company owners/admins can decide verification cases.' using errcode='42501';
  end if;
  if p_decision not in (
    'in_review','verified','partially_verified','disputed','rejected',
    'insufficient_evidence','pending_review'
  ) then raise exception 'Unsupported verification decision.' using errcode='22023'; end if;
  if p_reason is null or length(trim(p_reason))<10 or length(p_reason)>1000 then
    raise exception 'A review reason of 10–1000 characters is required.' using errcode='22023';
  end if;
  select * into v_case from public.discovery_verification_cases
    where company_id=p_company_id and id=p_case_id for update;
  if not found then raise exception 'Verification case not found in this company.'; end if;

  select confidence_index,evidence_count,independent_source_count,
         supporting_evidence_count,contradicting_evidence_count
    into v_score,v_count,v_sources,v_support,v_contradict
  from public.discovery_verification_inbox where company_id=p_company_id and id=p_case_id;

  if p_decision='verified' and (
    coalesce(v_support,0)=0 or coalesce(v_contradict,0)>=coalesce(v_support,0)
    or coalesce(v_score,0)<40
  ) then
    raise exception 'Verification requires supporting evidence, a confidence index of at least 40, and more supporting than contradicting evidence. Resolve or explain the evidence first.';
  end if;
  if p_decision='partially_verified' and coalesce(v_support,0)=0 then
    raise exception 'Partial verification still requires at least one supporting evidence reference.';
  end if;

  update public.discovery_verification_cases
    set status=p_decision,updated_at=clock_timestamp(),
        reviewed_by=auth.uid(),reviewed_at=clock_timestamp()
    where company_id=p_company_id and id=p_case_id;

  insert into public.discovery_verification_events(
    company_id,case_id,actor_user_id,event_type,previous_status,new_status,
    confidence_index_snapshot,evidence_count_snapshot,
    independent_source_count_snapshot,reason
  ) values (
    p_company_id,p_case_id,auth.uid(),'review_decision',v_case.status,p_decision,
    v_score,v_count,v_sources,trim(p_reason)
  ) returning id into v_event_id;

  insert into public.discovery_audit_events(company_id,actor_user_id,action,entity_type,entity_id,details)
  values(p_company_id,auth.uid(),'verification_review_recorded','verification_case',p_case_id,
    jsonb_build_object('decision',p_decision,'confidenceIndex',v_score,
      'evidenceCount',v_count,'independentSourceCount',v_sources,'reason',trim(p_reason)));
  return v_event_id;
end;
$review$;

revoke all on function public.sync_discovery_verification_provenance() from public,anon,authenticated,service_role;
revoke all on function public.prevent_discovery_verification_event_mutation() from public,anon,authenticated,service_role;
revoke all on function public.record_discovery_verification_evidence_classification(uuid,uuid,uuid,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.record_discovery_verification_review(uuid,uuid,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.record_discovery_verification_evidence_classification(uuid,uuid,uuid,text,text) to authenticated;
grant execute on function public.record_discovery_verification_review(uuid,uuid,text,text) to authenticated;

comment on table public.discovery_verification_cases is
  'E19 cross-stage verification cases opened from E13 provenance subjects. Decisions remain human owner/admin-only.';
comment on table public.discovery_verification_evidence is
  'E19 references immutable E13 provenance metadata only. No source body, URL, extracted value or contact data is copied.';
comment on table public.discovery_verification_events is
  'E19 append-only evidence classification and verification decision history.';
comment on view public.discovery_verification_inbox is
  'E19 company-scoped verification inbox with transparent 0-100 evidence coverage index; not a probability or automatic truth decision.';

commit;
