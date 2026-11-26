-- AXIVESTRA E10: source-by-source enrichment observations and potential-conflict review.
-- No provider fetches, source-value overwrite, conversion, scoring or auto-selection.
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
    'enrichment_observation_review_recorded','enrichment_conflict_review_recorded'
  ));
alter table public.discovery_audit_events
  drop constraint if exists discovery_audit_events_entity_type_check;
alter table public.discovery_audit_events
  add constraint discovery_audit_events_entity_type_check check (entity_type in (
    'source','profile','profile_source','discovery_job','discovery_worker_control',
    'extraction_review_event','entity_resolution_candidate','canonical_entity',
    'entity_relationship','professional_role_candidate','professional_person',
    'contact_point','place_candidate','enrichment_observation','enrichment_conflict'
  ));

create table if not exists public.discovery_enrichment_attribute_registry (
  attribute_key text primary key check (attribute_key ~ '^[a-z][a-z0-9_]{1,79}$'),
  category text not null check (category in ('business','finance','property','operating')),
  source_field_names text[] not null check (cardinality(source_field_names)>0),
  accepted_value_types text[] not null check (cardinality(accepted_value_types)>0),
  active boolean not null default true,
  unique(attribute_key,category)
);
insert into public.discovery_enrichment_attribute_registry(
  attribute_key,category,source_field_names,accepted_value_types,active
) values
('company_status','business',array['company_status'],array['string','date','boolean','identifier','array'],true),
('status','business',array['status'],array['string','date','boolean','identifier','array'],true),
('legal_status','business',array['legal_status'],array['string','date','boolean','identifier','array'],true),
('operating_status','business',array['operating_status'],array['string','date','boolean','identifier','array'],true),
('industry','business',array['industry'],array['string','date','boolean','identifier','array'],true),
('industry_sector','business',array['industry_sector'],array['string','date','boolean','identifier','array'],true),
('business_description','business',array['business_description'],array['string','date','boolean','identifier','array'],true),
('business_model','business',array['business_model'],array['string','date','boolean','identifier','array'],true),
('founded_date','business',array['founded_date'],array['string','date','boolean','identifier','array'],true),
('incorporation_date','business',array['incorporation_date'],array['string','date','boolean','identifier','array'],true),
('registration_date','business',array['registration_date'],array['string','date','boolean','identifier','array'],true),
('products','business',array['products'],array['string','date','boolean','identifier','array'],true),
('services','business',array['services'],array['string','date','boolean','identifier','array'],true),
('website','business',array['website'],array['string','date','boolean','identifier','array'],true),
('business_type','business',array['business_type'],array['string','date','boolean','identifier','array'],true),
('entity_type','business',array['entity_type'],array['string','date','boolean','identifier','array'],true),
('revenue','finance',array['revenue'],array['currency','number','percentage','date','string','identifier'],true),
('annual_revenue','finance',array['annual_revenue'],array['currency','number','percentage','date','string','identifier'],true),
('turnover','finance',array['turnover'],array['currency','number','percentage','date','string','identifier'],true),
('annual_turnover','finance',array['annual_turnover'],array['currency','number','percentage','date','string','identifier'],true),
('ebitda','finance',array['ebitda'],array['currency','number','percentage','date','string','identifier'],true),
('profit','finance',array['profit'],array['currency','number','percentage','date','string','identifier'],true),
('net_profit','finance',array['net_profit'],array['currency','number','percentage','date','string','identifier'],true),
('net_income','finance',array['net_income'],array['currency','number','percentage','date','string','identifier'],true),
('total_assets','finance',array['total_assets'],array['currency','number','percentage','date','string','identifier'],true),
('total_liabilities','finance',array['total_liabilities'],array['currency','number','percentage','date','string','identifier'],true),
('total_debt','finance',array['total_debt'],array['currency','number','percentage','date','string','identifier'],true),
('assets_under_management','finance',array['assets_under_management'],array['currency','number','percentage','date','string','identifier'],true),
('aum','finance',array['aum'],array['currency','number','percentage','date','string','identifier'],true),
('valuation','finance',array['valuation'],array['currency','number','percentage','date','string','identifier'],true),
('funding_amount','finance',array['funding_amount'],array['currency','number','percentage','date','string','identifier'],true),
('paid_up_capital','finance',array['paid_up_capital'],array['currency','number','percentage','date','string','identifier'],true),
('net_worth','finance',array['net_worth'],array['currency','number','percentage','date','string','identifier'],true),
('ticket_size','finance',array['ticket_size'],array['currency','number','percentage','date','string','identifier'],true),
('interest_rate','finance',array['interest_rate'],array['currency','number','percentage','date','string','identifier'],true),
('profit_margin','finance',array['profit_margin'],array['currency','number','percentage','date','string','identifier'],true),
('revenue_growth','finance',array['revenue_growth'],array['currency','number','percentage','date','string','identifier'],true),
('debt_to_equity','finance',array['debt_to_equity'],array['currency','number','percentage','date','string','identifier'],true),
('financial_year','finance',array['financial_year'],array['currency','number','percentage','date','string','identifier'],true),
('reporting_period','finance',array['reporting_period'],array['currency','number','percentage','date','string','identifier'],true),
('land_area','property',array['land_area'],array['number','currency','string','date','boolean','identifier'],true),
('plot_area','property',array['plot_area'],array['number','currency','string','date','boolean','identifier'],true),
('site_area','property',array['site_area'],array['number','currency','string','date','boolean','identifier'],true),
('built_up_area','property',array['built_up_area'],array['number','currency','string','date','boolean','identifier'],true),
('carpet_area','property',array['carpet_area'],array['number','currency','string','date','boolean','identifier'],true),
('floor_area','property',array['floor_area'],array['number','currency','string','date','boolean','identifier'],true),
('property_area','property',array['property_area'],array['number','currency','string','date','boolean','identifier'],true),
('land_value','property',array['land_value'],array['number','currency','string','date','boolean','identifier'],true),
('property_value','property',array['property_value'],array['number','currency','string','date','boolean','identifier'],true),
('assessed_value','property',array['assessed_value'],array['number','currency','string','date','boolean','identifier'],true),
('property_type','property',array['property_type'],array['number','currency','string','date','boolean','identifier'],true),
('zoning','property',array['zoning'],array['number','currency','string','date','boolean','identifier'],true),
('occupancy_status','property',array['occupancy_status'],array['number','currency','string','date','boolean','identifier'],true),
('building_count','property',array['building_count'],array['number','currency','string','date','boolean','identifier'],true),
('floor_count','property',array['floor_count'],array['number','currency','string','date','boolean','identifier'],true),
('property_class','property',array['property_class'],array['number','currency','string','date','boolean','identifier'],true),
('construction_year','property',array['construction_year'],array['number','currency','string','date','boolean','identifier'],true),
('property_condition','property',array['property_condition'],array['number','currency','string','date','boolean','identifier'],true),
('land_use','property',array['land_use'],array['number','currency','string','date','boolean','identifier'],true),
('development_status','property',array['development_status'],array['number','currency','string','date','boolean','identifier'],true),
('employee_count','operating',array['employee_count'],array['number','percentage','currency','string','date','boolean'],true),
('headcount','operating',array['headcount'],array['number','percentage','currency','string','date','boolean'],true),
('production_capacity','operating',array['production_capacity'],array['number','percentage','currency','string','date','boolean'],true),
('annual_production_capacity','operating',array['annual_production_capacity'],array['number','percentage','currency','string','date','boolean'],true),
('capacity_utilization','operating',array['capacity_utilization'],array['number','percentage','currency','string','date','boolean'],true),
('utilization_rate','operating',array['utilization_rate'],array['number','percentage','currency','string','date','boolean'],true),
('operating_sites','operating',array['operating_sites'],array['number','percentage','currency','string','date','boolean'],true),
('plant_count','operating',array['plant_count'],array['number','percentage','currency','string','date','boolean'],true),
('facility_count','operating',array['facility_count'],array['number','percentage','currency','string','date','boolean'],true),
('operating_hours','operating',array['operating_hours'],array['number','percentage','currency','string','date','boolean'],true),
('export_volume','operating',array['export_volume'],array['number','percentage','currency','string','date','boolean'],true),
('import_volume','operating',array['import_volume'],array['number','percentage','currency','string','date','boolean'],true),
('export_ratio','operating',array['export_ratio'],array['number','percentage','currency','string','date','boolean'],true),
('production_volume','operating',array['production_volume'],array['number','percentage','currency','string','date','boolean'],true),
('annual_production_volume','operating',array['annual_production_volume'],array['number','percentage','currency','string','date','boolean'],true),
('manufacturing_capacity','operating',array['manufacturing_capacity'],array['number','percentage','currency','string','date','boolean'],true),
('operating_since','operating',array['operating_since'],array['number','percentage','currency','string','date','boolean'],true),
('factory_count','operating',array['factory_count'],array['number','percentage','currency','string','date','boolean'],true),
('branch_count','operating',array['branch_count'],array['number','percentage','currency','string','date','boolean'],true),
('warehouse_count','operating',array['warehouse_count'],array['number','percentage','currency','string','date','boolean'],true)
on conflict(attribute_key) do nothing;

