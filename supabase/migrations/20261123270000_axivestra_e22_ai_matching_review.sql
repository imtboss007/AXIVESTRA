-- AXIVESTRA E22: durable, company-scoped advisory suggestions and owner/admin review.
-- Provider execution remains disabled by default. This migration only stores already-validated suggestions.
begin;

create table if not exists public.discovery_ai_match_suggestions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  match_result_id uuid not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  policy_version text not null check (policy_version='e22_advisory_matching_v1'),
  provider_id text not null check (length(trim(provider_id)) between 1 and 80),
  model_version text not null check (length(trim(model_version)) between 1 and 120),
  recommendation text not null check (recommendation in ('possible_match','not_a_match','insufficient_evidence')),
  advisory_score integer not null check (advisory_score between 0 and 100),
  reasons jsonb not null check (jsonb_typeof(reasons)='array' and jsonb_array_length(reasons)<=7),
  evidence_ids jsonb not null check (jsonb_typeof(evidence_ids)='array' and jsonb_array_length(evidence_ids)<=30),
  review_state text not null default 'pending_review'
    check (review_state in ('pending_review','accepted_for_review','rejected','needs_more_evidence')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_reason text check (review_reason is null or length(review_reason)<=1000),
  unique(company_id,id),
  unique(company_id,match_result_id,request_hash),
  foreign key(company_id,match_result_id)
    references public.discovery_match_results(company_id,id) on delete restrict,
  check ((reviewed_by is null and reviewed_at is null and review_reason is null)
      or (reviewed_by is not null and reviewed_at is not null and review_reason is not null))
);
create index if not exists discovery_ai_match_suggestions_queue_idx
  on public.discovery_ai_match_suggestions(company_id,review_state,created_at desc);
create index if not exists discovery_ai_match_suggestions_result_idx
  on public.discovery_ai_match_suggestions(company_id,match_result_id,created_at desc);

create table if not exists public.discovery_ai_match_suggestion_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  suggestion_id uuid not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in ('suggestion_recorded','reviewed')),
  decision text check (decision is null or decision in ('accepted_for_review','rejected','needs_more_evidence')),
  reason text not null check (length(trim(reason)) between 5 and 1000),
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details)='object' and octet_length(details::text)<=4000),
  occurred_at timestamptz not null default now(),
  foreign key(company_id,suggestion_id)
    references public.discovery_ai_match_suggestions(company_id,id) on delete cascade
);
create index if not exists discovery_ai_match_suggestion_events_idx
  on public.discovery_ai_match_suggestion_events(company_id,suggestion_id,occurred_at desc);

alter table public.discovery_ai_match_suggestions enable row level security;
alter table public.discovery_ai_match_suggestion_events enable row level security;
drop policy if exists discovery_ai_match_suggestions_company_read on public.discovery_ai_match_suggestions;
create policy discovery_ai_match_suggestions_company_read on public.discovery_ai_match_suggestions
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists discovery_ai_match_suggestion_events_company_read on public.discovery_ai_match_suggestion_events;
create policy discovery_ai_match_suggestion_events_company_read on public.discovery_ai_match_suggestion_events
  for select to authenticated using (public.is_company_member(company_id));

revoke all on public.discovery_ai_match_suggestions,public.discovery_ai_match_suggestion_events
  from public,anon,authenticated,service_role;
grant select on public.discovery_ai_match_suggestions,public.discovery_ai_match_suggestion_events to authenticated;
grant select,insert,update on public.discovery_ai_match_suggestions to service_role;
grant select,insert on public.discovery_ai_match_suggestion_events to service_role;

create or replace function public.prevent_discovery_ai_match_event_mutation()
returns trigger language plpgsql
as $guard$
begin
  raise exception 'E22 suggestion review history is append-only.';
end;
$guard$;
drop trigger if exists discovery_ai_match_suggestion_events_immutable
  on public.discovery_ai_match_suggestion_events;
create trigger discovery_ai_match_suggestion_events_immutable
  before update or delete on public.discovery_ai_match_suggestion_events
  for each row execute function public.prevent_discovery_ai_match_event_mutation();
revoke update,delete on public.discovery_ai_match_suggestion_events from public,anon,authenticated,service_role;

