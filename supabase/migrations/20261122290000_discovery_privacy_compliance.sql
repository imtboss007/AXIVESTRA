-- AXIVESTRA E14: privacy requests, purpose/retention governance and controlled erasure.
-- Request intake stores no names, emails, phone numbers or identity documents.
-- Erasure is explicit, company-scoped and owner/admin authorised; no job runs automatically.
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
    'privacy_request_fulfilled','privacy_retention_queued','privacy_retention_processed'
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
    'privacy_subject','privacy_retention_job'
  ));

-- The existing E07/E08 dates are the source-of-record expiries. E14 adds a
-- reviewed company policy record, binding purpose, lawful basis and retention.
create table if not exists public.discovery_privacy_processing_policies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  data_category text not null check (data_category in (
    'professional_identity','contact_point','extracted_personal_data',
    'raw_evidence','provenance_metadata'
  )),
  processing_purpose text not null check (length(trim(processing_purpose)) between 1 and 300),
  lawful_basis_code text not null check (lawful_basis_code in (
    'consent','contract','legal_obligation','legitimate_interests',
    'public_task','vital_interests','other'
  )),
  lawful_basis_reference text not null check (length(trim(lawful_basis_reference)) between 1 and 500),
  maximum_retention_days integer not null check (maximum_retention_days between 1 and 3650),
  retention_rationale text not null check (length(trim(retention_rationale)) between 1 and 1000),
  review_due_at date not null,
  active boolean not null default true,
  approved_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,id),
  unique(company_id,data_category,processing_purpose)
);
create index if not exists discovery_privacy_policy_active_idx
  on public.discovery_privacy_processing_policies(company_id,data_category,active,review_due_at);

create table if not exists public.discovery_privacy_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  request_type text not null check (request_type in (
    'access','rectification','erasure','restriction','objection','portability'
  )),
  requester_relationship text not null check (requester_relationship in (
    'data_subject','authorised_representative','regulator','company_member','other'
  )),
  -- Optional keyed HMAC reference only; never store names or contact details here.
  requester_reference_hmac text check (
    requester_reference_hmac is null or requester_reference_hmac ~ '^[a-f0-9]{64}$'
  ),
  status text not null default 'received' check (status in (
    'received','identity_verification_pending','verified','under_review',
    'approved','rejected','fulfilled','partially_fulfilled','closed'
  )),
  verification_method text check (verification_method is null or verification_method in (
    'authenticated_account','manual_document_check','authorised_representative_check',
    'regulator_notice','other'
  )),
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  requested_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  due_at timestamptz not null,
  closed_at timestamptz,
  check ((verified_at is null and verified_by is null) or
         (verified_at is not null and verified_by is not null)),
  unique(company_id,id)
);
create index if not exists discovery_privacy_requests_status_idx
  on public.discovery_privacy_requests(company_id,status,due_at);
create index if not exists discovery_privacy_requests_created_idx
  on public.discovery_privacy_requests(company_id,created_at desc);

create table if not exists public.discovery_privacy_request_subjects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  request_id uuid not null,
  subject_table text not null check (subject_table in (
    'discovery_professional_people','discovery_contact_points',
    'discovery_contact_candidates','discovery_professional_role_candidates',
    'discovery_extracted_entities','discovery_extracted_facts'
  )),
  subject_record_id uuid not null,
  resolution_state text not null default 'pending' check (resolution_state in (
    'pending','restricted','erased','retained_legal_basis','corrected_by_new_record'
  )),
  action text check (action is null or action in (
    'restrict','erase','retain_legal_basis','correct_by_new_record'
  )),
  reason_code text check (reason_code is null or reason_code in (
    'verified_request','retention_expired','legal_obligation','litigation_hold',
    'identity_unverified','source_correction','other_documented_basis'
  )),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique(company_id,id),
  unique(company_id,request_id,subject_table,subject_record_id),
  foreign key(request_id)
    references public.discovery_privacy_requests(id) on delete cascade,
  check ((resolution_state='pending' and action is null and resolved_at is null)
      or (resolution_state<>'pending' and action is not null and resolved_at is not null))
);
create index if not exists discovery_privacy_request_subjects_request_idx
  on public.discovery_privacy_request_subjects(company_id,request_id,resolution_state);
create index if not exists discovery_privacy_request_subjects_record_idx
  on public.discovery_privacy_request_subjects(company_id,subject_table,subject_record_id);

create table if not exists public.discovery_privacy_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  request_id uuid,
  request_subject_id uuid,
  subject_table text check (subject_table is null or subject_table in (
    'discovery_professional_people','discovery_contact_points',
    'discovery_contact_candidates','discovery_professional_role_candidates',
    'discovery_extracted_entities','discovery_extracted_facts'
  )),
  subject_record_id uuid,
  event_type text not null check (event_type in (
    'policy_recorded','request_created','identity_verified','identity_verification_failed',
    'subject_attached','review_started','subject_restricted','subject_erased',
    'subject_retained_legal_basis','subject_corrected_by_new_record',
    'retention_queued','retention_processed','request_fulfilled','request_partially_fulfilled',
    'request_rejected','request_closed'
  )),
  reason_code text not null check (reason_code in (
    'verified_request','retention_expired','legal_obligation','litigation_hold',
    'identity_unverified','source_correction','other_documented_basis','none'
  )),
  actor_user_id uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details)='object' and octet_length(details::text)<=2000),
  occurred_at timestamptz not null default now(),
  unique(company_id,id),
  foreign key(request_id)
    references public.discovery_privacy_requests(id) on delete set null,
  foreign key(request_subject_id)
    references public.discovery_privacy_request_subjects(id) on delete set null
);
create index if not exists discovery_privacy_events_request_idx
  on public.discovery_privacy_events(company_id,request_id,occurred_at desc);