create table if not exists public.discovery_enrichment_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  extraction_run_id uuid not null,
  evidence_id uuid not null,
  source_id uuid not null,
  field_schema_snapshot jsonb not null check (jsonb_typeof(field_schema_snapshot)='object'),
  allowed_fields_snapshot text[] not null default '{}',
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
create index if not exists discovery_enrichment_jobs_claim_idx
  on public.discovery_enrichment_jobs(status,available_at,created_at)
  where status in ('queued','running');

create table if not exists public.discovery_enrichment_observations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  canonical_entity_id uuid not null,
  source_id uuid not null,
  extraction_run_id uuid not null,
  extracted_entity_id uuid not null,
  extracted_fact_id uuid not null,
  evidence_id uuid not null,
  evidence_content_hash text not null check (evidence_content_hash ~ '^[a-f0-9]{64}$'),
  attribute_key text not null references public.discovery_enrichment_attribute_registry(attribute_key) on delete restrict,
  attribute_category text not null check (attribute_category in ('business','finance','property','operating')),
  source_field_name text not null check (length(trim(source_field_name)) between 1 and 128),
  value_type text not null check (value_type in (
    'string','number','boolean','date','identifier','currency','percentage','object','array'
  )),
  raw_value text not null check (length(trim(raw_value)) between 1 and 20000),
  normalized_value jsonb not null check (normalized_value<>'null'::jsonb and octet_length(normalized_value::text)<=20000),
  source_unit text check (source_unit is null or length(source_unit)<=40),
  currency_code text check (currency_code is null or length(currency_code)<=40),
  source_confidence numeric(4,3) not null check (source_confidence between 0 and 1),
  source_name text not null check (length(trim(source_name)) between 2 and 160),
  source_domain text not null check (length(trim(source_domain)) between 1 and 253),
  source_jurisdiction text not null check (length(trim(source_jurisdiction)) between 2 and 80),
  source_attribution text not null check (length(source_attribution)<=500),
  source_license_ref text not null check (length(source_license_ref)<=300),
  source_published_at timestamptz,
  evidence_captured_at timestamptz not null,
  extraction_completed_at timestamptz not null,
  source_span jsonb not null check (jsonb_typeof(source_span)='object'),
  review_state text not null default 'pending_review'
    check (review_state in ('pending_review','conflict_review','accepted','rejected')),
  created_at timestamptz not null default now(),
  unique(company_id,id),
  unique(company_id,extraction_run_id,extracted_fact_id),
  foreign key (company_id,canonical_entity_id)
    references public.discovery_canonical_entities(company_id,id) on delete restrict,
  foreign key (company_id,source_id)
    references public.discovery_source_registry(company_id,id) on delete restrict
  -- E05 fact, run and evidence IDs are historical references; observations survive raw evidence expiry.
);
create index if not exists discovery_enrichment_observations_entity_idx
  on public.discovery_enrichment_observations(company_id,canonical_entity_id,attribute_key,evidence_captured_at desc);
