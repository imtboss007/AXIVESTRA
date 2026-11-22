-- AXIVESTRA external discovery: source governance and workspace profiles.
-- Sources are company-scoped, pending by default, and cannot be fetched until reviewed.
-- This migration adds metadata and policy only; it does not start discovery or crawling.

create table if not exists public.discovery_source_registry (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 160),
  canonical_url text not null check (canonical_url ~ '^https://' and canonical_url !~ '[*]'),
  domain text not null check (domain = lower(domain) and domain !~ '[*/]'),
  source_type text not null check (source_type in (
    'official_api','licensed_api','open_dataset','permitted_public_page','manual_research'
  )),
  connector_key text not null check (connector_key in (
    'official_api','licensed_api','open_dataset','permitted_public_page','manual_research'
  )),
  jurisdiction text not null check (length(trim(jurisdiction)) between 2 and 80),
  terms_url text check (terms_url is null or terms_url ~ '^https://'),
  license_ref text not null default 'unreviewed',
  allowed_purposes text[] not null default '{}',
  allowed_fields text[] not null default '{}',
  allowed_paths text[] not null default '{}',
  access_method text not null,
  rate_limit_per_minute integer not null default 6 check (rate_limit_per_minute between 1 and 60),
  max_pages_per_job integer not null default 20 check (max_pages_per_job between 1 and 100),
  retention_days integer not null default 90 check (retention_days between 1 and 3650),
  attribution text not null default '',
  legal_basis text not null default '',
  policy_notes text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','paused','rejected')),
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, canonical_url),
  check (connector_key = source_type),
  check (
    status <> 'approved'
    or (
      reviewed_by is not null
      and reviewed_at is not null
      and length(trim(legal_basis)) > 0
      and cardinality(allowed_purposes) > 0
      and cardinality(allowed_fields) > 0
      and cardinality(allowed_paths) > 0
      and length(trim(attribution)) > 0
      and (source_type = 'manual_research' or (terms_url is not null and license_ref <> 'unreviewed'))
    )
  )
);

create index if not exists discovery_source_registry_company_status_idx
  on public.discovery_source_registry(company_id, status, domain);

create table if not exists public.discovery_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  workspace_key text not null check (workspace_key in (
    'property_sale','property_loans','jv_jda_jd','sr_rate_settlement',
    'agricultural_land','commercial_land','startup','equity',
    'unsecured_company_loan','personal_loan','housing_loan','house_purchase',
    'litigation','fund_portfolio_management','investor_relations','compliance_kyc'
  )),
  discovery_mode text not null check (discovery_mode in ('LENDER','CUSTOMER')),
  jurisdiction text not null default 'IN' check (length(trim(jurisdiction)) between 2 and 80),
  purpose text not null check (length(trim(purpose)) between 5 and 500),
  enabled boolean not null default false,
  criteria jsonb not null default '{}'::jsonb check (jsonb_typeof(criteria) = 'object'),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, workspace_key, discovery_mode),
  check (workspace_key <> 'personal_loan' or discovery_mode <> 'CUSTOMER' or enabled = false)
);

create index if not exists discovery_profiles_company_idx
  on public.discovery_profiles(company_id, workspace_key, discovery_mode);

create table if not exists public.discovery_profile_sources (
  company_id uuid not null,
  profile_id uuid not null,
  source_id uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (company_id, profile_id, source_id),
  foreign key (company_id, profile_id)
    references public.discovery_profiles(company_id, id) on delete cascade,
  foreign key (company_id, source_id)
    references public.discovery_source_registry(company_id, id) on delete cascade
);

create index if not exists discovery_profile_sources_source_idx
  on public.discovery_profile_sources(company_id, source_id);

create table if not exists public.discovery_audit_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in (
    'source_registered','source_approved','source_paused','source_rejected',
    'profile_created','profile_updated','profile_enabled','profile_disabled',
    'profile_source_attached','profile_source_detached'
  )),
  entity_type text not null check (entity_type in ('source','profile','profile_source')),
  entity_id uuid not null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  occurred_at timestamptz not null default now()
);

create index if not exists discovery_audit_events_company_idx
  on public.discovery_audit_events(company_id, occurred_at desc);

alter table public.discovery_source_registry enable row level security;
alter table public.discovery_profiles enable row level security;
alter table public.discovery_profile_sources enable row level security;
alter table public.discovery_audit_events enable row level security;

drop policy if exists "company members can view discovery sources" on public.discovery_source_registry;
create policy "company members can view discovery sources"
on public.discovery_source_registry for select to authenticated
using (public.is_company_member(company_id));

drop policy if exists "company members can view discovery profiles" on public.discovery_profiles;
create policy "company members can view discovery profiles"
on public.discovery_profiles for select to authenticated
using (public.is_company_member(company_id));

drop policy if exists "company members can view discovery profile sources" on public.discovery_profile_sources;
create policy "company members can view discovery profile sources"
on public.discovery_profile_sources for select to authenticated
using (public.is_company_member(company_id));

drop policy if exists "company members can view discovery audit events" on public.discovery_audit_events;
create policy "company members can view discovery audit events"
on public.discovery_audit_events for select to authenticated
using (public.is_company_member(company_id));

-- Mutations are performed through the authenticated discovery-control Edge Function.
-- Authenticated clients receive read-only grants; service-role writes are isolated server-side.
revoke all on public.discovery_source_registry from anon, authenticated;
revoke all on public.discovery_profiles from anon, authenticated;
revoke all on public.discovery_profile_sources from anon, authenticated;
revoke all on public.discovery_audit_events from anon, authenticated;
grant select on public.discovery_source_registry to authenticated;
grant select on public.discovery_profiles to authenticated;
grant select on public.discovery_profile_sources to authenticated;
grant select on public.discovery_audit_events to authenticated;

comment on table public.discovery_source_registry is
  'Company-scoped source register. Pending by default; only reviewed approved sources may be connected to discovery profiles.';
comment on table public.discovery_profiles is
  'One configuration per AXIVESTRA workspace and LENDER/CUSTOMER mode. Disabled by default.';
comment on table public.discovery_profile_sources is
  'Explicit allow-list joining approved company sources to a single discovery profile.';
comment on table public.discovery_audit_events is
  'Append-only discovery governance events written by the server-side control function.';