create index if not exists discovery_privacy_events_subject_idx
  on public.discovery_privacy_events(company_id,subject_table,subject_record_id,occurred_at desc);

create table if not exists public.discovery_privacy_retention_queue (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  subject_table text not null check (subject_table in (
    'discovery_professional_people','discovery_contact_points'
  )),
  subject_record_id uuid not null,
  data_category text not null check (data_category in ('professional_identity','contact_point')),
  due_at date not null,
  reason_code text not null default 'retention_expired'
    check (reason_code in ('retention_expired','approved_erasure')),
  status text not null default 'queued'
    check (status in ('queued','processing','completed','retained','failed')),
  attempts integer not null default 0 check (attempts>=0),
  last_error_code text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  processed_by uuid references auth.users(id) on delete set null,
  unique(company_id,subject_table,subject_record_id,reason_code)
);
create index if not exists discovery_privacy_retention_queue_claim_idx
  on public.discovery_privacy_retention_queue(company_id,status,due_at,created_at);

-- Make identity links nullable so erasure can preserve non-identifying role history.
alter table public.discovery_professional_role_assignments
  alter column professional_person_id drop not null;
alter table public.discovery_professional_role_assignments
  drop constraint if exists discovery_professional_role_assignments_company_id_professional_person_id_fkey;
alter table public.discovery_professional_role_assignments
  add constraint discovery_professional_role_assignments_person_erasure_fkey
  foreign key(professional_person_id) references public.discovery_professional_people(id) on delete set null;

alter table public.discovery_professional_role_review_events
  drop constraint if exists discovery_professional_role_review_events_company_id_professional_person_id_fkey;
alter table public.discovery_professional_role_review_events
  add constraint discovery_professional_role_review_person_erasure_fkey
  foreign key(professional_person_id) references public.discovery_professional_people(id) on delete set null;

alter table public.discovery_contact_points
  drop constraint if exists discovery_contact_points_company_id_professional_person_id_fkey;
alter table public.discovery_contact_points
  add constraint discovery_contact_points_person_erasure_fkey
  foreign key(professional_person_id) references public.discovery_professional_people(id) on delete set null;

-- Privacy case data is visible only to company owners/admins; all writes use
-- SECURITY DEFINER RPCs with explicit company-role checks.
alter table public.discovery_privacy_processing_policies enable row level security;
alter table public.discovery_privacy_requests enable row level security;
alter table public.discovery_privacy_request_subjects enable row level security;
alter table public.discovery_privacy_events enable row level security;
alter table public.discovery_privacy_retention_queue enable row level security;

drop policy if exists discovery_privacy_policies_admin_read on public.discovery_privacy_processing_policies;
create policy discovery_privacy_policies_admin_read
  on public.discovery_privacy_processing_policies for select to authenticated
  using (public.has_company_role(company_id,array['owner','admin']));
drop policy if exists discovery_privacy_requests_admin_read on public.discovery_privacy_requests;
create policy discovery_privacy_requests_admin_read
  on public.discovery_privacy_requests for select to authenticated
  using (public.has_company_role(company_id,array['owner','admin']));
drop policy if exists discovery_privacy_subjects_admin_read on public.discovery_privacy_request_subjects;
create policy discovery_privacy_subjects_admin_read
  on public.discovery_privacy_request_subjects for select to authenticated
  using (public.has_company_role(company_id,array['owner','admin']));
drop policy if exists discovery_privacy_events_admin_read on public.discovery_privacy_events;
create policy discovery_privacy_events_admin_read
  on public.discovery_privacy_events for select to authenticated
  using (public.has_company_role(company_id,array['owner','admin']));
drop policy if exists discovery_privacy_queue_admin_read on public.discovery_privacy_retention_queue;
create policy discovery_privacy_queue_admin_read
  on public.discovery_privacy_retention_queue for select to authenticated
  using (public.has_company_role(company_id,array['owner','admin']));

revoke all on public.discovery_privacy_processing_policies,public.discovery_privacy_requests,
  public.discovery_privacy_request_subjects,public.discovery_privacy_events,
  public.discovery_privacy_retention_queue from public,anon,authenticated;
grant select on public.discovery_privacy_processing_policies,public.discovery_privacy_requests,
  public.discovery_privacy_request_subjects,public.discovery_privacy_events,
  public.discovery_privacy_retention_queue to authenticated;
grant all on public.discovery_privacy_processing_policies,public.discovery_privacy_requests,
  public.discovery_privacy_request_subjects,public.discovery_privacy_events,
  public.discovery_privacy_retention_queue to service_role;