create index if not exists discovery_enrichment_observations_source_idx
  on public.discovery_enrichment_observations(company_id,source_id,source_published_at desc);
create index if not exists discovery_enrichment_observations_review_idx
  on public.discovery_enrichment_observations(company_id,review_state,created_at desc);

create table if not exists public.discovery_enrichment_conflicts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  canonical_entity_id uuid not null,
  attribute_key text not null references public.discovery_enrichment_attribute_registry(attribute_key) on delete restrict,
  candidate_a uuid not null,
  candidate_b uuid not null,
  conflict_kind text not null default 'potential_value_disagreement'
    check (conflict_kind='potential_value_disagreement'),
  status text not null default 'open'
    check (status in ('open','resolved_different_periods','retained_both','selected_a','selected_b')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (candidate_a<>candidate_b),
  unique(company_id,id),
  unique(company_id,candidate_a,candidate_b),
  foreign key (company_id,canonical_entity_id)
    references public.discovery_canonical_entities(company_id,id) on delete restrict,
  foreign key (company_id,candidate_a)
    references public.discovery_enrichment_observations(company_id,id) on delete restrict,
  foreign key (company_id,candidate_b)
    references public.discovery_enrichment_observations(company_id,id) on delete restrict
);
create index if not exists discovery_enrichment_conflicts_open_idx
  on public.discovery_enrichment_conflicts(company_id,status,created_at desc);

create table if not exists public.discovery_enrichment_review_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  observation_id uuid,
  conflict_id uuid,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  decision text not null check (decision in (
    'accepted','rejected','different_periods','retained_both','selected_a','selected_b'
  )),
  reason text not null check (length(trim(reason)) between 1 and 1000),
  snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<=4000),
  occurred_at timestamptz not null default now(),
  check ((observation_id is null) <> (conflict_id is null)),
  foreign key (observation_id) references public.discovery_enrichment_observations(id) on delete set null,
  foreign key (conflict_id) references public.discovery_enrichment_conflicts(id) on delete set null
);
create index if not exists discovery_enrichment_review_events_company_idx
  on public.discovery_enrichment_review_events(company_id,occurred_at desc);

alter table public.discovery_enrichment_jobs enable row level security;
alter table public.discovery_enrichment_observations enable row level security;
alter table public.discovery_enrichment_conflicts enable row level security;
alter table public.discovery_enrichment_review_events enable row level security;
alter table public.discovery_enrichment_attribute_registry enable row level security;
revoke all on public.discovery_enrichment_jobs,public.discovery_enrichment_observations,
  public.discovery_enrichment_conflicts,public.discovery_enrichment_review_events,
  public.discovery_enrichment_attribute_registry from public,anon,authenticated;
grant all on public.discovery_enrichment_jobs,public.discovery_enrichment_observations,
  public.discovery_enrichment_conflicts,public.discovery_enrichment_review_events,
  public.discovery_enrichment_attribute_registry to service_role;

