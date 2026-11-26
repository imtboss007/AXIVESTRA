-- AXIVESTRA E15: human-reviewed lead pipeline and company workspace workflow.
-- No outreach, lending decision, underwriting or automated conversion is performed.
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
    'discovery_match_review_recorded','discovery_lead_created','discovery_lead_assigned',
    'discovery_lead_status_changed','discovery_lead_priority_changed','discovery_lead_next_action_set'
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
    'privacy_subject','privacy_retention_job','discovery_match_review','discovery_lead'
  ));

-- Extend E13's constrained vocabulary rather than creating a parallel provenance system.
do $e15_provenance_checks$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid='public.discovery_provenance_events'::regclass
      and contype='c' and (
        pg_get_constraintdef(oid) ilike '%subject_kind%'
        or pg_get_constraintdef(oid) ilike '%event_type%'
        or pg_get_constraintdef(oid) ilike '%origin_table%'
      )
  loop
    execute format('alter table public.discovery_provenance_events drop constraint %I',r.conname);
  end loop;
end;
$e15_provenance_checks$;

alter table public.discovery_provenance_events
  add constraint discovery_provenance_events_subject_kind_e15_check check (subject_kind in (
    'source','evidence','extracted_fact','extracted_entity','canonical_entity',
    'entity_assignment','entity_identifier','entity_alias','entity_relationship',
    'professional_role_candidate','professional_role_assignment',
    'contact_candidate','contact_point','place_candidate','match_result',
    'deduplication_candidate','enrichment_observation','enrichment_conflict',
    'lead','lead_match_review'
  )),
  add constraint discovery_provenance_events_event_type_e15_check check (event_type in (
    'source_registered','source_approved','source_paused','source_rejected',
    'evidence_captured','source_observed','extraction_reviewed','canonical_entity_created',
    'entity_assigned','identifier_recorded','alias_recorded',
    'relationship_recorded','professional_role_observed','professional_role_assigned',
    'professional_role_reviewed','contact_candidate_observed','contact_point_recorded',
    'place_candidate_observed','place_reviewed','match_score_recorded',
    'deduplication_candidate_created','deduplication_reviewed','enrichment_observed',
    'enrichment_observation_reviewed','enrichment_conflict_reviewed',
    'evidence_retention_purged','lead_match_reviewed','lead_created','lead_assigned',
    'lead_status_changed','lead_priority_changed','lead_next_action_set'
  )),
  add constraint discovery_provenance_events_origin_table_e15_check check (origin_table in (
    'discovery_audit_events','discovery_evidence_items','discovery_fetch_events',
    'discovery_extracted_entities','discovery_extracted_facts','discovery_extraction_review_events',
    'discovery_canonical_entities','discovery_entity_assignments','discovery_entity_identifiers',
    'discovery_entity_aliases','discovery_entity_relationships',
    'discovery_professional_role_candidates','discovery_professional_role_assignments',
    'discovery_professional_role_review_events','discovery_contact_candidates',
    'discovery_contact_points','discovery_place_candidates',
    'discovery_place_resolution_events','discovery_enrichment_observations',
    'discovery_enrichment_review_events','discovery_match_results',
    'discovery_deduplication_candidates','discovery_deduplication_review_events',
    'discovery_lead_match_reviews','discovery_lead_events'
  ));