create or replace function public.prevent_discovery_privacy_event_mutation()
returns trigger language plpgsql
as $guard$
begin
  -- Permit FK-driven SET NULL/CASCADE housekeeping, but never direct mutation.
  if pg_trigger_depth()>1 then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  raise exception 'E14 privacy events are immutable; append a new event instead.';
end;
$guard$;

-- E08 validation receipts are immutable except for an explicit privacy
-- subject-detachment marker and FK-driven SET NULL operations.
create or replace function public.prevent_discovery_contact_validation_event_mutation()
returns trigger language plpgsql
as $guard$
begin
  if tg_op='UPDATE'
    and new.contact_point_id is null and new.contact_candidate_id is null
    and (old.contact_point_id is not null or old.contact_candidate_id is not null)
    and new.metadata->>'subjectErased'='true' then
    return new;
  end if;
  if pg_trigger_depth()>1 then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  raise exception 'E08 contact validation events are append-only except for privacy subject detachment.';
end;
$guard$;
drop trigger if exists discovery_contact_validation_events_no_update on public.discovery_contact_validation_events;
create trigger discovery_contact_validation_events_no_update
  before update or delete on public.discovery_contact_validation_events
  for each row execute function public.prevent_discovery_contact_validation_event_mutation();

alter table public.discovery_contact_validation_events
  drop constraint if exists discovery_contact_validation_events_check;
alter table public.discovery_contact_validation_events
  add constraint discovery_contact_validation_events_subject_check check (
    contact_candidate_id is not null or contact_point_id is not null
    or metadata->>'subjectErased'='true'
  );
drop trigger if exists discovery_privacy_events_no_mutation on public.discovery_privacy_events;
create trigger discovery_privacy_events_no_mutation
  before update or delete on public.discovery_privacy_events
  for each row execute function public.prevent_discovery_privacy_event_mutation();

create or replace function public.record_discovery_privacy_policy(
  p_company_id uuid,p_actor_user_id uuid,p_data_category text,p_processing_purpose text,
  p_lawful_basis_code text,p_lawful_basis_reference text,p_maximum_retention_days integer,
  p_retention_rationale text,p_review_due_at date,p_active boolean default true
) returns public.discovery_privacy_processing_policies
language plpgsql security definer set search_path=public,pg_temp
as $policy$
declare v_policy public.discovery_privacy_processing_policies%rowtype;
begin
  if p_actor_user_id is null or not exists(
    select 1 from public.company_memberships where company_id=p_company_id and user_id=p_actor_user_id and role in ('owner','admin')
  ) then raise exception 'E14 policy actor must be a company owner/admin' using errcode='42501'; end if;
  if p_data_category not in ('professional_identity','contact_point','extracted_personal_data','raw_evidence','provenance_metadata')
    or p_maximum_retention_days not between 1 and 3650
    or p_review_due_at is null or p_review_due_at<=current_date
    or length(trim(coalesce(p_processing_purpose,''))) not between 1 and 300
    or length(trim(coalesce(p_lawful_basis_reference,''))) not between 1 and 500
    or length(trim(coalesce(p_retention_rationale,''))) not between 1 and 1000 then
    raise exception 'E14 policy fields are incomplete or outside bounds' using errcode='22023';
  end if;
  insert into public.discovery_privacy_processing_policies(
    company_id,data_category,processing_purpose,lawful_basis_code,lawful_basis_reference,
    maximum_retention_days,retention_rationale,review_due_at,active,approved_by,approved_at,updated_at
  ) values (
    p_company_id,p_data_category,trim(p_processing_purpose),p_lawful_basis_code,
    trim(p_lawful_basis_reference),p_maximum_retention_days,trim(p_retention_rationale),
    p_review_due_at,coalesce(p_active,true),p_actor_user_id,clock_timestamp(),clock_timestamp()
  ) on conflict(company_id,data_category,processing_purpose) do update set
    lawful_basis_code=excluded.lawful_basis_code,
    lawful_basis_reference=excluded.lawful_basis_reference,
    maximum_retention_days=excluded.maximum_retention_days,
    retention_rationale=excluded.retention_rationale,
    review_due_at=excluded.review_due_at,active=excluded.active,
    approved_by=excluded.approved_by,approved_at=clock_timestamp(),updated_at=clock_timestamp()
  returning * into v_policy;

  insert into public.discovery_privacy_events(company_id,event_type,reason_code,actor_user_id,details)
  values(p_company_id,'policy_recorded','other_documented_basis',p_actor_user_id,
    jsonb_build_object('policyId',v_policy.id,'category',p_data_category,
      'processingPurpose',left(trim(p_processing_purpose),300),
      'maximumRetentionDays',p_maximum_retention_days,'active',p_active));
  insert into public.discovery_audit_events(company_id,actor_user_id,action,entity_type,entity_id,details)
  values(p_company_id,p_actor_user_id,'privacy_policy_recorded','privacy_policy',v_policy.id,
    jsonb_build_object('category',p_data_category,'maximumRetentionDays',p_maximum_retention_days));
  return v_policy;
end;
$policy$;

