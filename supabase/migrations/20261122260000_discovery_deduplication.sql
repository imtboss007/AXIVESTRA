-- AXIVESTRA E12: deterministic duplicate candidates and reviewed legal-entity graph.
-- No automatic merge, deletion, identity rewrite or contact-value disclosure is performed.
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
    'match_score_recorded','deduplication_review_recorded'
  ));
alter table public.discovery_audit_events
  drop constraint if exists discovery_audit_events_entity_type_check;
alter table public.discovery_audit_events
  add constraint discovery_audit_events_entity_type_check check (entity_type in (
    'source','profile','profile_source','discovery_job','discovery_worker_control',
    'extraction_review_event','entity_resolution_candidate','canonical_entity',
    'entity_relationship','professional_role_candidate','professional_person',
    'contact_point','place_candidate','enrichment_observation','enrichment_conflict',
    'match_result','deduplication_candidate'
  ));

create table if not exists public.discovery_deduplication_candidates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  candidate_kind text not null check (candidate_kind in ('organization','professional_person','contact_point')),
  match_rule text not null check (match_rule in (
    'exact_registry_identifier','exact_legal_name','exact_alias',
    'same_employer_role','exact_contact_fingerprint'
  )),
  left_record_id uuid not null,
  right_record_id uuid not null,
  strength text not null check (strength in ('strong','medium')),
  rationale text not null check (length(trim(rationale)) between 1 and 1000),
  evidence_refs jsonb not null default '[]'::jsonb
    check (jsonb_typeof(evidence_refs)='array' and octet_length(evidence_refs::text)<=12000),
  review_state text not null default 'pending_review'
    check (review_state in ('pending_review','confirmed_duplicate','not_duplicate','escalated')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique(company_id,id),
  unique(company_id,candidate_kind,match_rule,left_record_id,right_record_id),
  check (left_record_id < right_record_id),
  check (left_record_id <> right_record_id)
);
create index if not exists discovery_deduplication_review_idx
  on public.discovery_deduplication_candidates(company_id,review_state,created_at desc);
create index if not exists discovery_deduplication_pair_idx
  on public.discovery_deduplication_candidates(company_id,candidate_kind,left_record_id,right_record_id);

create table if not exists public.discovery_deduplication_review_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  candidate_id uuid,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  candidate_kind text not null check (candidate_kind in ('organization','professional_person','contact_point')),
  match_rule text not null check (match_rule in (
    'exact_registry_identifier','exact_legal_name','exact_alias',
    'same_employer_role','exact_contact_fingerprint'
  )),
  left_record_id uuid not null,
  right_record_id uuid not null,
  decision text not null check (decision in ('confirmed_duplicate','not_duplicate','escalated')),
  reason text not null check (length(trim(reason)) between 1 and 1000),
  occurred_at timestamptz not null default now(),
  unique(company_id,id)
);
create index if not exists discovery_deduplication_review_events_candidate_idx
  on public.discovery_deduplication_review_events(company_id,candidate_id,occurred_at desc);

alter table public.discovery_deduplication_candidates enable row level security;
alter table public.discovery_deduplication_review_events enable row level security;
drop policy if exists discovery_deduplication_candidates_company_read on public.discovery_deduplication_candidates;
create policy discovery_deduplication_candidates_company_read
  on public.discovery_deduplication_candidates for select to authenticated
  using (public.is_company_member(company_id));
drop policy if exists discovery_deduplication_events_company_read on public.discovery_deduplication_review_events;
create policy discovery_deduplication_events_company_read
  on public.discovery_deduplication_review_events for select to authenticated
  using (public.is_company_member(company_id));
revoke all on public.discovery_deduplication_candidates,public.discovery_deduplication_review_events
  from public,anon,authenticated;
grant select on public.discovery_deduplication_candidates,public.discovery_deduplication_review_events
  to authenticated;
grant all on public.discovery_deduplication_candidates,public.discovery_deduplication_review_events
  to service_role;

-- Canonical organization nodes and owner-accepted legal-group edges form the
-- explicit graph. Unreviewed relationship suggestions are not graph edges.
drop policy if exists discovery_canonical_entities_company_read on public.discovery_canonical_entities;
create policy discovery_canonical_entities_company_read on public.discovery_canonical_entities
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists discovery_entity_relationships_company_read on public.discovery_entity_relationships;
create policy discovery_entity_relationships_company_read on public.discovery_entity_relationships
  for select to authenticated using (public.is_company_member(company_id));
