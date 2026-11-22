-- AXIVESTRA E13: append-only evidence and field-level provenance ledger.
-- Stores source lineage metadata only; never copies raw evidence, field values,
-- contact values, ciphertext, fingerprints or source URLs into the ledger.
begin;

create table if not exists public.discovery_provenance_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  subject_kind text not null check (subject_kind in (
    'source','evidence','extracted_fact','extracted_entity','canonical_entity',
    'entity_assignment','entity_identifier','entity_alias','entity_relationship',
    'professional_role_candidate','professional_role_assignment',
    'contact_candidate','contact_point','place_candidate','match_result',
    'deduplication_candidate','enrichment_observation','enrichment_conflict'
  )),
  subject_id uuid not null,
  field_name text check (field_name is null or length(trim(field_name)) between 1 and 128),
  event_type text not null check (event_type in (
    'source_registered','source_approved','source_paused','source_rejected',
    'evidence_captured','source_observed','extraction_reviewed','canonical_entity_created',
    'entity_assigned','identifier_recorded','alias_recorded',
    'relationship_recorded','professional_role_observed','professional_role_assigned',
    'professional_role_reviewed','contact_candidate_observed','contact_point_recorded',
    'place_candidate_observed','place_reviewed','match_score_recorded',
    'deduplication_candidate_created','deduplication_reviewed','enrichment_observed',
    'enrichment_observation_reviewed','enrichment_conflict_reviewed',
    'evidence_retention_purged'
  )),
  decision text check (decision is null or length(decision)<=80),
  source_id uuid,
  evidence_id uuid,
  extraction_run_id uuid,
  evidence_content_hash text check (
    evidence_content_hash is null or evidence_content_hash ~ '^[a-f0-9]{64}$'
  ),
  evidence_captured_at timestamptz,
  source_published_at timestamptz,
  source_name_snapshot text check (source_name_snapshot is null or length(source_name_snapshot)<=160),
  source_domain_snapshot text check (source_domain_snapshot is null or length(source_domain_snapshot)<=253),
  source_jurisdiction_snapshot text check (source_jurisdiction_snapshot is null or length(source_jurisdiction_snapshot)<=80),
  source_attribution_snapshot text check (source_attribution_snapshot is null or length(source_attribution_snapshot)<=500),
  source_license_ref_snapshot text check (source_license_ref_snapshot is null or length(source_license_ref_snapshot)<=300),
  source_license_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_license_snapshot)='object' and octet_length(source_license_snapshot::text)<=4000),
  source_span jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_span)='object' and octet_length(source_span::text)<=2000),
  actor_user_id uuid,
  origin_table text not null check (origin_table in (
    'discovery_audit_events','discovery_evidence_items','discovery_fetch_events',
    'discovery_extracted_entities','discovery_extracted_facts','discovery_extraction_review_events',
    'discovery_canonical_entities','discovery_entity_assignments','discovery_entity_identifiers',
    'discovery_entity_aliases','discovery_entity_relationships',
    'discovery_professional_role_candidates','discovery_professional_role_assignments',
    'discovery_professional_role_review_events','discovery_contact_candidates',
    'discovery_contact_points','discovery_place_candidates',
    'discovery_place_resolution_events','discovery_enrichment_observations',
    'discovery_enrichment_review_events','discovery_match_results',
    'discovery_deduplication_candidates','discovery_deduplication_review_events'
  )),
  origin_record_id uuid not null,
  event_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(event_metadata)='object' and octet_length(event_metadata::text)<=4000),
  occurred_at timestamptz not null default now(),
  unique(company_id,origin_table,origin_record_id,event_type,subject_id)
);

create index if not exists discovery_provenance_subject_idx
  on public.discovery_provenance_events(company_id,subject_kind,subject_id,occurred_at desc);
create index if not exists discovery_provenance_evidence_idx
  on public.discovery_provenance_events(company_id,evidence_id,occurred_at desc)
  where evidence_id is not null;
create index if not exists discovery_provenance_source_idx
  on public.discovery_provenance_events(company_id,source_id,occurred_at desc)
  where source_id is not null;

alter table public.discovery_provenance_events enable row level security;
drop policy if exists discovery_provenance_company_read on public.discovery_provenance_events;
create policy discovery_provenance_company_read
  on public.discovery_provenance_events for select to authenticated
  using (public.is_company_member(company_id));

revoke all on public.discovery_provenance_events from public,anon,authenticated;
grant select on public.discovery_provenance_events to authenticated;
grant select,insert on public.discovery_provenance_events to service_role;

create or replace function public.prevent_discovery_provenance_update()
returns trigger
language plpgsql
as $guard$
begin
  raise exception 'Discovery provenance events are append-only; create a new event instead.';