create or replace function public.create_discovery_privacy_request(
  p_company_id uuid,p_actor_user_id uuid,p_request_type text,
  p_requester_relationship text,p_requester_reference_hmac text,p_due_at timestamptz
) returns public.discovery_privacy_requests
language plpgsql security definer set search_path=public,pg_temp
as $create$
declare v_request public.discovery_privacy_requests%rowtype;
begin
  if p_actor_user_id is null or not exists(
      select 1 from public.company_memberships where company_id=p_company_id and user_id=p_actor_user_id and role in ('owner','admin')
    ) then raise exception 'Only a company owner/admin may register a privacy request' using errcode='42501'; end if;
  if p_request_type not in ('access','rectification','erasure','restriction','objection','portability')
    or p_requester_relationship not in ('data_subject','authorised_representative','regulator','company_member','other')
    or p_due_at is null or p_due_at<=clock_timestamp() then
    raise exception 'E14 request type, requester relationship and future due date are required' using errcode='22023';
  end if;
  if p_requester_reference_hmac is not null and p_requester_reference_hmac !~ '^[a-f0-9]{64}$' then
    raise exception 'E14 requester reference must be a 64-character keyed HMAC' using errcode='22023';
  end if;
  insert into public.discovery_privacy_requests(
    company_id,request_type,requester_relationship,requester_reference_hmac,
    requested_by,due_at,status
  ) values(
    p_company_id,p_request_type,p_requester_relationship,p_requester_reference_hmac,
    p_actor_user_id,p_due_at,'received'
  ) returning * into v_request;
  insert into public.discovery_privacy_events(company_id,request_id,event_type,reason_code,actor_user_id)
  values(p_company_id,v_request.id,'request_created','none',p_actor_user_id);
  insert into public.discovery_audit_events(company_id,actor_user_id,action,entity_type,entity_id,details)
  values(p_company_id,p_actor_user_id,'privacy_request_created','privacy_request',v_request.id,
    jsonb_build_object('requestType',p_request_type,'requesterRelationship',p_requester_relationship));
  return v_request;
end;
$create$;

create or replace function public.verify_discovery_privacy_request(
  p_company_id uuid,p_actor_user_id uuid,p_request_id uuid,p_verification_method text,p_verified boolean
) returns public.discovery_privacy_requests
language plpgsql security definer set search_path=public,pg_temp
as $verify$
declare v_request public.discovery_privacy_requests%rowtype; v_status text;
begin
  if p_actor_user_id is null or not exists(
      select 1 from public.company_memberships where company_id=p_company_id and user_id=p_actor_user_id and role in ('owner','admin')
    ) then raise exception 'Only a company owner/admin may verify a privacy request' using errcode='42501'; end if;
  if p_verification_method not in ('authenticated_account','manual_document_check','authorised_representative_check','regulator_notice','other') then
    raise exception 'Unsupported E14 identity verification method' using errcode='22023';
  end if;
  select * into v_request from public.discovery_privacy_requests
  where company_id=p_company_id and id=p_request_id for update;
  if not found or v_request.status not in ('received','identity_verification_pending') then
    raise exception 'E14 privacy request is not awaiting identity verification' using errcode='P0002';
  end if;
  v_status:=case when p_verified then 'verified' else 'identity_verification_pending' end;
  update public.discovery_privacy_requests set status=v_status,
    verification_method=case when p_verified then p_verification_method else null end,
    verified_by=case when p_verified then p_actor_user_id else null end,
    verified_at=case when p_verified then clock_timestamp() else null end
  where id=v_request.id returning * into v_request;
  insert into public.discovery_privacy_events(company_id,request_id,event_type,reason_code,actor_user_id)
  values(p_company_id,v_request.id,case when p_verified then 'identity_verified' else 'identity_verification_failed' end,
    case when p_verified then 'verified_request' else 'identity_unverified' end,p_actor_user_id);
  if p_verified then
    insert into public.discovery_audit_events(company_id,actor_user_id,action,entity_type,entity_id,details)
    values(p_company_id,p_actor_user_id,'privacy_request_verified','privacy_request',v_request.id,
      jsonb_build_object('verificationMethod',p_verification_method));
  end if;
  return v_request;
end;
$verify$;

create or replace function public.attach_discovery_privacy_request_subject(
  p_company_id uuid,p_actor_user_id uuid,p_request_id uuid,p_subject_table text,p_subject_record_id uuid
) returns public.discovery_privacy_request_subjects
language plpgsql security definer set search_path=public,pg_temp
as $attach$
declare v_request public.discovery_privacy_requests%rowtype; v_exists boolean; v_subject public.discovery_privacy_request_subjects%rowtype;
begin
  if p_actor_user_id is null or not exists(
      select 1 from public.company_memberships where company_id=p_company_id and user_id=p_actor_user_id and role in ('owner','admin')
    ) then raise exception 'Only a company owner/admin may scope a privacy request' using errcode='42501'; end if;
  select * into v_request from public.discovery_privacy_requests
  where company_id=p_company_id and id=p_request_id for update;
  if not found or v_request.status not in ('verified','under_review') then
    raise exception 'E14 request must be identity-verified before records are attached' using errcode='42501';
  end if;
  if p_subject_table not in (
    'discovery_professional_people','discovery_contact_points','discovery_contact_candidates',
    'discovery_professional_role_candidates','discovery_extracted_entities','discovery_extracted_facts'
  ) then raise exception 'Unsupported E14 data subject table' using errcode='22023'; end if;
  execute format('select exists(select 1 from public.%I where company_id=$1 and id=$2)',p_subject_table)
    into v_exists using p_company_id,p_subject_record_id;
  if not v_exists then raise exception 'E14 subject record does not exist in this company' using errcode='42501'; end if;

  insert into public.discovery_privacy_request_subjects(
    company_id,request_id,subject_table,subject_record_id
  ) values(p_company_id,p_request_id,p_subject_table,p_subject_record_id)
  on conflict(company_id,request_id,subject_table,subject_record_id) do update set
    subject_record_id=excluded.subject_record_id
  returning * into v_subject;
  update public.discovery_privacy_requests set status='under_review'
    where company_id=p_company_id and id=p_request_id;
  insert into public.discovery_privacy_events(
    company_id,request_id,request_subject_id,subject_table,subject_record_id,
    event_type,reason_code,actor_user_id
  ) values(p_company_id,p_request_id,v_subject.id,p_subject_table,p_subject_record_id,
    'subject_attached','verified_request',p_actor_user_id);
  return v_subject;