grant select on public.discovery_canonical_entities,public.discovery_entity_relationships to authenticated;

create or replace view public.discovery_entity_graph_nodes
with (security_invoker=true) as
select company_id,id,legal_name,normalized_name,jurisdiction,entity_type,status
from public.discovery_canonical_entities
where status='active';

create or replace view public.discovery_entity_graph_edges
with (security_invoker=true) as
select company_id,id,from_entity_id,to_entity_id,relationship_type,
       evidence_id,source_span,created_at
from public.discovery_entity_relationships
where review_state='owner_accepted';

grant select on public.discovery_entity_graph_nodes,public.discovery_entity_graph_edges to authenticated;

-- This function compares only same-company records and stores references/rationales,
-- never raw contact values or HMAC fingerprints. It is idempotent.
create or replace function public.generate_discovery_deduplication_candidates(p_company_id uuid)
returns integer
language plpgsql security definer
set search_path=public,pg_temp
as $generate$
declare
  v_added integer;
  v_total integer:=0;
begin
  if p_company_id is null or not exists(select 1 from public.companies where id=p_company_id) then
    raise exception 'A valid company scope is required for E12' using errcode='22023';
  end if;

  insert into public.discovery_deduplication_candidates(
    company_id,candidate_kind,match_rule,left_record_id,right_record_id,
    strength,rationale,evidence_refs
  )
  select p_company_id,'organization','exact_registry_identifier',
    least(a.canonical_entity_id,b.canonical_entity_id),
    greatest(a.canonical_entity_id,b.canonical_entity_id),'strong',
    'The same scheme, jurisdiction and normalized registry identifier is recorded for both organizations. Verify source records before treating them as one entity.',
    jsonb_build_array(jsonb_build_object('leftIdentifierId',a.id,'rightIdentifierId',b.id,'scheme',a.scheme,'jurisdiction',a.jurisdiction))
  from public.discovery_entity_identifiers a
  join public.discovery_entity_identifiers b
    on b.company_id=a.company_id and b.scheme=a.scheme and b.jurisdiction=a.jurisdiction
    and b.normalized_value=a.normalized_value and b.canonical_entity_id>a.canonical_entity_id
  join public.discovery_canonical_entities ca
    on ca.company_id=a.company_id and ca.id=a.canonical_entity_id and ca.status='active'
  join public.discovery_canonical_entities cb
    on cb.company_id=b.company_id and cb.id=b.canonical_entity_id and cb.status='active'
  where a.company_id=p_company_id
    and a.review_state in ('owner_accepted','needs_verification')
    and b.review_state in ('owner_accepted','needs_verification')
  on conflict(company_id,candidate_kind,match_rule,left_record_id,right_record_id) do nothing;
  get diagnostics v_added=row_count; v_total:=v_total+v_added;

  insert into public.discovery_deduplication_candidates(
    company_id,candidate_kind,match_rule,left_record_id,right_record_id,
    strength,rationale,evidence_refs
  )
  select p_company_id,'organization','exact_legal_name',a.id,b.id,'medium',
    'The same normalized legal name appears in the same jurisdiction. A name match alone does not establish legal identity.',
    '[]'::jsonb
  from public.discovery_canonical_entities a
  join public.discovery_canonical_entities b
    on b.company_id=a.company_id and b.jurisdiction=a.jurisdiction
    and b.normalized_name=a.normalized_name and b.id>a.id and b.status='active'
  where a.company_id=p_company_id and a.status='active'
  on conflict(company_id,candidate_kind,match_rule,left_record_id,right_record_id) do nothing;
  get diagnostics v_added=row_count; v_total:=v_total+v_added;

  insert into public.discovery_deduplication_candidates(
    company_id,candidate_kind,match_rule,left_record_id,right_record_id,
    strength,rationale,evidence_refs
  )
  select p_company_id,'organization','exact_alias',least(a.canonical_entity_id,b.canonical_entity_id),
    greatest(a.canonical_entity_id,b.canonical_entity_id),'medium',
    'The same owner-reviewed alias is attached to different organizations in the same jurisdiction. Review alias provenance and legal-group context.',
    jsonb_build_array(jsonb_build_object('leftAliasId',a.id,'rightAliasId',b.id))
  from public.discovery_entity_aliases a
  join public.discovery_entity_aliases b
    on b.company_id=a.company_id and b.normalized_alias=a.normalized_alias
    and b.canonical_entity_id>a.canonical_entity_id
  join public.discovery_canonical_entities ca
    on ca.company_id=a.company_id and ca.id=a.canonical_entity_id and ca.status='active'
  join public.discovery_canonical_entities cb
    on cb.company_id=b.company_id and cb.id=b.canonical_entity_id and cb.status='active'
    and cb.jurisdiction=ca.jurisdiction
  where a.company_id=p_company_id and a.review_state='owner_accepted'
    and b.review_state='owner_accepted' and a.canonical_entity_id<>b.canonical_entity_id
  on conflict(company_id,candidate_kind,match_rule,left_record_id,right_record_id) do nothing;
  get diagnostics v_added=row_count; v_total:=v_total+v_added;

  insert into public.discovery_deduplication_candidates(
    company_id,candidate_kind,match_rule,left_record_id,right_record_id,
    strength,rationale,evidence_refs
  )
  select p_company_id,'professional_person','same_employer_role',p1.id,p2.id,'medium',
    'The same normalized professional name has overlapping assignments for the same employer and role. This is a review candidate, not proof of identity.',
    jsonb_build_array(jsonb_build_object('leftRoleAssignmentId',r1.id,'rightRoleAssignmentId',r2.id))
  from public.discovery_professional_role_assignments r1
  join public.discovery_professional_role_assignments r2
    on r2.company_id=r1.company_id and r2.canonical_entity_id=r1.canonical_entity_id
    and lower(trim(r2.role_title))=lower(trim(r1.role_title)) and r2.id>r1.id
    and coalesce(r1.valid_to,'infinity'::date)>=coalesce(r2.valid_from,'-infinity'::date)
    and coalesce(r2.valid_to,'infinity'::date)>=coalesce(r1.valid_from,'-infinity'::date)
  join public.discovery_professional_people p1
    on p1.company_id=r1.company_id and p1.id=r1.professional_person_id and p1.status='active'
  join public.discovery_professional_people p2
    on p2.company_id=r2.company_id and p2.id=r2.professional_person_id and p2.status='active'
    and p2.normalized_name=p1.normalized_name and p2.id>p1.id
  where r1.company_id=p_company_id
  on conflict(company_id,candidate_kind,match_rule,left_record_id,right_record_id) do nothing;
  get diagnostics v_added=row_count; v_total:=v_total+v_added;

  insert into public.discovery_deduplication_candidates(
    company_id,candidate_kind,match_rule,left_record_id,right_record_id,
    strength,rationale,evidence_refs
  )
  select p_company_id,'contact_point','exact_contact_fingerprint',least(a.id,b.id),greatest(a.id,b.id),
    'strong',
    'The same keyed contact fingerprint is attached to the same owner record. The contact value remains encrypted and is not exposed by E12.',
    '[]'::jsonb
  from public.discovery_contact_points a
  join public.discovery_contact_points b
    on b.company_id=a.company_id and b.contact_type=a.contact_type
    and b.value_fingerprint=a.value_fingerprint and b.id>a.id
    and ((a.canonical_entity_id is not null and a.canonical_entity_id=b.canonical_entity_id)
      or (a.professional_person_id is not null and a.professional_person_id=b.professional_person_id))
  where a.company_id=p_company_id and a.status='active' and b.status='active'
  on conflict(company_id,candidate_kind,match_rule,left_record_id,right_record_id) do nothing;
  get diagnostics v_added=row_count; v_total:=v_total+v_added;

  return v_total;