end;
$guard$;
drop trigger if exists discovery_provenance_no_update on public.discovery_provenance_events;
create trigger discovery_provenance_no_update
  before update on public.discovery_provenance_events
  for each row execute function public.prevent_discovery_provenance_update();
revoke update,delete on public.discovery_provenance_events from public,anon,authenticated,service_role;

-- A caller supplies only record IDs and bounded metadata. Source/evidence
-- snapshots are read from the company-scoped registry at event time, with
-- retained E10 snapshots used when the raw evidence object has expired.
create or replace function public.append_discovery_provenance_event(
  p_company_id uuid,
  p_origin_table text,
  p_origin_record_id uuid,
  p_subject_kind text,
  p_subject_id uuid,
  p_event_type text,
  p_field_name text,
  p_decision text,
  p_source_id uuid,
  p_evidence_id uuid,
  p_extraction_run_id uuid,
  p_source_span jsonb,
  p_actor_user_id uuid,
  p_event_metadata jsonb,
  p_source_snapshot jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $append$
declare
  v_id uuid;
  v_source_id uuid:=p_source_id;
  v_evidence_source_id uuid;
  v_hash text;
  v_captured timestamptz;
  v_published timestamptz;
  v_attribution text;
  v_license jsonb:='{}'::jsonb;
  v_source_name text;
  v_source_domain text;
  v_source_jurisdiction text;
  v_source_attribution text;
  v_license_ref text;
  v_span jsonb:='{}'::jsonb;
  v_key text;
begin
  if p_company_id is null or p_origin_record_id is null or p_subject_id is null then
    raise exception 'E13 provenance requires company, origin and subject identifiers' using errcode='22023';
  end if;
  if p_source_snapshot is null or jsonb_typeof(p_source_snapshot)<>'object'
    or octet_length(p_source_snapshot::text)>4000 then
    raise exception 'E13 source snapshot must be a bounded JSON object' using errcode='22023';
  end if;
  if p_source_span is null or jsonb_typeof(p_source_span)<>'object' then
    raise exception 'E13 source span must be a JSON object' using errcode='22023';
  end if;
  if p_event_metadata is null or jsonb_typeof(p_event_metadata)<>'object'
    or octet_length(p_event_metadata::text)>4000 then
    raise exception 'E13 event metadata must be a bounded JSON object' using errcode='22023';
  end if;
  if not exists(select 1 from public.companies c where c.id=p_company_id) then
    raise exception 'E13 company scope does not exist' using errcode='42501';
  end if;

  if p_evidence_id is not null then
    select e.source_id,e.content_hash,e.captured_at,e.source_published_at,
           e.attribution,e.licence_snapshot
      into v_evidence_source_id,v_hash,v_captured,v_published,v_attribution,v_license
    from public.discovery_evidence_items e
    where e.company_id=p_company_id and e.id=p_evidence_id;
    v_source_id:=coalesce(v_evidence_source_id,p_source_id);
  end if;

  if v_source_id is null and p_evidence_id is not null then
    select fe.source_id into v_source_id
    from public.discovery_fetch_events fe
    where fe.company_id=p_company_id and fe.evidence_id=p_evidence_id
    order by fe.occurred_at desc limit 1;
  end if;

  if v_source_id is not null then
    select s.name,s.domain,s.jurisdiction,s.attribution,s.license_ref
      into v_source_name,v_source_domain,v_source_jurisdiction,
           v_source_attribution,v_license_ref
    from public.discovery_source_registry s
    where s.company_id=p_company_id and s.id=v_source_id;
    if not found then
      raise exception 'E13 source reference is outside the company scope' using errcode='42501';
    end if;
  end if;

  v_hash:=coalesce(v_hash,p_source_snapshot->>'evidenceContentHash');
  v_captured:=coalesce(v_captured,nullif(p_source_snapshot->>'evidenceCapturedAt','')::timestamptz);
  v_published:=coalesce(v_published,nullif(p_source_snapshot->>'sourcePublishedAt','')::timestamptz);
  v_source_name:=coalesce(p_source_snapshot->>'sourceName',v_source_name);
  v_source_domain:=coalesce(p_source_snapshot->>'sourceDomain',v_source_domain);
  v_source_jurisdiction:=coalesce(p_source_snapshot->>'sourceJurisdiction',v_source_jurisdiction);
  v_source_attribution:=left(coalesce(v_attribution,p_source_snapshot->>'evidenceAttribution',
    p_source_snapshot->>'sourceAttribution',v_source_attribution),500);
  v_license_ref:=left(coalesce(p_source_snapshot->>'sourceLicenseRef',v_license_ref),300);
  v_license:=coalesce(nullif(v_license,'{}'::jsonb),p_source_snapshot->'licenseSnapshot','{}'::jsonb);
  if jsonb_typeof(v_license)<>'object' or octet_length(v_license::text)>4000 then
    v_license:='{}'::jsonb;
  end if;

  for v_key in select jsonb_object_keys(p_source_span)
  loop
    if v_key=any(array['kind','start','end','locator','path','page','line','column'])
      and octet_length((p_source_span->v_key)::text)<=256 then
      v_span:=v_span||jsonb_build_object(v_key,p_source_span->v_key);
    end if;
  end loop;
  if octet_length(v_span::text)>2000 then v_span:='{}'::jsonb; end if;

  insert into public.discovery_provenance_events(
    company_id,subject_kind,subject_id,field_name,event_type,decision,
    source_id,evidence_id,extraction_run_id,evidence_content_hash,
    evidence_captured_at,source_published_at,source_name_snapshot,
    source_domain_snapshot,source_jurisdiction_snapshot,source_attribution_snapshot,
    source_license_ref_snapshot,source_license_snapshot,source_span,actor_user_id,
    origin_table,origin_record_id,event_metadata
  ) values (
    p_company_id,p_subject_kind,p_subject_id,p_field_name,p_event_type,p_decision,
    v_source_id,p_evidence_id,p_extraction_run_id,v_hash,v_captured,v_published,
    v_source_name,v_source_domain,v_source_jurisdiction,v_source_attribution,
    v_license_ref,v_license,v_span,p_actor_user_id,p_origin_table,p_origin_record_id,
    p_event_metadata
  )
  on conflict(company_id,origin_table,origin_record_id,event_type,subject_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.discovery_provenance_events
    where company_id=p_company_id and origin_table=p_origin_table
      and origin_record_id=p_origin_record_id and event_type=p_event_type
      and subject_id=p_subject_id;
  end if;
  return v_id;
end;
$append$;

create or replace function public.ingest_discovery_provenance_record(
  p_origin_table text,p_row jsonb
) returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $ingest$
declare
  v_company uuid;
  v_id uuid;
  v_subject_kind text;
  v_subject_id uuid;
  v_event_type text;
  v_field text;
  v_decision text;
  v_source uuid;
  v_evidence uuid;
  v_run uuid;
  v_span jsonb:='{}'::jsonb;
  v_actor uuid;
  v_metadata jsonb:='{}'::jsonb;
  v_snapshot jsonb:='{}'::jsonb;
  v_fact record;
  v_entity record;
  v_obs record;
  v_conflict record;
begin
  if p_row is null or jsonb_typeof(p_row)<>'object' then
    raise exception 'E13 provenance source row must be an object' using errcode='22023';
  end if;
  v_company:=nullif(p_row->>'company_id','')::uuid;
  v_id:=nullif(p_row->>'id','')::uuid;
  if v_company is null or v_id is null then return; end if;

  case p_origin_table
  when 'discovery_audit_events' then
    if p_row->>'entity_type'<>'source' or p_row->>'action' not in
      ('source_registered','source_approved','source_paused','source_rejected') then return; end if;
    v_subject_kind:='source'; v_subject_id:=nullif(p_row->>'entity_id','')::uuid;
    v_source:=v_subject_id; v_event_type:=p_row->>'action';
    v_decision:=p_row->>'action'; v_actor:=nullif(p_row->>'actor_user_id','')::uuid;
    v_field:='source_governance';
    v_metadata:=jsonb_build_object('action',p_row->>'action');
  when 'discovery_evidence_items' then
    v_subject_kind:='evidence'; v_subject_id:=v_id;
    v_event_type:='evidence_captured'; v_field:='raw_evidence';
    v_source:=nullif(p_row->>'source_id','')::uuid; v_evidence:=v_id;
    v_metadata:=jsonb_build_object('contentType',left(p_row->>'content_type',120),
      'byteLength',p_row->>'byte_length','evidenceKind',p_row->>'evidence_kind');
  when 'discovery_extracted_entities' then
    v_subject_kind:='extracted_entity'; v_subject_id:=v_id;
    v_event_type:='source_observed'; v_field:='entity_mention';
    v_evidence:=nullif(p_row->>'evidence_id','')::uuid;
    v_run:=nullif(p_row->>'extraction_run_id','')::uuid;
    v_span:=coalesce(p_row->'source_span','{}'::jsonb);
    v_metadata:=jsonb_build_object('entityKind',p_row->>'entity_kind',
      'confidence',p_row->>'confidence','extractionMethod',p_row->>'extraction_method');
    select source_id into v_source from public.discovery_extraction_runs
      where company_id=v_company and id=v_run;
  when 'discovery_extracted_facts' then
    v_subject_kind:='extracted_fact'; v_subject_id:=v_id;
    v_event_type:='source_observed'; v_field:=p_row->>'field_name';
    v_evidence:=nullif(p_row->>'evidence_id','')::uuid;
    v_run:=nullif(p_row->>'extraction_run_id','')::uuid;
    v_span:=coalesce(p_row->'source_span','{}'::jsonb);
    v_decision:=p_row->>'validation_status';
    v_metadata:=jsonb_build_object('valueType',p_row->>'value_type',
      'confidence',p_row->>'confidence','validationStatus',p_row->>'validation_status');
    select source_id into v_source from public.discovery_extraction_runs
      where company_id=v_company and id=v_run;
  when 'discovery_extraction_review_events' then
    v_run:=nullif(p_row->>'extraction_run_id','')::uuid;
    v_actor:=nullif(p_row->>'actor_user_id','')::uuid;
    v_decision:=p_row->>'decision';
    if nullif(p_row->>'fact_id','') is not null then
      select id,field_name,evidence_id,source_span into v_fact
      from public.discovery_extracted_facts
      where company_id=v_company and extraction_run_id=v_run
        and id=(p_row->>'fact_id')::uuid;
      v_subject_kind:='extracted_fact'; v_subject_id:=v_fact.id;
      v_field:=v_fact.field_name; v_evidence:=v_fact.evidence_id; v_span:=v_fact.source_span;
    else
      select id,evidence_id,entity_kind,source_span into v_entity
      from public.discovery_extracted_entities
      where company_id=v_company and extraction_run_id=v_run
        and id=(p_row->>'extracted_entity_id')::uuid;
      v_subject_kind:='extracted_entity'; v_subject_id:=v_entity.id;
      v_field:='entity_mention'; v_evidence:=v_entity.evidence_id; v_span:=v_entity.source_span;
    end if;
    v_event_type:='extraction_reviewed';
    select source_id into v_source from public.discovery_extraction_runs
      where company_id=v_company and id=v_run;
  when 'discovery_canonical_entities' then
    v_subject_kind:='canonical_entity'; v_subject_id:=v_id;
    v_event_type:='canonical_entity_created'; v_field:='legal_name';
    v_evidence:=nullif(p_row->>'source_evidence_id','')::uuid;
    v_actor:=nullif(p_row->>'created_by','')::uuid;
  when 'discovery_entity_assignments' then
    v_subject_kind:='entity_assignment'; v_subject_id:=v_id;
    v_event_type:='entity_assigned'; v_field:='entity_assignment';
    v_evidence:=nullif(p_row->>'source_evidence_id','')::uuid;
    v_run:=nullif(p_row->>'extraction_run_id','')::uuid;
    v_metadata:=jsonb_build_object('canonicalEntityId',p_row->>'canonical_entity_id',
      'extractedEntityId',p_row->>'extracted_entity_id');
    select source_id into v_source from public.discovery_extraction_runs
      where company_id=v_company and id=v_run;
  when 'discovery_entity_identifiers' then
    v_subject_kind:='entity_identifier'; v_subject_id:=v_id;
    v_event_type:='identifier_recorded'; v_field:=p_row->>'field_name';
    v_decision:=p_row->>'review_state';
    v_evidence:=nullif(p_row->>'source_evidence_id','')::uuid;
    v_span:=coalesce(p_row->'source_span','{}'::jsonb);
    v_metadata:=jsonb_build_object('scheme',p_row->>'scheme','jurisdiction',p_row->>'jurisdiction',
      'reviewState',p_row->>'review_state');
  when 'discovery_entity_aliases' then
    v_subject_kind:='entity_alias'; v_subject_id:=v_id;
    v_event_type:='alias_recorded'; v_field:='alias';
    v_decision:=p_row->>'review_state';
    v_evidence:=nullif(p_row->>'source_evidence_id','')::uuid;
    v_span:=coalesce(p_row->'source_span','{}'::jsonb);
    v_metadata:=jsonb_build_object('aliasType',p_row->>'alias_type','reviewState',p_row->>'review_state');
  when 'discovery_entity_relationships' then
    v_subject_kind:='entity_relationship'; v_subject_id:=v_id;
    v_event_type:='relationship_recorded'; v_field:=p_row->>'relationship_type';
    v_decision:=p_row->>'review_state';
    v_evidence:=nullif(p_row->>'evidence_id','')::uuid;
    v_span:=coalesce(p_row->'source_span','{}'::jsonb);
    v_metadata:=jsonb_build_object('relationshipType',p_row->>'relationship_type',
      'reviewState',p_row->>'review_state');
  when 'discovery_professional_role_candidates' then
    v_subject_kind:='professional_role_candidate'; v_subject_id:=v_id;
    v_event_type:='professional_role_observed'; v_field:='professional_role';
    v_decision:=p_row->>'review_state';
    v_evidence:=nullif(p_row->>'evidence_id','')::uuid;
    v_run:=nullif(p_row->>'extraction_run_id','')::uuid;
    v_span:=coalesce(p_row->'source_span','{}'::jsonb);
    v_metadata:=jsonb_build_object('confidence',p_row->>'confidence',
      'relationshipMethod',p_row->>'relationship_method');
    select source_id into v_source from public.discovery_extraction_runs
      where company_id=v_company and id=v_run;
  when 'discovery_professional_role_assignments' then
    v_subject_kind:='professional_role_assignment'; v_subject_id:=v_id;
    v_event_type:='professional_role_assigned'; v_field:='professional_role';
    v_evidence:=nullif(p_row->>'source_evidence_id','')::uuid;
    v_span:=coalesce(p_row->'source_span','{}'::jsonb);
  when 'discovery_professional_role_review_events' then
    v_subject_kind:='professional_role_candidate';
    v_subject_id:=nullif(p_row->>'candidate_id','')::uuid;
    v_event_type:='professional_role_reviewed'; v_field:='professional_role';
    v_decision:=p_row->>'decision'; v_actor:=nullif(p_row->>'actor_user_id','')::uuid;
    if v_subject_id is not null then
      select evidence_id,extraction_run_id,source_span into v_entity
      from public.discovery_professional_role_candidates
      where company_id=v_company and id=v_subject_id;
      v_evidence:=v_entity.evidence_id; v_run:=v_entity.extraction_run_id;
      v_span:=v_entity.source_span;
      select source_id into v_source from public.discovery_extraction_runs
        where company_id=v_company and id=v_run;
    else
      v_subject_id:=v_id;
    end if;
  when 'discovery_contact_candidates' then
    v_subject_kind:='contact_candidate'; v_subject_id:=v_id;
    v_event_type:='contact_candidate_observed'; v_field:='contact_point';
    v_decision:=p_row->>'review_state';
    v_evidence:=nullif(p_row->>'evidence_id','')::uuid;
    v_run:=nullif(p_row->>'extraction_run_id','')::uuid;
    v_span:=coalesce(p_row->'source_span','{}'::jsonb);
    v_metadata:=jsonb_build_object('contactType',p_row->>'contact_type',
      'validationResult',p_row->>'validation_result','masked',true);
    select source_id into v_source from public.discovery_extraction_runs
      where company_id=v_company and id=v_run;
  when 'discovery_contact_points' then
    v_subject_kind:='contact_point'; v_subject_id:=v_id;
    v_event_type:='contact_point_recorded'; v_field:='contact_point';
    v_decision:=p_row->>'status';
    v_evidence:=nullif(p_row->>'source_evidence_id','')::uuid;
    v_metadata:=jsonb_build_object('contactType',p_row->>'contact_type',
      'status',p_row->>'status','masked',true);
  when 'discovery_place_candidates' then
    v_subject_kind:='place_candidate'; v_subject_id:=v_id;
    v_event_type:='place_candidate_observed'; v_field:='location';
    v_decision:=p_row->>'candidate_state';
    v_evidence:=nullif(p_row->>'evidence_id','')::uuid;
    v_run:=nullif(p_row->>'extraction_run_id','')::uuid;
    v_span:=coalesce(p_row->'source_span','{}'::jsonb);
    select source_id into v_source from public.discovery_geo_resolution_jobs
      where company_id=v_company and id=(p_row->>'geo_job_id')::uuid;
    v_metadata:=jsonb_build_object('coordinateState',p_row->>'coordinate_state',
      'reviewState',p_row->>'review_state','provider',p_row->>'provider');
  when 'discovery_place_resolution_events' then
    v_subject_kind:='place_candidate'; v_subject_id:=coalesce(
      nullif(p_row->>'candidate_id','')::uuid,v_id);
    v_event_type:='place_reviewed'; v_field:='location';
    v_decision:=p_row->>'decision'; v_actor:=nullif(p_row->>'actor_user_id','')::uuid;
    if nullif(p_row->>'candidate_id','') is not null then
      select evidence_id,extraction_run_id,source_span,geo_job_id into v_entity
      from public.discovery_place_candidates
      where company_id=v_company and id=(p_row->>'candidate_id')::uuid;
      v_evidence:=v_entity.evidence_id; v_run:=v_entity.extraction_run_id;
      v_span:=v_entity.source_span;
      select source_id into v_source from public.discovery_geo_resolution_jobs
        where company_id=v_company and id=v_entity.geo_job_id;
    end if;
  when 'discovery_enrichment_observations' then
    v_subject_kind:='enrichment_observation'; v_subject_id:=v_id;
    v_event_type:='enrichment_observed'; v_field:=p_row->>'source_field_name';
    v_decision:=p_row->>'review_state';
    v_source:=nullif(p_row->>'source_id','')::uuid;
    v_evidence:=nullif(p_row->>'evidence_id','')::uuid;
    v_run:=nullif(p_row->>'extraction_run_id','')::uuid;
    v_span:=coalesce(p_row->'source_span','{}'::jsonb);
    v_snapshot:=jsonb_build_object(
      'sourceName',p_row->>'source_name','sourceDomain',p_row->>'source_domain',
      'sourceJurisdiction',p_row->>'source_jurisdiction',
      'sourceAttribution',p_row->>'source_attribution',
      'sourceLicenseRef',p_row->>'source_license_ref',
      'evidenceContentHash',p_row->>'evidence_content_hash',
      'evidenceCapturedAt',p_row->>'evidence_captured_at',
      'sourcePublishedAt',p_row->>'source_published_at'
    );
    v_metadata:=jsonb_build_object('attributeKey',p_row->>'attribute_key',
      'sourceFieldName',p_row->>'source_field_name','valueType',p_row->>'value_type',
      'confidence',p_row->>'source_confidence');
  when 'discovery_enrichment_review_events' then
    v_decision:=p_row->>'decision'; v_actor:=nullif(p_row->>'actor_user_id','')::uuid;
    if nullif(p_row->>'observation_id','') is not null then
      select * into v_obs from public.discovery_enrichment_observations
        where company_id=v_company and id=(p_row->>'observation_id')::uuid;
      v_subject_kind:='enrichment_observation'; v_subject_id:=v_obs.id;
      v_event_type:='enrichment_observation_reviewed'; v_field:=v_obs.source_field_name;
      v_source:=v_obs.source_id; v_evidence:=v_obs.evidence_id; v_run:=v_obs.extraction_run_id;
      v_span:=v_obs.source_span;
      v_snapshot:=jsonb_build_object('sourceName',v_obs.source_name,
        'sourceDomain',v_obs.source_domain,'sourceJurisdiction',v_obs.source_jurisdiction,
        'sourceAttribution',v_obs.source_attribution,'sourceLicenseRef',v_obs.source_license_ref,
        'evidenceContentHash',v_obs.evidence_content_hash,
        'evidenceCapturedAt',v_obs.evidence_captured_at,
        'sourcePublishedAt',v_obs.source_published_at);
      v_metadata:=jsonb_build_object('decision',v_decision);
      perform public.append_discovery_provenance_event(v_company,p_origin_table,v_id,
        v_subject_kind,v_subject_id,v_event_type,v_field,v_decision,v_source,v_evidence,
        v_run,v_span,v_actor,v_metadata,v_snapshot);
      return;
    elsif nullif(p_row->>'conflict_id','') is not null then
      select * into v_conflict from public.discovery_enrichment_conflicts
        where company_id=v_company and id=(p_row->>'conflict_id')::uuid;
      for v_obs in
        select * from public.discovery_enrichment_observations
        where company_id=v_company and id in (v_conflict.candidate_a,v_conflict.candidate_b)
      loop
        v_snapshot:=jsonb_build_object('sourceName',v_obs.source_name,
          'sourceDomain',v_obs.source_domain,'sourceJurisdiction',v_obs.source_jurisdiction,
          'sourceAttribution',v_obs.source_attribution,'sourceLicenseRef',v_obs.source_license_ref,
          'evidenceContentHash',v_obs.evidence_content_hash,
          'evidenceCapturedAt',v_obs.evidence_captured_at,
          'sourcePublishedAt',v_obs.source_published_at);
        perform public.append_discovery_provenance_event(v_company,p_origin_table,v_id,
          'enrichment_observation',v_obs.id,'enrichment_conflict_reviewed',
          v_obs.source_field_name,v_decision,v_obs.source_id,v_obs.evidence_id,
          v_obs.extraction_run_id,v_obs.source_span,v_actor,
          jsonb_build_object('conflictId',p_row->>'conflict_id'),v_snapshot);
      end loop;
      return;
    end if;
  when 'discovery_match_results' then
    v_subject_kind:='match_result'; v_subject_id:=v_id;
    v_event_type:='match_score_recorded'; v_field:='workspace_fit_score';
    v_decision:=p_row->>'review_state';
    v_metadata:=jsonb_build_object('workspaceKey',p_row->>'workspace_key',
      'criteriaVersion',p_row->>'criteria_version','score',p_row->>'score',
      'confidence',p_row->>'confidence','eligible',p_row->>'eligible',
      'method',p_row->>'method','canonicalEntityId',p_row->>'canonical_entity_id');
  when 'discovery_deduplication_candidates' then
    v_subject_kind:='deduplication_candidate'; v_subject_id:=v_id;
    v_event_type:='deduplication_candidate_created'; v_field:='duplicate_candidate';
    v_decision:=p_row->>'review_state';
    v_metadata:=jsonb_build_object('candidateKind',p_row->>'candidate_kind',
      'matchRule',p_row->>'match_rule','leftRecordId',p_row->>'left_record_id',
      'rightRecordId',p_row->>'right_record_id','strength',p_row->>'strength');
  when 'discovery_deduplication_review_events' then
    v_subject_kind:='deduplication_candidate';
    v_subject_id:=coalesce(nullif(p_row->>'candidate_id','')::uuid,v_id);
    v_event_type:='deduplication_reviewed'; v_field:='duplicate_candidate';
    v_decision:=p_row->>'decision'; v_actor:=nullif(p_row->>'actor_user_id','')::uuid;
    v_metadata:=jsonb_build_object('candidateKind',p_row->>'candidate_kind',
      'matchRule',p_row->>'match_rule','leftRecordId',p_row->>'left_record_id',
      'rightRecordId',p_row->>'right_record_id');
  when 'discovery_fetch_events' then
    if p_row->>'event_type'<>'retention_purged' then return; end if;
    v_subject_kind:='evidence'; v_subject_id:=nullif(p_row->>'evidence_id','')::uuid;
    if v_subject_id is null then return; end if;
    v_event_type:='evidence_retention_purged'; v_field:='raw_evidence';
    v_source:=nullif(p_row->>'source_id','')::uuid;
    v_evidence:=v_subject_id;
    v_metadata:=jsonb_build_object('outcome',left(p_row->>'outcome',500),'occurredAt',p_row->>'occurred_at');
  else
    return;
  end case;

  if v_subject_id is null then v_subject_id:=v_id; end if;
  if v_field is null and v_subject_kind='entity_relationship' then v_field:='relationship'; end if;
  perform public.append_discovery_provenance_event(
    v_company,p_origin_table,v_id,v_subject_kind,v_subject_id,v_event_type,
    v_field,v_decision,v_source,v_evidence,v_run,v_span,v_actor,v_metadata,v_snapshot
  );
end;
$ingest$;

create or replace function public.capture_discovery_provenance_trigger()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $trigger$
begin
  perform public.ingest_discovery_provenance_record(tg_table_name,to_jsonb(new));
  return new;
end;
$trigger$;

-- Each source-backed record is captured once; repeated ingestion is idempotent.
do $triggers$
declare v_table text;
begin
  foreach v_table in array array[
    'discovery_audit_events','discovery_evidence_items','discovery_fetch_events',
    'discovery_extracted_entities','discovery_extracted_facts','discovery_extraction_review_events',
    'discovery_canonical_entities','discovery_entity_assignments',
    'discovery_entity_identifiers','discovery_entity_aliases',
    'discovery_entity_relationships','discovery_professional_role_candidates',
    'discovery_professional_role_assignments','discovery_professional_role_review_events',
    'discovery_contact_candidates','discovery_contact_points',
    'discovery_place_candidates','discovery_place_resolution_events',
    'discovery_enrichment_observations','discovery_enrichment_review_events',
    'discovery_match_results','discovery_deduplication_candidates',
    'discovery_deduplication_review_events'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I',v_table||'_provenance_insert',v_table);
    execute format('create trigger %I after insert on public.%I for each row execute function public.capture_discovery_provenance_trigger()',
      v_table||'_provenance_insert',v_table);
  end loop;
end;
$triggers$;

-- Backfill provenance for records created before E13 was installed.
do $backfill$
declare r record;
begin
  for r in select to_jsonb(x) as row_data from public.discovery_audit_events x
    where x.entity_type='source' and x.action in ('source_registered','source_approved','source_paused','source_rejected')
  loop
    perform public.ingest_discovery_provenance_record('discovery_audit_events',r.row_data);
  end loop;
  for r in select to_jsonb(x) as row_data from public.discovery_evidence_items x loop
    perform public.ingest_discovery_provenance_record('discovery_evidence_items',r.row_data);
  end loop;
  for r in select to_jsonb(x) as row_data from public.discovery_extracted_entities x loop
    perform public.ingest_discovery_provenance_record('discovery_extracted_entities',r.row_data);
  end loop;
  for r in select to_jsonb(x) as row_data from public.discovery_extracted_facts x loop
    perform public.ingest_discovery_provenance_record('discovery_extracted_facts',r.row_data);
  end loop;
  for r in select to_jsonb(x) as row_data from public.discovery_extraction_review_events x loop
    perform public.ingest_discovery_provenance_record('discovery_extraction_review_events',r.row_data);
  end loop;
  for r in select to_jsonb(x) as row_data from public.discovery_canonical_entities x loop
    perform public.ingest_discovery_provenance_record('discovery_canonical_entities',r.row_data);
  end loop;
  for r in select to_jsonb(x) as row_data from public.discovery_entity_assignments x loop
    perform public.ingest_discovery_provenance_record('discovery_entity_assignments',r.row_data);
  end loop;
  for r in select to_jsonb(x) as row_data from public.discovery_entity_identifiers x loop
    perform public.ingest_discovery_provenance_record('discovery_entity_identifiers',r.row_data);
  end loop;
  for r in select to_jsonb(x) as row_data from public.discovery_entity_aliases x loop
    perform public.ingest_discovery_provenance_record('discovery_entity_aliases',r.row_data);
  end loop;
  for r in select to_jsonb(x) as row_data from public.discovery_entity_relationships x loop
    perform public.ingest_discovery_provenance_record('discovery_entity_relationships',r.row_data);
  end loop;
  for r in select to_jsonb(x) as row_data from public.discovery_professional_role_candidates x loop
    perform public.ingest_discovery_provenance_record('discovery_professional_role_candidates',r.row_data);
  end loop;
  for r in select to_jsonb(x) as row_data from public.discovery_professional_role_assignments x loop
    perform public.ingest_discovery_provenance_record('discovery_professional_role_assignments',r.row_data);
  end loop;
  for r in select to_jsonb(x) as row_data from public.discovery_professional_role_review_events x loop
    perform public.ingest_discovery_provenance_record('discovery_professional_role_review_events',r.row_data);
  end loop;
  for r in select to_jsonb(x) as row_data from public.discovery_contact_candidates x loop
    perform public.ingest_discovery_provenance_record('discovery_contact_candidates',r.row_data);
  end loop;
  for r in select to_jsonb(x) as row_data from public.discovery_contact_points x loop
    perform public.ingest_discovery_provenance_record('discovery_contact_points',r.row_data);
  end loop;
  for r in select to_jsonb(x) as row_data from public.discovery_place_candidates x loop
    perform public.ingest_discovery_provenance_record('discovery_place_candidates',r.row_data);
  end loop;
  for r in select to_jsonb(x) as row_data from public.discovery_place_resolution_events x loop
    perform public.ingest_discovery_provenance_record('discovery_place_resolution_events',r.row_data);
  end loop;
  for r in select to_jsonb(x) as row_data from public.discovery_enrichment_observations x loop
    perform public.ingest_discovery_provenance_record('discovery_enrichment_observations',r.row_data);
  end loop;
  for r in select to_jsonb(x) as row_data from public.discovery_enrichment_review_events x loop
    perform public.ingest_discovery_provenance_record('discovery_enrichment_review_events',r.row_data);
  end loop;
  for r in select to_jsonb(x) as row_data from public.discovery_match_results x loop
    perform public.ingest_discovery_provenance_record('discovery_match_results',r.row_data);
  end loop;
  for r in select to_jsonb(x) as row_data from public.discovery_deduplication_candidates x loop
    perform public.ingest_discovery_provenance_record('discovery_deduplication_candidates',r.row_data);
  end loop;
  for r in select to_jsonb(x) as row_data from public.discovery_deduplication_review_events x loop
    perform public.ingest_discovery_provenance_record('discovery_deduplication_review_events',r.row_data);
  end loop;
  for r in select to_jsonb(x) as row_data from public.discovery_fetch_events x
    where x.event_type='retention_purged'
  loop
    perform public.ingest_discovery_provenance_record('discovery_fetch_events',r.row_data);
  end loop;
end;
$backfill$;

create or replace view public.discovery_field_provenance
with (security_invoker=true) as
select p.id as provenance_event_id,p.company_id,p.subject_kind,p.subject_id,
       p.field_name,p.event_type,p.decision,p.source_id,p.evidence_id,
       p.extraction_run_id,p.evidence_content_hash,p.evidence_captured_at,
       p.source_published_at,p.source_name_snapshot,p.source_domain_snapshot,
       p.source_jurisdiction_snapshot,p.source_attribution_snapshot,
       p.source_license_ref_snapshot,p.source_license_snapshot,p.source_span,
       p.actor_user_id,p.origin_table,p.origin_record_id,p.event_metadata,
       p.occurred_at,
       case
         when p.evidence_id is null then null
         when exists (
           select 1 from public.discovery_provenance_events rp
           where rp.company_id=p.company_id and rp.evidence_id=p.evidence_id
             and rp.event_type='evidence_retention_purged'
         ) then false
         else true
       end as evidence_retained
from public.discovery_provenance_events p;

grant select on public.discovery_field_provenance to authenticated,service_role;

comment on table public.discovery_provenance_events is
  'E13 append-only, company-scoped lineage metadata. Historical evidence IDs and hashes remain after raw evidence retention purge; no raw values or source URLs are copied.';
comment on view public.discovery_field_provenance is
  'E13 company-member-readable field lineage with source snapshots, allowlisted source spans and retention status.';

revoke all on function public.append_discovery_provenance_event(uuid,text,uuid,text,uuid,text,text,text,uuid,uuid,uuid,jsonb,uuid,jsonb,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.ingest_discovery_provenance_record(text,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.capture_discovery_provenance_trigger()
  from public,anon,authenticated,service_role;

commit;