end;
$attach$;

create or replace function public.erase_discovery_personal_subject(
  p_company_id uuid,p_subject_table text,p_subject_record_id uuid
) returns boolean
language plpgsql security definer set search_path=public,pg_temp
as $erase$
declare v_candidate record; v_point uuid; v_fact_id uuid; v_candidate_id uuid;
begin
  if p_subject_table='discovery_contact_points' then
    for v_point in select id from public.discovery_contact_points
      where company_id=p_company_id and id=p_subject_record_id
    loop
      select cc.id,cc.extracted_fact_id into v_candidate_id,v_fact_id
        from public.discovery_contact_candidates cc
        join public.discovery_contact_points cp
          on cp.company_id=cc.company_id and cp.source_candidate_id=cc.id
        where cp.company_id=p_company_id and cp.id=v_point;
      update public.discovery_contact_validation_events
        set contact_point_id=null,contact_candidate_id=null,
          metadata=metadata||jsonb_build_object('subjectErased',true)
        where company_id=p_company_id and contact_point_id=v_point;
      delete from public.discovery_contact_points where company_id=p_company_id and id=v_point;
      if v_candidate_id is not null then
        update public.discovery_contact_validation_events
          set contact_point_id=null,contact_candidate_id=null,
            metadata=metadata||jsonb_build_object('subjectErased',true)
          where company_id=p_company_id and contact_candidate_id=v_candidate_id;
        delete from public.discovery_contact_candidates
          where company_id=p_company_id and id=v_candidate_id;
      end if;
      if v_fact_id is not null then
        delete from public.discovery_extracted_facts
          where company_id=p_company_id and id=v_fact_id;
      end if;
    end loop;
  elsif p_subject_table='discovery_professional_people' then
    for v_point in select id from public.discovery_contact_points
      where company_id=p_company_id and professional_person_id=p_subject_record_id
    loop
      perform public.erase_discovery_personal_subject(p_company_id,'discovery_contact_points',v_point);
    end loop;
    for v_candidate in
      select c.id,c.extracted_person_id
      from public.discovery_professional_role_candidates c
      join public.discovery_professional_role_review_events e
        on e.company_id=c.company_id and e.candidate_id=c.id
      where e.company_id=p_company_id and e.professional_person_id=p_subject_record_id
    loop
      perform public.erase_discovery_personal_subject(p_company_id,'discovery_extracted_entities',v_candidate.extracted_person_id);
      delete from public.discovery_professional_role_candidates
        where company_id=p_company_id and id=v_candidate.id;
    end loop;
    delete from public.discovery_professional_people
      where company_id=p_company_id and id=p_subject_record_id;
  elsif p_subject_table='discovery_professional_role_candidates' then
    select extracted_person_id into v_candidate
      from public.discovery_professional_role_candidates
      where company_id=p_company_id and id=p_subject_record_id;
    if found then
      perform public.erase_discovery_personal_subject(p_company_id,'discovery_extracted_entities',v_candidate.extracted_person_id);
    else
      delete from public.discovery_professional_role_candidates
        where company_id=p_company_id and id=p_subject_record_id;
    end if;
  elsif p_subject_table='discovery_contact_candidates' then
    select extracted_fact_id,extracted_entity_id,entity_kind into v_candidate
      from public.discovery_contact_candidates
      where company_id=p_company_id and id=p_subject_record_id;
    if found then
      for v_point in select id from public.discovery_contact_points
        where company_id=p_company_id and source_candidate_id=p_subject_record_id
      loop
        perform public.erase_discovery_personal_subject(p_company_id,'discovery_contact_points',v_point);
      end loop;
      delete from public.discovery_extracted_facts
        where company_id=p_company_id and id=v_candidate.extracted_fact_id;
      if v_candidate.entity_kind='person' then
        perform public.erase_discovery_personal_subject(p_company_id,'discovery_extracted_entities',v_candidate.extracted_entity_id);
      end if;
      delete from public.discovery_contact_candidates
        where company_id=p_company_id and id=p_subject_record_id;
    end if;
  elsif p_subject_table='discovery_extracted_entities' then
    for v_candidate in
      select id from public.discovery_contact_candidates
      where company_id=p_company_id and extracted_entity_id=p_subject_record_id
    loop
      for v_point in select id from public.discovery_contact_points
        where company_id=p_company_id and source_candidate_id=v_candidate.id
      loop
        perform public.erase_discovery_personal_subject(p_company_id,'discovery_contact_points',v_point);
      end loop;
    end loop;
    delete from public.discovery_professional_role_candidates
      where company_id=p_company_id and extracted_person_id=p_subject_record_id;
    delete from public.discovery_extracted_entities
      where company_id=p_company_id and id=p_subject_record_id;
  elsif p_subject_table='discovery_extracted_facts' then
    select id into v_candidate from public.discovery_contact_candidates
      where company_id=p_company_id and extracted_fact_id=p_subject_record_id;
    if found then
      perform public.erase_discovery_personal_subject(p_company_id,'discovery_contact_candidates',v_candidate.id);
    else
      delete from public.discovery_extracted_facts
        where company_id=p_company_id and id=p_subject_record_id;
    end if;
  else
    raise exception 'Unsupported E14 erasure target' using errcode='22023';
  end if;
  return true;
