-- AXIVESTRA E03: persist unverified search candidates per company and discovery profile.
-- These are search leads only, not verified identities, evidence or approved contacts.
begin;

create table if not exists public.discovery_search_candidates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null,
  workspace_key text not null check (workspace_key in (
    'property_sale','property_loans','jv_jda_jd','sr_rate_settlement',
    'agricultural_land','commercial_land','startup','equity',
    'unsecured_company_loan','personal_loan','housing_loan','house_purchase',
    'litigation','fund_portfolio_management','investor_relations','compliance_kyc'
  )),
  discovery_mode text not null check (discovery_mode in ('LENDER','CUSTOMER')),
  title text not null check (length(trim(title)) between 1 and 300),
  canonical_url text not null check (canonical_url ~ '^https://'),
  domain text not null check (length(trim(domain)) between 1 and 253),
  snippet text not null default '',
  status text not null default 'unverified_candidate'
    check (status = 'unverified_candidate'),
  approved_source_id uuid,
  approved_source_name text,
  fetch_eligible boolean not null default false,
  provider_key text not null default 'searxng',
  retrieved_at timestamptz not null default now(),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, profile_id, canonical_url),
  foreign key (company_id, profile_id)
    references public.discovery_profiles(company_id, id) on delete cascade,
  foreign key (company_id, approved_source_id)
    references public.discovery_source_registry(company_id, id) on delete set null,
  check (fetch_eligible = false or approved_source_id is not null)
);

create index if not exists discovery_search_candidates_company_recent_idx
  on public.discovery_search_candidates(company_id, last_seen_at desc);
create index if not exists discovery_search_candidates_profile_recent_idx
  on public.discovery_search_candidates(company_id, profile_id, last_seen_at desc);

alter table public.discovery_search_candidates enable row level security;

drop policy if exists discovery_search_candidates_company_read
  on public.discovery_search_candidates;
create policy discovery_search_candidates_company_read
  on public.discovery_search_candidates
  for select to authenticated
  using (public.is_company_member(company_id));

-- E03 candidate writes happen only through the authenticated discovery-control
-- Edge Function using its server-side service-role client.
revoke all on public.discovery_search_candidates from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.discovery_search_candidates to service_role;

comment on table public.discovery_search_candidates is
  'Company-scoped, persisted E03 search candidates. Rows remain unverified and cannot be treated as evidence or verified leads.';

commit;