create or replace view public.discovery_ai_match_suggestion_inbox
with (security_invoker=true) as
select
  s.id,s.company_id,s.match_result_id,s.request_hash,s.policy_version,
  s.provider_id,s.model_version,s.recommendation,s.advisory_score,s.reasons,
  s.evidence_ids,s.review_state,s.created_by,s.created_at,
  s.reviewed_by,s.reviewed_at,s.review_reason,
  m.workspace_key,m.score as deterministic_score,m.confidence as deterministic_confidence,
  m.eligible as deterministic_eligible,m.review_state as deterministic_review_state,
  coalesce(nullif(m.candidate_snapshot->>'legal_name',''),
           nullif(m.candidate_snapshot->>'name',''),'Candidate record') as candidate_label
from public.discovery_ai_match_suggestions s
join public.discovery_match_results m
  on m.company_id=s.company_id and m.id=s.match_result_id
where public.is_company_member(s.company_id);

create or replace view public.discovery_ai_match_suggestion_event_inbox
with (security_invoker=true) as
select id,company_id,suggestion_id,actor_user_id,event_type,decision,reason,details,occurred_at
from public.discovery_ai_match_suggestion_events
where public.is_company_member(company_id);
grant select on public.discovery_ai_match_suggestion_inbox,
  public.discovery_ai_match_suggestion_event_inbox to authenticated,service_role;