create or replace function public.enqueue_discovery_enrichment_job()
returns trigger language plpgsql security definer
set search_path=public,pg_temp
as $enqueue$
declare v_run public.discovery_extraction_runs%rowtype; v_source public.discovery_source_registry%rowtype;
begin
  select * into v_run from public.discovery_extraction_runs
    where company_id=new.company_id and id=new.extraction_run_id
      and status in ('completed','completed_with_warnings');
  if not found then return new; end if;
  select * into v_source from public.discovery_source_registry
    where company_id=new.company_id and id=v_run.source_id and status='approved'
      and 'enrichment'=any(allowed_purposes);
  if not found then return new; end if;
  if not exists (
    select 1 from jsonb_each(v_source.field_schema) fs(field_name,definition)
    join public.discovery_enrichment_attribute_registry ar
      on fs.field_name=any(ar.source_field_names) and ar.active=true
      and fs.definition->>'type'=any(ar.accepted_value_types)
    where fs.field_name=any(v_source.allowed_fields)
  ) then return new; end if;
  insert into public.discovery_enrichment_jobs(
    company_id,extraction_run_id,evidence_id,source_id,field_schema_snapshot,
    allowed_fields_snapshot,status
  ) values (
    new.company_id,v_run.id,v_run.evidence_id,v_run.source_id,
    v_source.field_schema,v_source.allowed_fields,'queued'
  ) on conflict(company_id,extraction_run_id) do nothing;
  return new;
end;
$enqueue$;
drop trigger if exists discovery_entity_assignment_enqueue_enrichment on public.discovery_entity_assignments;
create trigger discovery_entity_assignment_enqueue_enrichment
  after insert on public.discovery_entity_assignments
  for each row execute function public.enqueue_discovery_enrichment_job();

create or replace function public.claim_discovery_enrichment_job(
  p_worker_id text,p_lease_seconds integer default 90
) returns setof public.discovery_enrichment_jobs
language plpgsql security definer
set search_path=public,pg_temp
as $claim$
declare v_job public.discovery_enrichment_jobs%rowtype; v_now timestamptz:=clock_timestamp();
begin
  if p_worker_id is null or length(trim(p_worker_id))<1 or length(p_worker_id)>160 then
    raise exception 'E10 worker id is required' using errcode='22023';
  end if;
  if p_lease_seconds<15 or p_lease_seconds>300 then
    raise exception 'E10 lease must be 15 to 300 seconds' using errcode='22023';
  end if;
  update public.discovery_enrichment_jobs
    set status='queued',lease_owner=null,lease_expires_at=null,heartbeat_at=null,
      available_at=v_now,updated_at=v_now
    where status='running' and lease_expires_at<=v_now;
  select j.* into v_job
    from public.discovery_enrichment_jobs j
    join public.discovery_extraction_runs r
      on r.company_id=j.company_id and r.id=j.extraction_run_id
      and r.status in ('completed','completed_with_warnings')
    join public.discovery_evidence_items e
      on e.company_id=j.company_id and e.id=j.evidence_id and e.content_hash=r.source_content_hash
    join public.discovery_source_registry s
      on s.company_id=j.company_id and s.id=j.source_id and s.status='approved'
      and 'enrichment'=any(s.allowed_purposes)
      and s.field_schema=j.field_schema_snapshot and s.allowed_fields=j.allowed_fields_snapshot
    join public.discovery_jobs dj
      on dj.company_id=e.company_id and dj.id=e.job_id and dj.status='succeeded'
    join public.discovery_profiles p
      on p.company_id=dj.company_id and p.id=dj.profile_id and p.enabled=true
    join public.discovery_profile_sources ps
      on ps.company_id=dj.company_id and ps.profile_id=dj.profile_id and ps.source_id=j.source_id
    join public.discovery_company_worker_controls wc
      on wc.company_id=j.company_id and wc.enabled=true and wc.expires_at>v_now
    where j.status='queued' and j.available_at<=v_now and j.attempts<j.max_attempts
      and exists(select 1 from public.discovery_entity_assignments a
        where a.company_id=j.company_id and a.extraction_run_id=j.extraction_run_id)
    order by j.available_at,j.created_at
    for update of j skip locked limit 1;
  if not found then return; end if;
  update public.discovery_enrichment_jobs
    set status='running',attempts=attempts+1,lease_owner=p_worker_id,
      lease_expires_at=v_now+make_interval(secs=>p_lease_seconds),
      heartbeat_at=v_now,started_at=coalesce(started_at,v_now),updated_at=v_now
    where id=v_job.id returning * into v_job;
  return next v_job;
end;
$claim$;