create table if not exists public.discovery_leads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  match_result_id uuid not null,
  canonical_entity_id uuid not null,
  workspace_key text not null check (length(trim(workspace_key)) between 1 and 100),
  status text not null default 'inbox' check (status in (
    'inbox','reviewing','qualified','due_diligence','proposal',
    'negotiation','on_hold','won','lost','disqualified'
  )),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  assigned_to uuid references auth.users(id) on delete restrict,
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz,
  next_action_code text not null default 'none' check (next_action_code in (
    'none','review_company_profile','verify_registration','review_evidence',
    'request_internal_documents','prepare_internal_brief',
    'schedule_internal_review','confirm_eligibility'
  )),
  next_action_due_at timestamptz,
  close_reason_code text check (close_reason_code is null or close_reason_code in (
    'deal_won','deal_lost','not_a_fit'
  )),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  unique(company_id,id),
  unique(company_id,match_result_id),
  foreign key(company_id,match_result_id)
    references public.discovery_match_results(company_id,id) on delete restrict,
  foreign key(company_id,canonical_entity_id)
    references public.discovery_canonical_entities(company_id,id) on delete restrict,
  check ((assigned_to is null and assigned_at is null) or (assigned_to is not null and assigned_at is not null)),
  check ((next_action_code='none' and next_action_due_at is null) or next_action_code<>'none'),
  check ((status in ('won','lost','disqualified') and closed_at is not null)
      or (status not in ('won','lost','disqualified') and closed_at is null)),
  check ((status in ('won','lost','disqualified') and close_reason_code is not null)
      or (status not in ('won','lost','disqualified') and close_reason_code is null))
);
create index if not exists discovery_leads_pipeline_idx
  on public.discovery_leads(company_id,workspace_key,status,priority,updated_at desc);
create index if not exists discovery_leads_assignee_idx
  on public.discovery_leads(company_id,assigned_to,status,updated_at desc);

create table if not exists public.discovery_lead_match_reviews (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  match_result_id uuid not null,
  decision text not null check (decision in ('accepted_for_review','rejected')),
  reason_code text not null check (reason_code in (
    'match_confirmed','insufficient_evidence','policy_mismatch',
    'duplicate_candidate','out_of_scope','other_review'
  )),
  lead_id uuid,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  occurred_at timestamptz not null default now(),
  unique(company_id,id),
  unique(company_id,match_result_id),
  foreign key(company_id,match_result_id)
    references public.discovery_match_results(company_id,id) on delete restrict
);
create index if not exists discovery_lead_match_reviews_company_idx
  on public.discovery_lead_match_reviews(company_id,occurred_at desc);

create table if not exists public.discovery_lead_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  lead_id uuid not null,
  event_type text not null check (event_type in (
    'lead_created','lead_assigned','lead_status_changed',
    'lead_priority_changed','lead_next_action_set'
  )),
  previous_status text,
  new_status text,
  previous_priority text,
  new_priority text,
  previous_assignee_id uuid,
  new_assignee_id uuid,
  reason_code text not null check (reason_code in (
    'match_confirmed','assignment_change','reassignment','unassigned',
    'stage_progress','deal_won','deal_lost','not_a_fit',
    'awaiting_information','capacity_hold','reopened','priority_review','next_action_review'
  )),
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details)='object' and octet_length(details::text)<=2000),
  actor_user_id uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now(),
  unique(company_id,id),
  foreign key(company_id,lead_id)
    references public.discovery_leads(company_id,id) on delete cascade
);
create index if not exists discovery_lead_events_lead_idx
  on public.discovery_lead_events(company_id,lead_id,occurred_at desc);

alter table public.discovery_leads enable row level security;
alter table public.discovery_lead_match_reviews enable row level security;
alter table public.discovery_lead_events enable row level security;

drop policy if exists discovery_leads_company_read on public.discovery_leads;
create policy discovery_leads_company_read on public.discovery_leads
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists discovery_lead_match_reviews_company_read on public.discovery_lead_match_reviews;
create policy discovery_lead_match_reviews_company_read on public.discovery_lead_match_reviews
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists discovery_lead_events_company_read on public.discovery_lead_events;
create policy discovery_lead_events_company_read on public.discovery_lead_events
  for select to authenticated using (public.is_company_member(company_id));

revoke all on public.discovery_leads,public.discovery_lead_match_reviews,public.discovery_lead_events
  from public,anon,authenticated,service_role;