end;
$generate$;

create or replace function public.record_discovery_deduplication_review(
  p_company_id uuid,p_actor_user_id uuid,p_candidate_id uuid,p_decision text,p_reason text
) returns public.discovery_deduplication_review_events
language plpgsql security definer
set search_path=public,pg_temp
as $review$
declare
  v_role text;
  v_candidate public.discovery_deduplication_candidates%rowtype;
  v_event public.discovery_deduplication_review_events%rowtype;
begin
  if p_company_id is null or p_actor_user_id is null or p_candidate_id is null then
    raise exception 'Company, reviewer and candidate are required' using errcode='22023';
  end if;
  if p_decision not in ('confirmed_duplicate','not_duplicate','escalated') then
    raise exception 'Unsupported E12 review decision' using errcode='22023';
  end if;
  if p_reason is null or length(trim(p_reason))<1 or length(trim(p_reason))>1000 then
    raise exception 'E12 review reason is required and must not exceed 1000 characters' using errcode='22023';
  end if;

  select role into v_role from public.company_memberships
    where company_id=p_company_id and user_id=p_actor_user_id for share;
  if v_role is null or v_role not in ('owner','admin') then
    raise exception 'Only a company owner or admin can review E12 duplicate candidates' using errcode='42501';
  end if;

  select * into v_candidate from public.discovery_deduplication_candidates
    where company_id=p_company_id and id=p_candidate_id and review_state='pending_review'
    for update;
  if not found then raise exception 'E12 candidate is missing or already reviewed' using errcode='P0002'; end if;

  if v_candidate.candidate_kind='organization' and not exists (
    select 1 from public.discovery_canonical_entities
    where company_id=p_company_id and id in (v_candidate.left_record_id,v_candidate.right_record_id)
      and status='active' group by company_id having count(*)=2
  ) then raise exception 'Both E12 organization records must remain active in this company' using errcode='42501'; end if;
  if v_candidate.candidate_kind='professional_person' and not exists (
    select 1 from public.discovery_professional_people
    where company_id=p_company_id and id in (v_candidate.left_record_id,v_candidate.right_record_id)
      and status='active' group by company_id having count(*)=2
  ) then raise exception 'Both E12 people records must remain active in this company' using errcode='42501'; end if;
  if v_candidate.candidate_kind='contact_point' and not exists (
    select 1 from public.discovery_contact_points
    where company_id=p_company_id and id in (v_candidate.left_record_id,v_candidate.right_record_id)
      and status='active' group by company_id having count(*)=2
  ) then raise exception 'Both E12 contact records must remain active in this company' using errcode='42501'; end if;

  insert into public.discovery_deduplication_review_events(
    company_id,candidate_id,actor_user_id,candidate_kind,match_rule,
    left_record_id,right_record_id,decision,reason
  ) values (
    p_company_id,v_candidate.id,p_actor_user_id,v_candidate.candidate_kind,v_candidate.match_rule,
    v_candidate.left_record_id,v_candidate.right_record_id,p_decision,trim(p_reason)
  ) returning * into v_event;

  update public.discovery_deduplication_candidates
    set review_state=p_decision,reviewed_at=clock_timestamp()
    where company_id=p_company_id and id=v_candidate.id;

  insert into public.discovery_audit_events(company_id,actor_user_id,action,entity_type,entity_id,details)
  values (
    p_company_id,p_actor_user_id,'deduplication_review_recorded','deduplication_candidate',v_candidate.id,
    jsonb_build_object('candidateKind',v_candidate.candidate_kind,'matchRule',v_candidate.match_rule,
      'decision',p_decision,'leftRecordId',v_candidate.left_record_id,'rightRecordId',v_candidate.right_record_id)
  );
  return v_event;