create or replace function public.heartbeat_discovery_enrichment_job(
  p_job_id uuid,p_worker_id text,p_lease_seconds integer default 90
) returns boolean language plpgsql security definer
set search_path=public,pg_temp
as $heartbeat$
declare v_count integer;
begin
  if p_lease_seconds<15 or p_lease_seconds>300 then
    raise exception 'E10 lease must be 15 to 300 seconds' using errcode='22023';
  end if;
  update public.discovery_enrichment_jobs j
    set heartbeat_at=clock_timestamp(),
      lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),
      updated_at=clock_timestamp()
    where j.id=p_job_id and j.status='running' and j.lease_owner=p_worker_id
      and j.lease_expires_at>clock_timestamp()
      and exists (
        select 1 from public.discovery_source_registry s
        join public.discovery_evidence_items e on e.company_id=s.company_id
        join public.discovery_extraction_runs r on r.company_id=e.company_id and r.evidence_id=e.id
        join public.discovery_jobs dj on dj.company_id=e.company_id and dj.id=e.job_id and dj.status='succeeded'
        join public.discovery_profiles p on p.company_id=dj.company_id and p.id=dj.profile_id and p.enabled=true
        join public.discovery_profile_sources ps on ps.company_id=dj.company_id and ps.profile_id=dj.profile_id and ps.source_id=s.id
        join public.discovery_company_worker_controls wc on wc.company_id=s.company_id and wc.enabled=true and wc.expires_at>clock_timestamp()
        where s.company_id=j.company_id and s.id=j.source_id and s.status='approved'
          and 'enrichment'=any(s.allowed_purposes)
          and s.field_schema=j.field_schema_snapshot and s.allowed_fields=j.allowed_fields_snapshot
          and e.id=j.evidence_id and e.content_hash=r.source_content_hash
          and r.id=j.extraction_run_id and r.status in ('completed','completed_with_warnings')
          and exists(select 1 from public.discovery_entity_assignments a
            where a.company_id=j.company_id and a.extraction_run_id=j.extraction_run_id)
      );
  get diagnostics v_count=row_count;
  return v_count=1;
end;
$heartbeat$;

create or replace function public.complete_discovery_enrichment_job(
  p_job_id uuid,p_worker_id text,p_candidates jsonb
) returns integer language plpgsql security definer
set search_path=public,pg_temp
as $complete$
declare
  v_job public.discovery_enrichment_jobs%rowtype;
  v_source public.discovery_source_registry%rowtype;
  v_run public.discovery_extraction_runs%rowtype;
  v_evidence public.discovery_evidence_items%rowtype;
  v_candidate jsonb;
  v_attribute public.discovery_enrichment_attribute_registry%rowtype;
  v_observation public.discovery_enrichment_observations%rowtype;
  v_existing public.discovery_enrichment_observations%rowtype;
  v_a uuid; v_b uuid; v_count integer:=0;