grant select on public.discovery_leads,public.discovery_lead_match_reviews,public.discovery_lead_events
  to authenticated,service_role;

create or replace function public.prevent_discovery_lead_event_mutation()
returns trigger language plpgsql
as $guard$
begin
  if pg_trigger_depth()>1 then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  raise exception 'E15 lead review and workflow events are immutable; append a new event instead.';
end;
$guard$;
drop trigger if exists discovery_lead_match_reviews_no_mutation on public.discovery_lead_match_reviews;
create trigger discovery_lead_match_reviews_no_mutation
  before update or delete on public.discovery_lead_match_reviews
  for each row execute function public.prevent_discovery_lead_event_mutation();
drop trigger if exists discovery_lead_events_no_mutation on public.discovery_lead_events;
create trigger discovery_lead_events_no_mutation
  before update or delete on public.discovery_lead_events
  for each row execute function public.prevent_discovery_lead_event_mutation();

create or replace function public.record_discovery_match_review(
  p_company_id uuid,p_actor_user_id uuid,p_match_result_id uuid,
  p_decision text,p_reason_code text
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $review$
declare
  v_role text;
  v_match public.discovery_match_results%rowtype;
  v_review public.discovery_lead_match_reviews%rowtype;
  v_lead public.discovery_leads%rowtype;
  v_event public.discovery_lead_events%rowtype;
begin
  select role into v_role from public.company_memberships
    where company_id=p_company_id and user_id=p_actor_user_id for share;
  if v_role is null or v_role not in ('owner','admin') then
    raise exception 'Only a company owner or admin can review workspace matches' using errcode='42501';
  end if;
  if p_decision is null or p_reason_code is null
    or p_decision not in ('accepted_for_review','rejected')
    or p_reason_code not in ('match_confirmed','insufficient_evidence','policy_mismatch',
      'duplicate_candidate','out_of_scope','other_review') then
    raise exception 'E15 match decision and reason code are required' using errcode='22023';
  end if;
  if (p_decision='accepted_for_review' and p_reason_code<>'match_confirmed')
    or (p_decision='rejected' and p_reason_code='match_confirmed') then
    raise exception 'E15 match review reason must agree with the decision' using errcode='22023';
  end if;
  select * into v_match from public.discovery_match_results
    where company_id=p_company_id and id=p_match_result_id and review_state='pending_review'
    for update;
  if not found then raise exception 'E15 match is missing, outside the company or already reviewed' using errcode='P0002'; end if;
  if p_decision='accepted_for_review' and v_match.eligible is not true then
    raise exception 'E15 ineligible matches cannot enter the lead pipeline' using errcode='42501';
  end if;

  update public.discovery_match_results set review_state=p_decision
    where company_id=p_company_id and id=v_match.id;

  if p_decision='accepted_for_review' then
    insert into public.discovery_leads(
      company_id,match_result_id,canonical_entity_id,workspace_key,created_by
    ) values(
      p_company_id,v_match.id,v_match.canonical_entity_id,v_match.workspace_key,p_actor_user_id
    ) returning * into v_lead;

    insert into public.discovery_lead_events(
      company_id,lead_id,event_type,new_status,reason_code,details,actor_user_id
    ) values(
      p_company_id,v_lead.id,'lead_created','inbox','match_confirmed',
      jsonb_build_object('matchResultId',v_match.id,'workspaceKey',v_match.workspace_key),
      p_actor_user_id
    ) returning * into v_event;

    perform public.append_discovery_provenance_event(
      p_company_id,'discovery_lead_events',v_event.id,'lead',v_lead.id,
      'lead_created','lead_pipeline','inbox',null,null,null,'{}'::jsonb,
      p_actor_user_id,jsonb_build_object('matchResultId',v_match.id,'workspaceKey',v_match.workspace_key),
      '{}'::jsonb
    );
  end if;

  insert into public.discovery_lead_match_reviews(
    company_id,match_result_id,decision,reason_code,lead_id,actor_user_id
  ) values(
    p_company_id,v_match.id,p_decision,p_reason_code,
    case when p_decision='accepted_for_review' then v_lead.id else null end,p_actor_user_id
  ) returning * into v_review;

  perform public.append_discovery_provenance_event(
    p_company_id,'discovery_lead_match_reviews',v_review.id,'lead_match_review',v_review.id,
    'lead_match_reviewed','match_review',p_decision,null,null,null,'{}'::jsonb,
    p_actor_user_id,jsonb_build_object('matchResultId',v_match.id,'leadId',v_lead.id,'reasonCode',p_reason_code),
    '{}'::jsonb
  );

  insert into public.discovery_audit_events(company_id,actor_user_id,action,entity_type,entity_id,details)
  values(p_company_id,p_actor_user_id,'discovery_match_review_recorded','discovery_match_review',v_review.id,
    jsonb_build_object('matchResultId',v_match.id,'decision',p_decision,'reasonCode',p_reason_code));
  if p_decision='accepted_for_review' then
    insert into public.discovery_audit_events(company_id,actor_user_id,action,entity_type,entity_id,details)
    values(p_company_id,p_actor_user_id,'discovery_lead_created','discovery_lead',v_lead.id,
      jsonb_build_object('matchResultId',v_match.id,'workspaceKey',v_match.workspace_key));
  end if;

  return jsonb_build_object('review',to_jsonb(v_review),
    'lead',case when p_decision='accepted_for_review' then to_jsonb(v_lead) else null end);
end;
$review$;

create or replace function public.assign_discovery_lead(
  p_company_id uuid,p_actor_user_id uuid,p_lead_id uuid,
  p_assignee_id uuid,p_reason_code text
) returns public.discovery_leads
language plpgsql security definer set search_path=public,pg_temp
as $assign$
declare v_role text; v_lead public.discovery_leads%rowtype; v_event public.discovery_lead_events%rowtype;
  v_previous_assignee uuid;
begin
  select role into v_role from public.company_memberships
    where company_id=p_company_id and user_id=p_actor_user_id for share;
  if v_role is null or v_role not in ('owner','admin') then
    raise exception 'Only a company owner or admin can assign discovery leads' using errcode='42501';
  end if;
  if p_reason_code is null or p_reason_code not in ('assignment_change','reassignment','unassigned') then
    raise exception 'E15 assignment reason code is invalid' using errcode='22023';
  end if;
  if (p_assignee_id is null and p_reason_code<>'unassigned')
    or (p_assignee_id is not null and p_reason_code='unassigned') then
    raise exception 'E15 assignment reason does not match the requested assignee' using errcode='22023';
  end if;
  if p_assignee_id is not null and not exists(
    select 1 from public.company_memberships where company_id=p_company_id and user_id=p_assignee_id
  ) then raise exception 'E15 assignee must be a member of this company' using errcode='42501'; end if;
  select * into v_lead from public.discovery_leads
    where company_id=p_company_id and id=p_lead_id for update;
  if not found then raise exception 'E15 lead was not found in this company' using errcode='P0002'; end if;
  v_previous_assignee:=v_lead.assigned_to;

  update public.discovery_leads set assigned_to=p_assignee_id,
    assigned_by=case when p_assignee_id is null then null else p_actor_user_id end,
    assigned_at=case when p_assignee_id is null then null else clock_timestamp() end,
    updated_at=clock_timestamp()
  where company_id=p_company_id and id=p_lead_id returning * into v_lead;

  insert into public.discovery_lead_events(
    company_id,lead_id,event_type,previous_assignee_id,new_assignee_id,
    reason_code,details,actor_user_id
  ) values(
    p_company_id,p_lead_id,'lead_assigned',v_previous_assignee,p_assignee_id,
    p_reason_code,jsonb_build_object('assigneeChanged',true),p_actor_user_id
  ) returning * into v_event;

  perform public.append_discovery_provenance_event(
    p_company_id,'discovery_lead_events',v_event.id,'lead',p_lead_id,
    'lead_assigned','assigned_to',case when p_assignee_id is null then 'unassigned' else 'assigned' end,
    null,null,null,'{}'::jsonb,p_actor_user_id,
    jsonb_build_object('assigneeId',p_assignee_id,'reasonCode',p_reason_code),'{}'::jsonb
  );
  insert into public.discovery_audit_events(company_id,actor_user_id,action,entity_type,entity_id,details)
  values(p_company_id,p_actor_user_id,'discovery_lead_assigned','discovery_lead',p_lead_id,
    jsonb_build_object('assigneeId',p_assignee_id,'reasonCode',p_reason_code));
  return v_lead;
end;
$assign$;

create or replace function public.transition_discovery_lead(
  p_company_id uuid,p_actor_user_id uuid,p_lead_id uuid,
  p_new_status text,p_reason_code text
) returns public.discovery_leads
language plpgsql security definer set search_path=public,pg_temp
as $transition$
declare v_role text; v_lead public.discovery_leads%rowtype; v_old_status text;
  v_event public.discovery_lead_events%rowtype;
begin
  select role into v_role from public.company_memberships
    where company_id=p_company_id and user_id=p_actor_user_id for share;
  if v_role is null or v_role not in ('owner','admin') then
    raise exception 'Only a company owner or admin can change discovery lead stages' using errcode='42501';
  end if;
  if p_new_status is null or p_reason_code is null
    or p_new_status not in ('inbox','reviewing','qualified','due_diligence','proposal',
    'negotiation','on_hold','won','lost','disqualified')
    or p_reason_code not in ('stage_progress','deal_won','deal_lost','not_a_fit',
      'awaiting_information','capacity_hold','reopened') then
    raise exception 'E15 lead status or reason code is invalid' using errcode='22023';
  end if;
  select * into v_lead from public.discovery_leads
    where company_id=p_company_id and id=p_lead_id for update;
  if not found then raise exception 'E15 lead was not found in this company' using errcode='P0002'; end if;
  v_old_status:=v_lead.status;
  if v_old_status=p_new_status then return v_lead; end if;

  if v_old_status in ('won','lost','disqualified') then
    if p_new_status<>'reviewing' or p_reason_code<>'reopened' then
      raise exception 'E15 terminal leads can only be reopened to reviewing with an explicit reason' using errcode='42501';
    end if;
  else
    if not (
      (v_old_status='inbox' and p_new_status in ('reviewing','on_hold','disqualified')) or
      (v_old_status='reviewing' and p_new_status in ('qualified','due_diligence','on_hold','disqualified')) or
      (v_old_status='qualified' and p_new_status in ('due_diligence','proposal','on_hold','disqualified')) or
      (v_old_status='due_diligence' and p_new_status in ('proposal','negotiation','on_hold','disqualified')) or
      (v_old_status='proposal' and p_new_status in ('negotiation','won','lost','on_hold')) or
      (v_old_status='negotiation' and p_new_status in ('won','lost','on_hold')) or
      (v_old_status='on_hold' and p_new_status in ('reviewing','qualified','due_diligence','proposal','negotiation','disqualified'))
    ) then raise exception 'E15 lead stage transition is not allowed' using errcode='42501'; end if;
    if p_new_status='won' and p_reason_code<>'deal_won' then
      raise exception 'E15 a won lead requires the deal_won reason code' using errcode='22023'; end if;
    if p_new_status='lost' and p_reason_code<>'deal_lost' then
      raise exception 'E15 a lost lead requires the deal_lost reason code' using errcode='22023'; end if;
    if p_new_status='disqualified' and p_reason_code<>'not_a_fit' then
      raise exception 'E15 a disqualified lead requires the not_a_fit reason code' using errcode='22023'; end if;
    if p_new_status='on_hold' and p_reason_code not in ('awaiting_information','capacity_hold') then
      raise exception 'E15 an on-hold lead requires an explicit hold reason code' using errcode='22023'; end if;
  end if;

  update public.discovery_leads set status=p_new_status,
    closed_at=case when p_new_status in ('won','lost','disqualified') then clock_timestamp() else null end,
    close_reason_code=case when p_new_status in ('won','lost','disqualified') then
      case when p_new_status='won' then 'deal_won' when p_new_status='lost' then 'deal_lost' else 'not_a_fit' end
      else null end,
    updated_at=clock_timestamp()
  where company_id=p_company_id and id=p_lead_id returning * into v_lead;

  insert into public.discovery_lead_events(
    company_id,lead_id,event_type,previous_status,new_status,reason_code,details,actor_user_id
  ) values(
    p_company_id,p_lead_id,'lead_status_changed',v_old_status,p_new_status,p_reason_code,
    jsonb_build_object('reopened',p_reason_code='reopened'),p_actor_user_id
  ) returning * into v_event;

  perform public.append_discovery_provenance_event(
    p_company_id,'discovery_lead_events',v_event.id,
    'lead',p_lead_id,'lead_status_changed','lead_status',p_new_status,null,null,null,'{}'::jsonb,
    p_actor_user_id,jsonb_build_object('previousStatus',v_old_status,'reasonCode',p_reason_code),'{}'::jsonb
  );
  insert into public.discovery_audit_events(company_id,actor_user_id,action,entity_type,entity_id,details)
  values(p_company_id,p_actor_user_id,'discovery_lead_status_changed','discovery_lead',p_lead_id,
    jsonb_build_object('previousStatus',v_old_status,'newStatus',p_new_status,'reasonCode',p_reason_code));
  return v_lead;
end;
$transition$;

create or replace function public.set_discovery_lead_priority(
  p_company_id uuid,p_actor_user_id uuid,p_lead_id uuid,p_priority text
) returns public.discovery_leads
language plpgsql security definer set search_path=public,pg_temp
as $priority$
declare v_role text; v_lead public.discovery_leads%rowtype; v_old_priority text; v_event public.discovery_lead_events%rowtype;
begin
  select role into v_role from public.company_memberships
    where company_id=p_company_id and user_id=p_actor_user_id for share;
  if v_role is null or v_role not in ('owner','admin') then
    raise exception 'Only a company owner or admin can change discovery lead priority' using errcode='42501';
  end if;
  if p_priority is null or p_priority not in ('low','normal','high','urgent') then
    raise exception 'E15 lead priority is invalid' using errcode='22023'; end if;
  select * into v_lead from public.discovery_leads where company_id=p_company_id and id=p_lead_id for update;
  if not found then raise exception 'E15 lead was not found in this company' using errcode='P0002'; end if;
  v_old_priority:=v_lead.priority;
  if v_old_priority=p_priority then return v_lead; end if;
  update public.discovery_leads set priority=p_priority,updated_at=clock_timestamp()
    where company_id=p_company_id and id=p_lead_id returning * into v_lead;
  insert into public.discovery_lead_events(company_id,lead_id,event_type,previous_priority,new_priority,reason_code,details,actor_user_id)
  values(p_company_id,p_lead_id,'lead_priority_changed',v_old_priority,p_priority,'priority_review',
    jsonb_build_object('priorityChanged',true),p_actor_user_id) returning * into v_event;
  perform public.append_discovery_provenance_event(
    p_company_id,'discovery_lead_events',v_event.id,'lead',p_lead_id,
    'lead_priority_changed','lead_priority',p_priority,null,null,null,'{}'::jsonb,
    p_actor_user_id,jsonb_build_object('previousPriority',v_old_priority),'{}'::jsonb
  );
  insert into public.discovery_audit_events(company_id,actor_user_id,action,entity_type,entity_id,details)
  values(p_company_id,p_actor_user_id,'discovery_lead_priority_changed','discovery_lead',p_lead_id,
    jsonb_build_object('previousPriority',v_old_priority,'priority',p_priority));
  return v_lead;
end;
$priority$;

create or replace function public.set_discovery_lead_next_action(
  p_company_id uuid,p_actor_user_id uuid,p_lead_id uuid,
  p_next_action_code text,p_due_at timestamptz
) returns public.discovery_leads
language plpgsql security definer set search_path=public,pg_temp
as $next_action$
declare v_role text; v_lead public.discovery_leads%rowtype; v_event public.discovery_lead_events%rowtype;
begin
  select role into v_role from public.company_memberships
    where company_id=p_company_id and user_id=p_actor_user_id for share;
  if v_role is null or v_role not in ('owner','admin') then
    raise exception 'Only a company owner or admin can set discovery lead next actions' using errcode='42501';
  end if;
  if p_next_action_code is null or p_next_action_code not in (
    'none','review_company_profile','verify_registration','review_evidence',
    'request_internal_documents','prepare_internal_brief','schedule_internal_review','confirm_eligibility'
  ) or (p_next_action_code='none' and p_due_at is not null) then
    raise exception 'E15 next action code or due date is invalid' using errcode='22023'; end if;
  select * into v_lead from public.discovery_leads where company_id=p_company_id and id=p_lead_id for update;
  if not found then raise exception 'E15 lead was not found in this company' using errcode='P0002'; end if;
  update public.discovery_leads set next_action_code=p_next_action_code,
    next_action_due_at=p_due_at,updated_at=clock_timestamp()
    where company_id=p_company_id and id=p_lead_id returning * into v_lead;
  insert into public.discovery_lead_events(company_id,lead_id,event_type,reason_code,details,actor_user_id)
  values(p_company_id,p_lead_id,'lead_next_action_set','next_action_review',
    jsonb_build_object('nextActionCode',p_next_action_code,'dueAt',p_due_at),p_actor_user_id)
    returning * into v_event;
  perform public.append_discovery_provenance_event(
    p_company_id,'discovery_lead_events',v_event.id,'lead',p_lead_id,
    'lead_next_action_set','next_action_code',p_next_action_code,null,null,null,'{}'::jsonb,
    p_actor_user_id,jsonb_build_object('dueAt',p_due_at),'{}'::jsonb
  );
  insert into public.discovery_audit_events(company_id,actor_user_id,action,entity_type,entity_id,details)
  values(p_company_id,p_actor_user_id,'discovery_lead_next_action_set','discovery_lead',p_lead_id,
    jsonb_build_object('nextActionCode',p_next_action_code,'dueAt',p_due_at));
  return v_lead;
end;
$next_action$;

revoke all on function public.record_discovery_match_review(uuid,uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.assign_discovery_lead(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.transition_discovery_lead(uuid,uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.set_discovery_lead_priority(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.set_discovery_lead_next_action(uuid,uuid,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.record_discovery_match_review(uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.assign_discovery_lead(uuid,uuid,uuid,uuid,text) to service_role;
grant execute on function public.transition_discovery_lead(uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.set_discovery_lead_priority(uuid,uuid,uuid,text) to service_role;
grant execute on function public.set_discovery_lead_next_action(uuid,uuid,uuid,text,timestamptz) to service_role;

comment on table public.discovery_leads is
  'E15 human-qualified company leads derived only from owner/admin-accepted E11 workspace matches. No outreach or automated financial decision.';
comment on table public.discovery_lead_events is
  'E15 immutable company-scoped workflow history for lead assignment, stage, priority and next-action changes.';
comment on table public.discovery_lead_match_reviews is
  'E15 immutable owner/admin match review receipts. Only accepted-for-review matches create a lead.';

commit;