end;
$review$;

create or replace function public.prevent_discovery_deduplication_event_mutation()
returns trigger language plpgsql as $guard$
begin
  raise exception 'E12 review receipts are immutable.';
end;
$guard$;
drop trigger if exists discovery_deduplication_review_events_no_update on public.discovery_deduplication_review_events;
create trigger discovery_deduplication_review_events_no_update
  before update or delete on public.discovery_deduplication_review_events
  for each row execute function public.prevent_discovery_deduplication_event_mutation();

revoke all on function public.generate_discovery_deduplication_candidates(uuid) from public,anon,authenticated;
revoke all on function public.record_discovery_deduplication_review(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.generate_discovery_deduplication_candidates(uuid) to service_role;
grant execute on function public.record_discovery_deduplication_review(uuid,uuid,uuid,text,text) to service_role;

comment on table public.discovery_deduplication_candidates is
  'E12 exact-match, company-scoped organization/person/contact duplicate suggestions. No identity is merged automatically.';
comment on table public.discovery_deduplication_review_events is
  'Immutable owner/admin decisions for E12 candidates; a confirmed duplicate is a review result, not an executed merge.';
comment on view public.discovery_entity_graph_edges is
  'Only explicit owner-accepted E06 legal-group relationships are exposed as graph edges. No transitive link is inferred.';

commit;