begin
  if p_candidates is null or jsonb_typeof(p_candidates)<>'array' then
    raise exception 'E10 candidate batch must be a JSON array' using errcode='22023';
  end if;
  if jsonb_array_length(p_candidates)>500 or octet_length(p_candidates::text)>2000000 then
    raise exception 'E10 candidate batch is outside approved bounds' using errcode='22023';
  end if;
  select * into v_job from public.discovery_enrichment_jobs
    where id=p_job_id and status='running' and lease_owner=p_worker_id
      and lease_expires_at>clock_timestamp() for update;
  if not found then raise exception 'E10 lease is no longer valid' using errcode='42501'; end if;
  select * into v_source from public.discovery_source_registry
    where company_id=v_job.company_id and id=v_job.source_id and status='approved'
      and 'enrichment'=any(allowed_purposes)
      and field_schema=v_job.field_schema_snapshot and allowed_fields=v_job.allowed_fields_snapshot;
  if not found then raise exception 'E10 source approval, purpose or field schema changed' using errcode='42501'; end if;
  select * into v_run from public.discovery_extraction_runs
    where company_id=v_job.company_id and id=v_job.extraction_run_id
      and evidence_id=v_job.evidence_id and source_id=v_job.source_id
      and status in ('completed','completed_with_warnings');
  if not found then raise exception 'E10 extraction run is no longer eligible' using errcode='42501'; end if;
  select * into v_evidence from public.discovery_evidence_items
    where company_id=v_job.company_id and id=v_job.evidence_id and content_hash=v_run.source_content_hash;
  if not found then raise exception 'E10 immutable evidence is missing or hash mismatched' using errcode='42501'; end if;
  if not exists (
    select 1 from public.discovery_jobs dj
    join public.discovery_profiles p on p.company_id=dj.company_id and p.id=dj.profile_id and p.enabled=true
    join public.discovery_profile_sources ps on ps.company_id=dj.company_id and ps.profile_id=dj.profile_id and ps.source_id=v_job.source_id
    join public.discovery_company_worker_controls wc on wc.company_id=dj.company_id and wc.enabled=true and wc.expires_at>clock_timestamp()
    where dj.company_id=v_job.company_id and dj.id=v_evidence.job_id and dj.status='succeeded'
  ) then raise exception 'E10 parent job, profile, source link or worker grant is no longer eligible' using errcode='42501'; end if;

  for v_candidate in select value from jsonb_array_elements(p_candidates)
  loop
    if jsonb_typeof(v_candidate)<>'object'
      or v_candidate->>'entity_kind'<>'organization'
      or v_candidate->>'value_type' is null
      or v_candidate->>'value_type' not in ('string','number','boolean','date','identifier','currency','percentage','object','array')
      or length(trim(coalesce(v_candidate->>'source_field_name','')))=0
      or length(trim(coalesce(v_candidate->>'raw_value','')))=0
      or length(coalesce(v_candidate->>'raw_value',''))>20000
      or coalesce(v_candidate->>'attribute_key','') !~ '^[a-z][a-z0-9_]{1,79}$'
      or v_candidate->>'attribute_category' is null
      or v_candidate->>'attribute_category' not in ('business','finance','property','operating')
      or jsonb_typeof(coalesce(v_candidate->'source_span','{}'::jsonb))<>'object'
      or v_candidate->>'source_confidence' is null
      or (v_candidate->>'source_confidence')::numeric not between 0 and 1
      or v_candidate->'normalized_value' is null
      or v_candidate->'normalized_value'='null'::jsonb
      or octet_length((v_candidate->'normalized_value')::text)>20000 then
      raise exception 'E10 observation payload failed schema or bounds validation' using errcode='22023';
    end if;
    select * into v_attribute from public.discovery_enrichment_attribute_registry
      where attribute_key=v_candidate->>'attribute_key'
        and category=v_candidate->>'attribute_category' and active=true
        and v_candidate->>'source_field_name'=any(source_field_names)
        and v_candidate->>'value_type'=any(accepted_value_types);
    if not found then raise exception 'E10 attribute is not in the approved registry' using errcode='22023'; end if;
    if not (v_candidate->>'source_field_name'=any(v_job.allowed_fields_snapshot))
      or v_job.field_schema_snapshot->(v_candidate->>'source_field_name')->>'type' is distinct from v_candidate->>'value_type' then
      raise exception 'E10 source field is not approved with this exact schema type' using errcode='42501';
    end if;
    if (v_candidate->>'source_unit') is distinct from nullif(v_job.field_schema_snapshot->(v_candidate->>'source_field_name')->>'unit','')
      or (v_candidate->>'currency_code') is distinct from nullif(v_job.field_schema_snapshot->(v_candidate->>'source_field_name')->>'currencyCode','') then
      raise exception 'E10 unit or currency metadata differs from reviewed source schema' using errcode='42501';
    end if;
    if not exists (
      select 1 from public.discovery_extracted_entities x
      where x.company_id=v_job.company_id and x.extraction_run_id=v_job.extraction_run_id
        and x.id=(v_candidate->>'extracted_entity_id')::uuid and x.entity_kind='organization'
    ) then raise exception 'E10 entity is not an organization mention from this E05 run' using errcode='42501'; end if;
    if not exists (
      select 1 from public.discovery_entity_assignments a
      join public.discovery_canonical_entities c
        on c.company_id=a.company_id and c.id=a.canonical_entity_id and c.entity_kind='organization' and c.status='active'
      where a.company_id=v_job.company_id and a.extraction_run_id=v_job.extraction_run_id
        and a.extracted_entity_id=(v_candidate->>'extracted_entity_id')::uuid
        and a.canonical_entity_id=(v_candidate->>'canonical_entity_id')::uuid
    ) then raise exception 'E10 company link is not an active owner-reviewed E06 assignment' using errcode='42501'; end if;
    if not exists (
      select 1 from public.discovery_extracted_facts f
      where f.company_id=v_job.company_id and f.extraction_run_id=v_job.extraction_run_id
        and f.id=(v_candidate->>'extracted_fact_id')::uuid
        and f.extracted_entity_id=(v_candidate->>'extracted_entity_id')::uuid
        and f.field_name=v_candidate->>'source_field_name'
        and f.value_type=v_candidate->>'value_type'
        and f.validation_status='valid' and f.raw_value=v_candidate->>'raw_value'
        and coalesce(f.normalized_value,to_jsonb(f.raw_value))=v_candidate->'normalized_value'
        and f.source_span=coalesce(v_candidate->'source_span','{}'::jsonb)
        and f.confidence=(v_candidate->>'source_confidence')::numeric
    ) then raise exception 'E10 value does not match a valid source-backed E05 fact exactly' using errcode='42501'; end if;

    insert into public.discovery_enrichment_observations(
      company_id,canonical_entity_id,source_id,extraction_run_id,extracted_entity_id,
      extracted_fact_id,evidence_id,evidence_content_hash,attribute_key,attribute_category,
      source_field_name,value_type,raw_value,normalized_value,source_unit,currency_code,
      source_confidence,source_name,source_domain,source_jurisdiction,source_attribution,
      source_license_ref,source_published_at,evidence_captured_at,extraction_completed_at,source_span
    ) values (
      v_job.company_id,(v_candidate->>'canonical_entity_id')::uuid,v_job.source_id,
      v_job.extraction_run_id,(v_candidate->>'extracted_entity_id')::uuid,
      (v_candidate->>'extracted_fact_id')::uuid,v_job.evidence_id,v_evidence.content_hash,
      v_attribute.attribute_key,v_attribute.category,v_candidate->>'source_field_name',
      v_candidate->>'value_type',v_candidate->>'raw_value',v_candidate->'normalized_value',
      nullif(v_candidate->>'source_unit',''),nullif(v_candidate->>'currency_code',''),
      (v_candidate->>'source_confidence')::numeric,v_source.name,v_source.domain,
      v_source.jurisdiction,v_source.attribution,v_source.license_ref,
      v_evidence.source_published_at,v_evidence.captured_at,v_run.completed_at,
      coalesce(v_candidate->'source_span','{}'::jsonb)
    ) returning * into v_observation;

    for v_existing in
      select * from public.discovery_enrichment_observations o
      where o.company_id=v_job.company_id and o.canonical_entity_id=v_observation.canonical_entity_id
        and o.attribute_key=v_observation.attribute_key and o.source_id<>v_observation.source_id
        and o.normalized_value is distinct from v_observation.normalized_value
        and o.review_state<>'rejected'
    loop
      if v_observation.id<v_existing.id then v_a:=v_observation.id;v_b:=v_existing.id;
      else v_a:=v_existing.id;v_b:=v_observation.id; end if;
      insert into public.discovery_enrichment_conflicts(
        company_id,canonical_entity_id,attribute_key,candidate_a,candidate_b,status
      ) values (
        v_job.company_id,v_observation.canonical_entity_id,v_observation.attribute_key,v_a,v_b,'open'
      ) on conflict(company_id,candidate_a,candidate_b) do nothing;
      update public.discovery_enrichment_observations
        set review_state='conflict_review'
        where company_id=v_job.company_id and id in (v_observation.id,v_existing.id)
          and review_state<>'rejected';
    end loop;
    v_count:=v_count+1;
  end loop;

  update public.discovery_enrichment_jobs
    set status='succeeded',finished_at=clock_timestamp(),lease_owner=null,
      lease_expires_at=null,heartbeat_at=null,updated_at=clock_timestamp()
    where id=v_job.id;
  return v_count;