end;
$erase$;

create or replace function public.apply_discovery_privacy_subject_action(
  p_company_id uuid,p_actor_user_id uuid,p_request_id uuid,p_request_subject_id uuid,
  p_action text,p_reason_code text
) returns public.discovery_privacy_request_subjects
language plpgsql security definer set search_path=public,pg_temp
as $apply$
declare v_request public.discovery_privacy_requests%rowtype; v_subject public.discovery_privacy_request_subjects%rowtype;
begin
  if p_actor_user_id is null or not exists(
      select 1 from public.company_memberships where company_id=p_company_id and user_id=p_actor_user_id and role in ('owner','admin')
    ) then raise exception 'Only a company owner/admin may apply a privacy action' using errcode='42501'; end if;
  select * into v_request from public.discovery_privacy_requests
    where company_id=p_company_id and id=p_request_id for update;
  if not found or v_request.status not in ('verified','under_review','approved') then
    raise exception 'E14 privacy request is not verified for action' using errcode='42501'; end if;
  select * into v_subject from public.discovery_privacy_request_subjects
    where company_id=p_company_id and request_id=p_request_id and id=p_request_subject_id for update;
  if not found or v_subject.resolution_state<>'pending' then
    raise exception 'E14 privacy subject is missing or already resolved' using errcode='P0002'; end if;
  if p_action not in ('restrict','erase','retain_legal_basis','correct_by_new_record')
    or p_reason_code not in ('verified_request','retention_expired','legal_obligation','litigation_hold',
      'identity_unverified','source_correction','other_documented_basis') then
    raise exception 'E14 privacy action or reason code is unsupported' using errcode='22023'; end if;
  if (p_action='erase' and v_request.request_type not in ('erasure','objection'))
    or (p_action='restrict' and v_request.request_type not in ('restriction','objection'))
    or (p_action='correct_by_new_record' and v_request.request_type<>'rectification')
    or (p_action='retain_legal_basis' and v_request.request_type not in ('erasure','objection')) then
    raise exception 'E14 action does not match the verified privacy request type' using errcode='42501';
  end if;
  if p_action='restrict' then
    if v_subject.subject_table='discovery_professional_people' then
      update public.discovery_professional_people set status='restricted'
        where company_id=p_company_id and id=v_subject.subject_record_id;
    elsif v_subject.subject_table='discovery_contact_points' then
      update public.discovery_contact_points set status='restricted'
        where company_id=p_company_id and id=v_subject.subject_record_id;
    else raise exception 'E14 restriction is supported only for professional identities and approved contact points' using errcode='22023'; end if;
  elsif p_action='erase' then
    perform public.erase_discovery_personal_subject(p_company_id,v_subject.subject_table,v_subject.subject_record_id);
  elsif p_action='correct_by_new_record' then
    if v_subject.subject_table not in ('discovery_professional_role_candidates','discovery_extracted_entities','discovery_extracted_facts') then
      raise exception 'E14 source correction must be performed through a new source-backed record' using errcode='22023';
    end if;
  elsif p_action='retain_legal_basis' and p_reason_code not in ('legal_obligation','litigation_hold','other_documented_basis') then
    raise exception 'E14 retained personal data requires a documented legal/retention basis' using errcode='22023';
  end if;

  update public.discovery_privacy_request_subjects set
    action=p_action,
    reason_code=p_reason_code,
    resolution_state=case p_action
      when 'restrict' then 'restricted'
      when 'erase' then 'erased'
      when 'retain_legal_basis' then 'retained_legal_basis'
      else 'corrected_by_new_record' end,
    resolved_by=p_actor_user_id,resolved_at=clock_timestamp()
  where company_id=p_company_id and id=p_request_subject_id returning * into v_subject;

  insert into public.discovery_privacy_events(
    company_id,request_id,request_subject_id,subject_table,subject_record_id,
    event_type,reason_code,actor_user_id
  ) values(p_company_id,p_request_id,v_subject.id,v_subject.subject_table,v_subject.subject_record_id,
    case p_action when 'restrict' then 'subject_restricted' when 'erase' then 'subject_erased'
      when 'retain_legal_basis' then 'subject_retained_legal_basis' else 'subject_corrected_by_new_record' end,
    p_reason_code,p_actor_user_id);
  insert into public.discovery_audit_events(company_id,actor_user_id,action,entity_type,entity_id,details)
  values(p_company_id,p_actor_user_id,
    case p_action when 'restrict' then 'privacy_subject_restricted'
      when 'erase' then 'privacy_subject_erased' when 'retain_legal_basis' then 'privacy_subject_retained'
      else 'privacy_subject_restricted' end,
    'privacy_subject',v_subject.id,
    jsonb_build_object('requestId',p_request_id,'subjectTable',v_subject.subject_table,
      'action',p_action,'reasonCode',p_reason_code));
  return v_subject;