create or replace function public.record_discovery_ai_match_suggestion(
  p_company_id uuid,
  p_match_result_id uuid,
  p_request_hash text,
  p_provider_id text,
  p_model_version text,
  p_suggestion jsonb,
  p_evidence_ids jsonb,
  p_reason text default 'Validated E22 advisory suggestion recorded.'
) returns uuid
language plpgsql security definer
set search_path=public,pg_temp
as $record$
declare
  v_id uuid;
  v_item jsonb;
  v_reason jsonb;
  v_allowed_evidence jsonb;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'Only the isolated service process can record validated E22 suggestions.' using errcode='42501';
  end if;
  if p_request_hash is null or p_request_hash !~ '^[a-f0-9]{64}$'
     or p_suggestion->>'requestHash' is distinct from p_request_hash then
    raise exception 'E22 request integrity hash is invalid.' using errcode='22023';
  end if;
  if jsonb_typeof(p_evidence_ids)<>'array' or jsonb_array_length(p_evidence_ids)>30
     or jsonb_typeof(p_suggestion->'reasons')<>'array'
     or jsonb_array_length(p_suggestion->'reasons')>7
     or p_suggestion->>'schemaVersion'<>'axivestra.ai-match-suggestion.v1'
     or p_suggestion->>'policyVersion'<>'e22_advisory_matching_v1'
     or p_suggestion->>'requiresHumanReview'<>'true'
     or p_suggestion->>'automaticDecisionAllowed'<>'false'
     or p_suggestion->>'canonicalMutationAllowed'<>'false'
     or p_suggestion->>'leadPromotionAllowed'<>'false'
     or p_suggestion->>'recommendation' not in ('possible_match','not_a_match','insufficient_evidence')
     or jsonb_typeof(p_suggestion->'advisoryScore')<>'number'
     or (p_suggestion->>'advisoryScore')::numeric<>trunc((p_suggestion->>'advisoryScore')::numeric)
     or (p_suggestion->>'advisoryScore')::numeric not between 0 and 100 then
    raise exception 'E22 validated suggestion contract is invalid.' using errcode='22023';
  end if;
  if length(trim(coalesce(p_provider_id,''))) not between 1 and 80
     or length(trim(coalesce(p_model_version,''))) not between 1 and 120
     or length(trim(coalesce(p_reason,''))) not between 5 and 1000 then
    raise exception 'E22 provider metadata or record reason is invalid.' using errcode='22023';
  end if;
  if not exists(select 1 from public.discovery_match_results
    where company_id=p_company_id and id=p_match_result_id) then
    raise exception 'The company-scoped E11 match result was not found.' using errcode='P0002';
  end if;
  for v_item in select value from jsonb_array_elements(p_evidence_ids) loop
    if jsonb_typeof(v_item)<>'string' or length(v_item#>>'{}') not between 1 and 80 then
      raise exception 'E22 evidence identifiers must be bounded strings.' using errcode='22023';
    end if;
  end loop;
  v_allowed_evidence:=p_evidence_ids;
  for v_reason in select value from jsonb_array_elements(p_suggestion->'reasons') loop
    if jsonb_typeof(v_reason)<>'object'
      or v_reason->>'criterion' not in ('geography','type','ticket','instrument','collateral','stage','mandate')
      or v_reason->>'code' not in ('aligned','misaligned','unknown','needs_verification')
      or jsonb_typeof(v_reason->'evidenceIds')<>'array'
      or exists(select 1 from jsonb_array_elements(v_reason->'evidenceIds') x
        where not (v_allowed_evidence @> jsonb_build_array(x.value))) then
      raise exception 'E22 rationale contains an unapproved criterion, code or evidence reference.' using errcode='22023';
    end if;
  end loop;

  insert into public.discovery_ai_match_suggestions(
    company_id,match_result_id,request_hash,policy_version,provider_id,model_version,
    recommendation,advisory_score,reasons,evidence_ids,created_by
  ) values (
    p_company_id,p_match_result_id,p_request_hash,'e22_advisory_matching_v1',
    trim(p_provider_id),trim(p_model_version),p_suggestion->>'recommendation',
    (p_suggestion->>'advisoryScore')::integer,p_suggestion->'reasons',p_evidence_ids,null
  )
  on conflict(company_id,match_result_id,request_hash) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.discovery_ai_match_suggestions
      where company_id=p_company_id and match_result_id=p_match_result_id and request_hash=p_request_hash;
    return v_id;
  end if;

  insert into public.discovery_ai_match_suggestion_events(
    company_id,suggestion_id,event_type,reason,details
  ) values (
    p_company_id,v_id,'suggestion_recorded',trim(p_reason),
    jsonb_build_object('providerId',trim(p_provider_id),'modelVersion',trim(p_model_version),
      'recommendation',p_suggestion->>'recommendation','advisoryScore',(p_suggestion->>'advisoryScore')::integer)
  );
  return v_id;
end;
$record$;

create or replace function public.review_discovery_ai_match_suggestion(
  p_company_id uuid,p_suggestion_id uuid,p_decision text,p_reason text
) returns uuid
language plpgsql security definer
set search_path=public,pg_temp
as $review$
declare
  v_actor uuid:=auth.uid();
  v_role text;
  v_suggestion public.discovery_ai_match_suggestions%rowtype;
  v_event_id uuid;
begin
  select role into v_role from public.company_memberships
    where company_id=p_company_id and user_id=v_actor;
  if v_actor is null or coalesce(v_role,'') not in ('owner','admin') then
    raise exception 'Only company owners/admins can review E22 suggestions.' using errcode='42501';
  end if;
  if p_decision not in ('accepted_for_review','rejected','needs_more_evidence') then
    raise exception 'Choose an allowed human review decision.' using errcode='22023';
  end if;
  if p_reason is null or p_reason<>trim(p_reason) or length(p_reason) not between 10 and 1000 then
    raise exception 'A review reason of 10–1000 characters is required.' using errcode='22023';
  end if;
  select * into v_suggestion from public.discovery_ai_match_suggestions
    where company_id=p_company_id and id=p_suggestion_id for update;
  if not found or v_suggestion.review_state<>'pending_review' then
    raise exception 'Only a pending E22 suggestion can be reviewed.' using errcode='55000';
  end if;
  update public.discovery_ai_match_suggestions
    set review_state=p_decision,reviewed_by=v_actor,reviewed_at=clock_timestamp(),review_reason=p_reason
    where company_id=p_company_id and id=p_suggestion_id;
  insert into public.discovery_ai_match_suggestion_events(
    company_id,suggestion_id,actor_user_id,event_type,decision,reason,details
  ) values (
    p_company_id,p_suggestion_id,v_actor,'reviewed',p_decision,p_reason,
    jsonb_build_object('reviewerRole',v_role)
  ) returning id into v_event_id;
  return v_event_id;
end;
$review$;

revoke all on function public.record_discovery_ai_match_suggestion(uuid,uuid,text,text,text,jsonb,jsonb,text)
  from public,anon,authenticated;
grant execute on function public.record_discovery_ai_match_suggestion(uuid,uuid,text,text,text,jsonb,jsonb,text)
  to service_role;
revoke all on function public.review_discovery_ai_match_suggestion(uuid,uuid,text,text)
  from public,anon,service_role;
grant execute on function public.review_discovery_ai_match_suggestion(uuid,uuid,text,text)
  to authenticated;

comment on table public.discovery_ai_match_suggestions is
  'E22 validated advisory suggestions. No AI suggestion approves, rejects, mutates canonical data or promotes a lead.';
comment on table public.discovery_ai_match_suggestion_events is
  'E22 append-only suggestion creation and owner/admin review history.';
comment on view public.discovery_ai_match_suggestion_inbox is
  'Company-scoped E22 review queue joined to the authoritative E11 deterministic baseline.';
commit;