end;
$complete$;

create or replace function public.fail_discovery_enrichment_job(
  p_job_id uuid,p_worker_id text,p_error_code text,p_error_message text
) returns boolean language plpgsql security definer
set search_path=public,pg_temp
as $fail$
declare v_job public.discovery_enrichment_jobs%rowtype;
begin
  select * into v_job from public.discovery_enrichment_jobs
    where id=p_job_id and status='running' and lease_owner=p_worker_id
      and lease_expires_at>clock_timestamp() for update;
  if not found then return false; end if;
  update public.discovery_enrichment_jobs
    set status=case when attempts>=max_attempts then 'failed' else 'queued' end,
      available_at=clock_timestamp()+make_interval(secs=>least(30*greatest(attempts,1),300)),
      lease_owner=null,lease_expires_at=null,heartbeat_at=null,
      finished_at=case when attempts>=max_attempts then clock_timestamp() else null end,
      last_error_code=left(coalesce(p_error_code,'E10_FAILED'),100),
      last_error_message=left(coalesce(p_error_message,'E10 failed.'),1000),
      updated_at=clock_timestamp()
    where id=v_job.id;
  return true;
end;
$fail$;

create or replace function public.record_discovery_enrichment_review(
  p_company_id uuid,p_actor_user_id uuid,p_observation_id uuid,p_decision text,p_reason text
) returns public.discovery_enrichment_review_events
language plpgsql security definer
set search_path=public,pg_temp
as $review$
declare v_role text; v_observation public.discovery_enrichment_observations%rowtype;
  v_event public.discovery_enrichment_review_events%rowtype;
begin
  if p_decision not in ('accepted','rejected') then
    raise exception 'Unsupported E10 observation review decision' using errcode='22023';
  end if;
  if p_reason is null or length(trim(p_reason))<1 or length(p_reason)>1000 then
    raise exception 'E10 review reason is required' using errcode='22023';
  end if;
  select role into v_role from public.company_memberships
    where company_id=p_company_id and user_id=p_actor_user_id for share;
  if v_role is null or v_role not in ('owner','admin') then
    raise exception 'Only a company owner or admin can review enrichment observations' using errcode='42501';
  end if;
  select * into v_observation from public.discovery_enrichment_observations
    where company_id=p_company_id and id=p_observation_id and review_state='pending_review' for update;
  if not found then raise exception 'Pending E10 enrichment observation was not found' using errcode='P0002'; end if;
  if exists(select 1 from public.discovery_enrichment_conflicts c
    where c.company_id=p_company_id and c.status='open'
      and (c.candidate_a=p_observation_id or c.candidate_b=p_observation_id)) then
    raise exception 'E10 observation has an unresolved source-value conflict' using errcode='22023';
  end if;
  update public.discovery_enrichment_observations
    set review_state=p_decision where company_id=p_company_id and id=p_observation_id;
  insert into public.discovery_enrichment_review_events(
    company_id,observation_id,actor_user_id,decision,reason,snapshot
  ) values (
    p_company_id,p_observation_id,p_actor_user_id,p_decision,trim(p_reason),
    jsonb_build_object('attributeKey',v_observation.attribute_key,'category',v_observation.attribute_category,
      'sourceId',v_observation.source_id,'evidenceId',v_observation.evidence_id,
      'publishedAt',v_observation.source_published_at,'capturedAt',v_observation.evidence_captured_at)
  ) returning * into v_event;
  insert into public.discovery_audit_events(company_id,actor_user_id,action,entity_type,entity_id,details)
  values(p_company_id,p_actor_user_id,'enrichment_observation_review_recorded','enrichment_observation',
    p_observation_id,jsonb_build_object('decision',p_decision,'attributeKey',v_observation.attribute_key));
  return v_event;
end;
$review$;

create or replace function public.record_discovery_enrichment_conflict_review(
  p_company_id uuid,p_actor_user_id uuid,p_conflict_id uuid,p_decision text,p_reason text
) returns public.discovery_enrichment_review_events
language plpgsql security definer
set search_path=public,pg_temp
as $review$
declare
  v_role text; v_conflict public.discovery_enrichment_conflicts%rowtype;
  v_a public.discovery_enrichment_observations%rowtype; v_b public.discovery_enrichment_observations%rowtype;
  v_event public.discovery_enrichment_review_events%rowtype; v_status text; v_a_state text; v_b_state text;