end;
$apply$;

create or replace function public.complete_discovery_privacy_request(
  p_company_id uuid,p_actor_user_id uuid,p_request_id uuid,p_partial boolean default false
) returns public.discovery_privacy_requests
language plpgsql security definer set search_path=public,pg_temp
as $complete$
declare v_request public.discovery_privacy_requests%rowtype; v_total integer; v_pending integer;
begin
  if p_actor_user_id is null or not exists(
      select 1 from public.company_memberships where company_id=p_company_id and user_id=p_actor_user_id and role in ('owner','admin')
    ) then raise exception 'Only a company owner/admin may close a privacy request' using errcode='42501'; end if;
  select * into v_request from public.discovery_privacy_requests
    where company_id=p_company_id and id=p_request_id for update;
  if not found or v_request.status not in ('verified','under_review','approved') then
    raise exception 'E14 request is not ready for completion' using errcode='42501'; end if;
  select count(*)::int,count(*) filter(where resolution_state='pending')::int
    into v_total,v_pending from public.discovery_privacy_request_subjects
    where company_id=p_company_id and request_id=p_request_id;
  if v_total=0 or v_pending>0 then
    raise exception 'E14 all scoped subjects must be resolved before request completion' using errcode='42501'; end if;
  if p_partial then
    update public.discovery_privacy_requests set status='partially_fulfilled',closed_at=clock_timestamp()
      where company_id=p_company_id and id=p_request_id returning * into v_request;
  else
    update public.discovery_privacy_requests set status='fulfilled',closed_at=clock_timestamp()
      where company_id=p_company_id and id=p_request_id returning * into v_request;
  end if;
  insert into public.discovery_privacy_events(company_id,request_id,event_type,reason_code,actor_user_id)
  values(p_company_id,p_request_id,case when p_partial then 'request_partially_fulfilled' else 'request_fulfilled' end,
    case when p_partial then 'other_documented_basis' else 'verified_request' end,p_actor_user_id);
  insert into public.discovery_audit_events(company_id,actor_user_id,action,entity_type,entity_id,details)
  values(p_company_id,p_actor_user_id,'privacy_request_fulfilled','privacy_request',p_request_id,
    jsonb_build_object('partial',p_partial,'scopedSubjects',v_total));
  return v_request;
end;
$complete$;

create or replace function public.enqueue_expired_discovery_personal_data(
  p_company_id uuid,p_actor_user_id uuid,p_limit integer default 100
) returns integer
language plpgsql security definer set search_path=public,pg_temp
as $queue$
declare v_added integer:=0; v_rows integer:=0; r record;
begin
  if p_actor_user_id is null or not exists(
      select 1 from public.company_memberships where company_id=p_company_id and user_id=p_actor_user_id and role in ('owner','admin')
    ) then raise exception 'Only a company owner/admin may queue E14 retention work' using errcode='42501'; end if;
  if p_limit<1 or p_limit>500 then raise exception 'E14 retention batch must be 1 to 500' using errcode='22023'; end if;
  for r in
    select 'discovery_professional_people'::text as subject_table,p.id as subject_record_id,
      'professional_identity'::text as data_category,
      least(p.retention_until,(p.created_at+make_interval(days=>policy.maximum_retention_days))::date) as due_at
    from public.discovery_professional_people p
    join public.discovery_privacy_processing_policies policy
      on policy.company_id=p.company_id and policy.data_category='professional_identity'
      and policy.processing_purpose=p.purpose and policy.active=true
      and policy.review_due_at>=current_date
    where p.company_id=p_company_id
      and least(p.retention_until,(p.created_at+make_interval(days=>policy.maximum_retention_days))::date)<=current_date
    union all
    select 'discovery_contact_points',c.id,'contact_point',
      least(c.retention_until,(c.created_at+make_interval(days=>policy.maximum_retention_days))::date)
    from public.discovery_contact_points c
    join public.discovery_privacy_processing_policies policy
      on policy.company_id=c.company_id and policy.data_category='contact_point'
      and policy.processing_purpose=c.purpose and policy.active=true
      and policy.review_due_at>=current_date
    where c.company_id=p_company_id
      and least(c.retention_until,(c.created_at+make_interval(days=>policy.maximum_retention_days))::date)<=current_date
    order by due_at
    limit p_limit
  loop
    insert into public.discovery_privacy_retention_queue(
      company_id,subject_table,subject_record_id,data_category,due_at,reason_code,status
    ) values(p_company_id,r.subject_table,r.subject_record_id,r.data_category,r.due_at,'retention_expired','queued')
    on conflict(company_id,subject_table,subject_record_id,reason_code) do nothing;
    get diagnostics v_rows=row_count;
    v_added:=v_added+v_rows;
  end loop;
  if v_added>0 then
    insert into public.discovery_privacy_events(company_id,event_type,reason_code,actor_user_id,details)
    values(p_company_id,'retention_queued','retention_expired',p_actor_user_id,
      jsonb_build_object('queuedCount',v_added));
    insert into public.discovery_audit_events(company_id,actor_user_id,action,entity_type,entity_id,details)
    values(p_company_id,p_actor_user_id,'privacy_retention_queued','privacy_retention_job',gen_random_uuid(),
      jsonb_build_object('queuedCount',v_added));
  end if;
  return v_added;
