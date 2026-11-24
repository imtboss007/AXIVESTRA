-- AXIVESTRA E11 scoring runner persistence.
-- Scores can only be persisted by the authenticated discovery-control Edge Function
-- after it derives a candidate exclusively from owner-accepted E10 observations.
-- The function rechecks tenant, role, profile criteria, source attachment and evidence.

begin;

alter table public.discovery_match_results
  add column if not exists discovery_mode text
  check (discovery_mode is null or discovery_mode in ('LENDER','CUSTOMER'));

create or replace function public.record_discovery_match_score(
  p_company_id uuid,
  p_actor_user_id uuid,
  p_profile_id uuid,
  p_canonical_entity_id uuid,
  p_criteria_version text,
  p_criteria_snapshot jsonb,
  p_candidate_snapshot jsonb,
  p_score numeric,
  p_confidence numeric,
  p_eligible boolean,
  p_positive_factors jsonb,
  p_negative_factors jsonb,
  p_unknown_criteria jsonb,
  p_blockers jsonb,
  p_components jsonb
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $score$
declare
  v_profile public.discovery_profiles%rowtype;
  v_role text;
  v_match_id uuid;
  v_ref jsonb;
  v_component jsonb;
  v_criterion text;
  v_evidence_count integer;
  v_component_count integer := 0;
  v_superseded_count integer := 0;
begin
  if p_company_id is null or p_actor_user_id is null or p_profile_id is null
    or p_canonical_entity_id is null then
    raise exception 'E11 company, actor, profile and canonical entity are required' using errcode='22023';
  end if;
  select role into v_role
    from public.company_memberships
    where company_id=p_company_id and user_id=p_actor_user_id;
  if v_role is null or v_role not in ('owner','admin') then
    raise exception 'Only a company owner or admin can persist an E11 match score' using errcode='42501';
  end if;

  select * into v_profile
    from public.discovery_profiles
    where company_id=p_company_id and id=p_profile_id
    for share;
  if not found then raise exception 'E11 workspace profile was not found in this company' using errcode='P0002'; end if;
  if v_profile.enabled is distinct from true then
    raise exception 'E11 workspace profile is disabled' using errcode='42501';
  end if;
  if coalesce((v_profile.criteria->>'disabledByPolicy')::boolean,false) then
    raise exception 'E11 workspace/mode is disabled by discovery policy' using errcode='42501';
  end if;
  if v_profile.workspace_key='litigation' and v_profile.discovery_mode='LENDER' then
    raise exception 'E11 lender discovery is disabled for Litigation' using errcode='42501';
  end if;
  if v_profile.workspace_key='personal_loan' and v_profile.discovery_mode='CUSTOMER' then
    raise exception 'E11 Personal Loan customer discovery is limited to inbound, referred or explicitly consented intake' using errcode='42501';
  end if;
  if jsonb_typeof(p_criteria_snapshot) <> 'object'
    or p_criteria_snapshot <> coalesce(v_profile.criteria->'matchCriteria','{}'::jsonb)
    or p_criteria_snapshot = '{}'::jsonb then
    raise exception 'E11 scoring criteria must exactly match this profile and contain at least one explicit criterion' using errcode='42501';
  end if;
  if length(trim(coalesce(p_criteria_version,''))) < 1 or length(p_criteria_version)>80
    or jsonb_typeof(p_candidate_snapshot)<>'object'
    or octet_length(p_candidate_snapshot::text)>30000
    or p_candidate_snapshot->>'canonicalEntityId'<>p_canonical_entity_id::text
    or jsonb_typeof(p_candidate_snapshot->'evidenceReferences')<>'array'
    or jsonb_array_length(p_candidate_snapshot->'evidenceReferences')<1
    or jsonb_array_length(p_candidate_snapshot->'evidenceReferences')>100 then
    raise exception 'E11 candidate snapshot or evidence references are outside approved bounds' using errcode='22023';
  end if;
  if p_score is null or p_score not between 0 and 100
    or p_confidence is null or p_confidence not between 0 and 1
    or p_eligible is null then
    raise exception 'E11 score, confidence or eligibility value is invalid' using errcode='22023';
  end if;
  if jsonb_typeof(p_positive_factors)<>'array'
    or jsonb_typeof(p_negative_factors)<>'array'
    or jsonb_typeof(p_unknown_criteria)<>'array'
    or jsonb_typeof(p_blockers)<>'array'
    or jsonb_typeof(p_components)<>'array'
    or jsonb_array_length(p_components)<1
    or jsonb_array_length(p_components)>9 then
    raise exception 'E11 score explanation payload is outside approved bounds' using errcode='22023';
  end if;

  if not exists (
    select 1 from public.discovery_canonical_entities e
    where e.company_id=p_company_id and e.id=p_canonical_entity_id and e.status='active'
  ) then raise exception 'E11 canonical entity is not active in this company' using errcode='42501'; end if;

  v_evidence_count := jsonb_array_length(p_candidate_snapshot->'evidenceReferences');
  for v_ref in select value from jsonb_array_elements(p_candidate_snapshot->'evidenceReferences')
  loop
    if coalesce(v_ref->>'evidence_id','') !~* '^[0-9a-f-]{36}$'
      or coalesce(v_ref->>'source_id','') !~* '^[0-9a-f-]{36}$' then
      raise exception 'E11 evidence reference is malformed' using errcode='22023';
    end if;
    if not exists (
      select 1
      from public.discovery_enrichment_observations o
      join public.discovery_profile_sources ps
        on ps.company_id=o.company_id and ps.profile_id=p_profile_id and ps.source_id=o.source_id
      join public.discovery_source_registry s
        on s.company_id=o.company_id and s.id=o.source_id and s.status='approved'
      where o.company_id=p_company_id
        and o.canonical_entity_id=p_canonical_entity_id
        and o.review_state='accepted'
        and o.evidence_id=(v_ref->>'evidence_id')::uuid
        and o.source_id=(v_ref->>'source_id')::uuid
        and v_profile.purpose=any(s.allowed_purposes)
    ) then
      raise exception 'E11 evidence reference is not an accepted observation from an attached approved source' using errcode='42501';
    end if;
  end loop;

  update public.discovery_match_results
    set review_state='superseded'
    where company_id=p_company_id
      and canonical_entity_id=p_canonical_entity_id
      and workspace_key=v_profile.workspace_key
      and discovery_mode=v_profile.discovery_mode
      and review_state='pending_review';
  get diagnostics v_superseded_count = row_count;

  insert into public.discovery_match_results(
    company_id,canonical_entity_id,workspace_key,discovery_mode,criteria_version,
    criteria_snapshot,candidate_snapshot,score,confidence,eligible,method,
    positive_factors,negative_factors,unknown_criteria,blockers,created_by
  ) values (
    p_company_id,p_canonical_entity_id,v_profile.workspace_key,v_profile.discovery_mode,p_criteria_version,
    p_criteria_snapshot,p_candidate_snapshot,p_score,p_confidence,p_eligible,
    'deterministic_weighted_rules_v1',
    p_positive_factors,p_negative_factors,p_unknown_criteria,p_blockers,p_actor_user_id
  ) returning id into v_match_id;

  for v_component in select value from jsonb_array_elements(p_components)
  loop
    v_criterion := v_component->>'criterion';
    if v_criterion not in (
      'geography','type','sector','ticket','instrument','collateral','stage','mandate','evidence_freshness'
    ) or nullif(v_component->>'weight','') is null
      or nullif(v_component->>'points','') is null
      or (v_component->>'weight')::numeric < 0
      or (v_component->>'points')::numeric < 0
      or (v_component->>'points')::numeric > (v_component->>'weight')::numeric
      or v_component->>'status' not in ('match','mismatch','unknown')
      or jsonb_typeof(v_component->'required')<>'boolean'
      or length(trim(coalesce(v_component->>'reason',''))) not between 1 and 1000 then
      raise exception 'E11 score component failed validation' using errcode='22023';
    end if;
    insert into public.discovery_match_score_components(
      company_id,match_result_id,criterion,weight,points,status,required,rationale
    ) values (
      p_company_id,v_match_id,v_criterion,(v_component->>'weight')::numeric,
      (v_component->>'points')::numeric,v_component->>'status',
      (v_component->>'required')::boolean,v_component->>'reason'
    );
    v_component_count := v_component_count + 1;
  end loop;
  if v_component_count <> jsonb_array_length(p_components) then
    raise exception 'E11 score component count is inconsistent' using errcode='22023';
  end if;

  insert into public.discovery_audit_events(
    company_id,actor_user_id,action,entity_type,entity_id,details
  ) values (
    p_company_id,p_actor_user_id,'match_score_recorded','match_result',v_match_id,
    jsonb_build_object(
      'workspaceKey',v_profile.workspace_key,
      'discoveryMode',v_profile.discovery_mode,
      'canonicalEntityId',p_canonical_entity_id,
      'score',p_score,'confidence',p_confidence,
      'eligible',p_eligible,'criteriaVersion',p_criteria_version,
      'componentCount',v_component_count,'evidenceReferenceCount',v_evidence_count,
      'supersededPendingScoreCount',v_superseded_count
    )
  );

  return v_match_id;
end;
$score$;

revoke all on function public.record_discovery_match_score(
  uuid,uuid,uuid,uuid,text,jsonb,jsonb,numeric,numeric,boolean,jsonb,jsonb,jsonb,jsonb,jsonb
) from public,anon,authenticated;
grant execute on function public.record_discovery_match_score(
  uuid,uuid,uuid,uuid,text,jsonb,jsonb,numeric,numeric,boolean,jsonb,jsonb,jsonb,jsonb,jsonb
) to service_role;

comment on function public.record_discovery_match_score is
  'E11 atomic score persistence; owner/admin only; requires the exact enabled workspace profile and evidence from attached approved sources.';

commit;