begin
  if p_decision not in ('different_periods','retained_both','selected_a','selected_b') then
    raise exception 'Unsupported E10 conflict review decision' using errcode='22023';
  end if;
  if p_reason is null or length(trim(p_reason))<1 or length(p_reason)>1000 then
    raise exception 'E10 conflict review reason is required' using errcode='22023';
  end if;
  select role into v_role from public.company_memberships
    where company_id=p_company_id and user_id=p_actor_user_id for share;
  if v_role is null or v_role not in ('owner','admin') then
    raise exception 'Only a company owner or admin can resolve enrichment conflicts' using errcode='42501';
  end if;
  select * into v_conflict from public.discovery_enrichment_conflicts
    where company_id=p_company_id and id=p_conflict_id and status='open' for update;
  if not found then raise exception 'Open E10 enrichment conflict was not found' using errcode='P0002'; end if;
  select * into v_a from public.discovery_enrichment_observations
    where company_id=p_company_id and id=v_conflict.candidate_a for update;
  select * into v_b from public.discovery_enrichment_observations
    where company_id=p_company_id and id=v_conflict.candidate_b for update;
  if v_a.id is null or v_b.id is null then
    raise exception 'E10 conflict observations are not both available' using errcode='P0002';
  end if;
  v_status:=case p_decision when 'different_periods' then 'resolved_different_periods'
    when 'retained_both' then 'retained_both' when 'selected_a' then 'selected_a' else 'selected_b' end;
  update public.discovery_enrichment_conflicts
    set status=v_status,resolved_at=clock_timestamp() where company_id=p_company_id and id=p_conflict_id;
  if p_decision in ('different_periods','retained_both') then v_a_state:='accepted';v_b_state:='accepted';
  elsif p_decision='selected_a' then v_a_state:='accepted';v_b_state:='rejected';
  else v_a_state:='rejected';v_b_state:='accepted';end if;
  update public.discovery_enrichment_observations o
    set review_state=case
      when o.review_state='rejected' then 'rejected'
      when exists(select 1 from public.discovery_enrichment_conflicts c
        where c.company_id=p_company_id and c.status='open'
          and (c.candidate_a=o.id or c.candidate_b=o.id)) then 'conflict_review'
      when o.id=v_conflict.candidate_a then v_a_state
      when o.id=v_conflict.candidate_b then v_b_state
      else o.review_state end
    where o.company_id=p_company_id and o.id in (v_conflict.candidate_a,v_conflict.candidate_b);
  insert into public.discovery_enrichment_review_events(
    company_id,conflict_id,actor_user_id,decision,reason,snapshot
  ) values (
    p_company_id,p_conflict_id,p_actor_user_id,p_decision,trim(p_reason),
    jsonb_build_object('attributeKey',v_conflict.attribute_key,'candidateA',v_conflict.candidate_a,
      'candidateB',v_conflict.candidate_b,'sourceA',v_a.source_id,'sourceB',v_b.source_id,
      'publishedAtA',v_a.source_published_at,'publishedAtB',v_b.source_published_at,
      'capturedAtA',v_a.evidence_captured_at,'capturedAtB',v_b.evidence_captured_at)
  ) returning * into v_event;
  insert into public.discovery_audit_events(company_id,actor_user_id,action,entity_type,entity_id,details)
  values(p_company_id,p_actor_user_id,'enrichment_conflict_review_recorded','enrichment_conflict',p_conflict_id,
    jsonb_build_object('decision',p_decision,'attributeKey',v_conflict.attribute_key));
  return v_event;
end;
$review$;

revoke all on function public.claim_discovery_enrichment_job(text,integer) from public,anon,authenticated;
revoke all on function public.heartbeat_discovery_enrichment_job(uuid,text,integer) from public,anon,authenticated;
revoke all on function public.complete_discovery_enrichment_job(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.fail_discovery_enrichment_job(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.record_discovery_enrichment_review(uuid,uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.record_discovery_enrichment_conflict_review(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_discovery_enrichment_job(text,integer) to service_role;
grant execute on function public.heartbeat_discovery_enrichment_job(uuid,text,integer) to service_role;
grant execute on function public.complete_discovery_enrichment_job(uuid,text,jsonb) to service_role;
grant execute on function public.fail_discovery_enrichment_job(uuid,text,text,text) to service_role;
grant execute on function public.record_discovery_enrichment_review(uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.record_discovery_enrichment_conflict_review(uuid,uuid,uuid,text,text) to service_role;

comment on table public.discovery_enrichment_observations is
  'E10 immutable source-by-source business, finance, property and operating observations. Values are not overwritten or auto-selected.';
comment on table public.discovery_enrichment_conflicts is
  'Potential cross-source value disagreements; timestamps and source provenance remain visible for owner/admin adjudication.';
comment on table public.discovery_enrichment_review_events is
  'Owner/admin E10 observation and potential-conflict review receipts with timestamp/source snapshots.';

commit;
