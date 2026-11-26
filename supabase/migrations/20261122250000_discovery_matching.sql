-- AXIVESTRA E11: deterministic, explainable workspace fit scores.
-- Scores are advisory; no AI provider, approval or investment decision is activated.
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
    'match_score_recorded'
  ));
alter table public.discovery_audit_events
  drop constraint if exists discovery_audit_events_entity_type_check;
alter table public.discovery_audit_events
  add constraint discovery_audit_events_entity_type_check check (entity_type in (
    'source','profile','profile_source','discovery_job','discovery_worker_control',
    'extraction_review_event','entity_resolution_candidate','canonical_entity',
    'entity_relationship','professional_role_candidate','professional_person',
    'contact_point','place_candidate','enrichment_observation','enrichment_conflict',
    'match_result'
  ));

create table if not exists public.discovery_match_results (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  canonical_entity_id uuid not null,
  workspace_key text not null check (length(trim(workspace_key)) between 1 and 100),
  criteria_version text not null check (length(trim(criteria_version)) between 1 and 80),
  criteria_snapshot jsonb not null check (jsonb_typeof(criteria_snapshot)='object' and octet_length(criteria_snapshot::text)<=30000),
  candidate_snapshot jsonb not null check (jsonb_typeof(candidate_snapshot)='object' and octet_length(candidate_snapshot::text)<=30000),
  score numeric(5,2) not null check (score between 0 and 100),
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  eligible boolean not null,
  method text not null check (method='deterministic_weighted_rules_v1'),
  positive_factors jsonb not null default '[]'::jsonb check (jsonb_typeof(positive_factors)='array'),
  negative_factors jsonb not null default '[]'::jsonb check (jsonb_typeof(negative_factors)='array'),
  unknown_criteria jsonb not null default '[]'::jsonb check (jsonb_typeof(unknown_criteria)='array'),
  blockers jsonb not null default '[]'::jsonb check (jsonb_typeof(blockers)='array'),
  review_state text not null default 'pending_review'
    check (review_state in ('pending_review','accepted_for_review','rejected','superseded')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique(company_id,id),
  foreign key(company_id,canonical_entity_id)
    references public.discovery_canonical_entities(company_id,id) on delete restrict
);
create index if not exists discovery_match_results_entity_idx
  on public.discovery_match_results(company_id,canonical_entity_id,created_at desc);
create index if not exists discovery_match_results_workspace_idx
  on public.discovery_match_results(company_id,workspace_key,score desc,created_at desc);

create table if not exists public.discovery_match_score_components (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  match_result_id uuid not null,
  criterion text not null check (criterion in (
    'geography','type','ticket','instrument','collateral','stage','mandate','evidence_freshness'
  )),
  weight numeric(8,3) not null check (weight>=0),
  points numeric(8,3) not null check (points>=0 and points<=weight),
  status text not null check (status in ('match','mismatch','unknown')),
  required boolean not null default false,
  rationale text not null check (length(trim(rationale)) between 1 and 1000),
  unique(company_id,id),
  unique(company_id,match_result_id,criterion),
  foreign key(company_id,match_result_id)
    references public.discovery_match_results(company_id,id) on delete cascade
);
create index if not exists discovery_match_components_result_idx
  on public.discovery_match_score_components(company_id,match_result_id);

alter table public.discovery_match_results enable row level security;
alter table public.discovery_match_score_components enable row level security;
drop policy if exists discovery_match_results_company_read on public.discovery_match_results;
create policy discovery_match_results_company_read on public.discovery_match_results
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists discovery_match_components_company_read on public.discovery_match_score_components;
create policy discovery_match_components_company_read on public.discovery_match_score_components
  for select to authenticated using (public.is_company_member(company_id));
revoke all on public.discovery_match_results,public.discovery_match_score_components from anon,authenticated;
grant select on public.discovery_match_results,public.discovery_match_score_components to authenticated;
grant select,insert,update on public.discovery_match_results,public.discovery_match_score_components to service_role;

comment on table public.discovery_match_results is
  'E11 deterministic workspace fit score snapshots; advisory only and always pending human review.';
comment on table public.discovery_match_score_components is
  'E11 criterion-level weighted points, match state and rationale for explainable scores.';
commit;