end;
$queue$;

create or replace function public.process_discovery_privacy_retention_queue(
  p_company_id uuid,p_actor_user_id uuid,p_limit integer default 50
) returns integer
language plpgsql security definer set search_path=public,pg_temp
as $process$
declare r record; v_processed integer:=0;
begin
  if p_actor_user_id is null or not exists(
      select 1 from public.company_memberships where company_id=p_company_id and user_id=p_actor_user_id and role in ('owner','admin')
    ) then raise exception 'Only a company owner/admin may execute E14 retention erasure' using errcode='42501'; end if;
  if p_limit<1 or p_limit>200 then raise exception 'E14 retention execution batch must be 1 to 200' using errcode='22023'; end if;
  for r in
    select * from public.discovery_privacy_retention_queue
    where company_id=p_company_id and status='queued' and due_at<=current_date
    order by due_at,created_at for update skip locked limit p_limit
  loop
    update public.discovery_privacy_retention_queue set status='processing',attempts=attempts+1
      where id=r.id;
    perform public.erase_discovery_personal_subject(p_company_id,r.subject_table,r.subject_record_id);
    update public.discovery_privacy_retention_queue set status='completed',
      processed_at=clock_timestamp(),processed_by=p_actor_user_id,last_error_code=null
      where id=r.id;
    insert into public.discovery_privacy_events(
      company_id,subject_table,subject_record_id,event_type,reason_code,actor_user_id,
      details
    ) values(p_company_id,r.subject_table,r.subject_record_id,'retention_processed',
      'retention_expired',p_actor_user_id,jsonb_build_object('queueId',r.id,'category',r.data_category));
    v_processed:=v_processed+1;
  end loop;
  if v_processed>0 then
    insert into public.discovery_audit_events(company_id,actor_user_id,action,entity_type,entity_id,details)
    values(p_company_id,p_actor_user_id,'privacy_retention_processed','privacy_retention_job',gen_random_uuid(),
      jsonb_build_object('processedCount',v_processed));
  end if;
  return v_processed;
end;
$process$;

revoke all on function public.erase_discovery_personal_subject(uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.record_discovery_privacy_policy(uuid,uuid,text,text,text,text,integer,text,date,boolean) from public,anon,authenticated;
revoke all on function public.create_discovery_privacy_request(uuid,uuid,text,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.verify_discovery_privacy_request(uuid,uuid,uuid,text,boolean) from public,anon,authenticated;
revoke all on function public.attach_discovery_privacy_request_subject(uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.apply_discovery_privacy_subject_action(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.complete_discovery_privacy_request(uuid,uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function public.enqueue_expired_discovery_personal_data(uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.process_discovery_privacy_retention_queue(uuid,uuid,integer) from public,anon,authenticated;

grant execute on function public.record_discovery_privacy_policy(uuid,uuid,text,text,text,text,integer,text,date,boolean) to service_role;
grant execute on function public.create_discovery_privacy_request(uuid,uuid,text,text,text,timestamptz) to service_role;
grant execute on function public.verify_discovery_privacy_request(uuid,uuid,uuid,text,boolean) to service_role;
grant execute on function public.attach_discovery_privacy_request_subject(uuid,uuid,uuid,text,uuid) to service_role;
grant execute on function public.apply_discovery_privacy_subject_action(uuid,uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.complete_discovery_privacy_request(uuid,uuid,uuid,boolean) to service_role;
grant execute on function public.enqueue_expired_discovery_personal_data(uuid,uuid,integer) to service_role;
grant execute on function public.process_discovery_privacy_retention_queue(uuid,uuid,integer) to service_role;

comment on table public.discovery_privacy_requests is
  'E14 privacy request intake. Contains only request classification, verification metadata and optional keyed HMAC reference; no data-subject name or contact detail.';
comment on table public.discovery_privacy_processing_policies is
  'E14 owner/admin-approved purpose, lawful-basis reference, retention limit and review date per company data category.';
comment on table public.discovery_privacy_retention_queue is
  'E14 human-invoked retention queue for expired professional identity and approved contact point records; no automatic purge worker is enabled.';
comment on function public.erase_discovery_personal_subject(uuid,text,uuid) is
  'E14 company-scoped erasure helper. Keeps non-identifying role history and append-only E13 provenance/audit references while deleting personal identity/contact payloads.';

commit;
