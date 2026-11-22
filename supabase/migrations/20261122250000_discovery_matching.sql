-- AXIVESTRA E11: deterministic, explainable workspace-fit scores.
-- Fit is a review aid, not a probability, underwriting decision or automatic lead approval.
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
    'match_score_review_recorded'
  ));
alter table public.discovery_audit_events
  drop constraint if exists discovery_audit_events_entity_type_check;
alter table public.discovery_audit_events
  add constraint discovery_audit_events_entity_type_check check (entity_type in (
    'source','profile','profile_source','discovery_job','discovery_worker_control',
    'extraction_review_event','entity_resolution_candidate','canonical_entity',
    'entity_relationship','professional_role_candidate','professional_person',
    'contact_point','place_candidate','enrichment_observation','enrichment_conflict',
    'match_score'
  ));

create table if not exists public.discovery_match_scores (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null,
  canonical_entity_id uuid not null,
  workspace_key text not null,
  discovery_mode text not null check (discovery_mode in ('LENDER','CUSTOMER')),
  criteria_hash text not null check (criteria_hash ~ '^[a-f0-9]{64}$'),
  candidate_hash text not null check (candidate_hash ~ '^[a-f0-9]{64}$'),
  rule_version text not null check (rule_version = 'deterministic-rules-v1'),
  match_score numeric(5,2) check (match_score is null or match_score between 0 and 100),
  confidence numeric(5,2) not null check (confidence between 0 and 100),
  coverage numeric(5,2) not null check (coverage between 0 and 100),
  score_state text not null check (score_state in ('review_required','insufficient_data')),
  score_components jsonb not null
    check (jsonb_typeof(score_components)='array' and octet_length(score_components::text)<=40000),
  rationale jsonb not null
    check (jsonb_typeof(rationale)='object' and octet_length(rationale::text)<=20000),
  evidence_refs jsonb not null default '{"evidenceIds":[],"sourceIds":[]}'::jsonb
    check (jsonb_typeof(evidence_refs)='object' and octet_length(evidence_refs::text)<=12000),
  criteria_snapshot jsonb not null
    check (jsonb_typeof(criteria_snapshot)='object' and octet_length(criteria_snapshot::text)<=20000),
  candidate_snapshot jsonb not null
    check (jsonb_typeof(candidate_snapshot)='object' and octet_length(candidate_snapshot::text)<=30000),
  review_state text not null default 'pending_review'
    check (review_state in ('pending_review','accepted','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique(company_id,id),
  foreign key (company_id,profile_id)
    references public.discovery_profiles(company_id,id) on delete cascade,
  foreign key (company_id,canonical_entity_id)
    references public.discovery_canonical_entities(company_id,id) on delete restrict,
  check ((score_state='insufficient_data' and match_score is null)
      or (score_state='review_required' and match_score is not null)),
  check ((review_state='pending_review' and reviewed_at is null)
      or (review_state<>'pending_review' and reviewed_at is not null))
);

create index if not exists discovery_match_scores_review_idx
  on public.discovery_match_scores(company_id,profile_id,review_state,created_at desc);
create index if not exists discovery_match_scores_entity_idx
  on public.discovery_match_scores(company_id,canonical_entity_id,created_at desc);

create table if not exists public.discovery_match_review_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  match_score_id uuid,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  decision text not null check (decision in ('accepted','rejected')),
  reason text not null check (length(trim(reason)) between 1 and 1000),
  score_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(score_snapshot)='object' and octet_length(score_snapshot::text)<=8000),
  occurred_at timestamptz not null default now()
);
create index if not exists discovery_match_review_events_company_idx
  on public.discovery_match_review_events(company_id,occurred_at desc);

alter table public.discovery_match_scores enable row level security;
alter table public.discovery_match_review_events enable row level security;

drop policy if exists "company members can view discovery match scores" on public.discovery_match_scores;
create policy "company members can view discovery match scores"
on public.discovery_match_scores for select to authenticated
using (public.is_company_member(company_id));
drop policy if exists "company members can view discovery match reviews" on public.discovery_match_review_events;
create policy "company members can view discovery match reviews"
on public.discovery_match_review_events for select to authenticated
using (public.is_company_member(company_id));

revoke all on public.discovery_match_scores,public.discovery_match_review_events
  from public,anon,authenticated;
grant select on public.discovery_match_scores,public.discovery_match_review_events to authenticated;
grant all on public.discovery_match_scores,public.discovery_match_review_events to service_role;

create or replace function public.record_discovery_match_review(
  p_company_id uuid,p_actor_user_id uuid,p_match_score_id uuid,p_decision text,p_reason text
) returns public.discovery_match_review_events
language plpgsql security definer
set search_path=public,pg_temp
as $review$
declare
  v_role text;
  v_score public.discovery_match_scores%rowtype;
  v_event public.discovery_match_review_events%rowtype;
begin
  if p_decision not in ('accepted','rejected') then
    raise exception 'Unsupported E11 match review decision' using errcode='22023';
  end if;
  if p_reason is null or length(trim(p_reason))<1 or length(p_reason)>1000 then
    raise exception 'E11 review reason is required' using errcode='22023';
  end if;
  select role into v_role from public.company_memberships
    where company_id=p_company_id and user_id=p_actor_user_id for share;
  if v_role is null or v_role not in ('owner','admin') then
    raise exception 'Only a company owner or admin can review E11 match scores' using errcode='42501';
  end if;
  select * into v_score from public.discovery_match_scores
    where company_id=p_company_id and id=p_match_score_id and review_state='pending_review'
    for update;
  if not found then raise exception 'Pending E11 match score was not found' using errcode='P0002'; end if;
  update public.discovery_match_scores
    set review_state=p_decision,reviewed_at=clock_timestamp()
    where company_id=p_company_id and id=p_match_score_id;
  insert into public.discovery_match_review_events(
    company_id,match_score_id,actor_user_id,decision,reason,score_snapshot
  ) values (
    p_company_id,p_match_score_id,p_actor_user_id,p_decision,trim(p_reason),
    jsonb_build_object(
      'profileId',v_score.profile_id,
      'canonicalEntityId',v_score.canonical_entity_id,
      'workspaceKey',v_score.workspace_key,
      'discoveryMode',v_score.discovery_mode,
      'matchScore',v_score.match_score,
      'confidence',v_score.confidence,
      'coverage',v_score.coverage,
      'criteriaHash',v_score.criteria_hash,
      'candidateHash',v_score.candidate_hash,
      'ruleVersion',v_score.rule_version
    )
  ) returning * into v_event;
  insert into public.discovery_audit_events(
    company_id,actor_user_id,action,entity_type,entity_id,details
  ) values (
    p_company_id,p_actor_user_id,'match_score_review_recorded','match_score',
    p_match_score_id,jsonb_build_object('decision',p_decision,'workspaceKey',v_score.workspace_key,
      'discoveryMode',v_score.discovery_mode,'matchScore',v_score.match_score,
      'confidence',v_score.confidence,'coverage',v_score.coverage)
  );
  return v_event;
end;
$review$;

revoke all on function public.record_discovery_match_review(uuid,uuid,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.record_discovery_match_review(uuid,uuid,uuid,text,text)
  to service_role;

commit;
