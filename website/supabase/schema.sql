-- AXIVESTRA public website: public content + private administrator workspace.
-- Run in the Supabase SQL Editor for the same project used by AXIVESTRA.
-- The website uses only the public publishable key. Never expose service_role in a browser.

create extension if not exists pgcrypto;

create table if not exists public.website_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin')),
  created_at timestamptz not null default now()
);

create or replace function public.is_website_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.website_admins a
    where a.user_id = auth.uid()
      and a.role in ('owner', 'admin')
  );
$$;

revoke all on function public.is_website_admin() from public;
grant execute on function public.is_website_admin() to authenticated;

create table if not exists public.website_settings (
  id text primary key check (id = 'main'),
  brand_name text not null default 'AXIVESTRA' check (length(brand_name) between 1 and 100),
  tagline text not null default 'Asset Intelligence Platform' check (length(tagline) <= 160),
  hero_title text not null default 'See the full picture behind every asset and capital decision.' check (length(hero_title) between 1 and 220),
  hero_subtitle text not null default 'AXIVESTRA brings asset, deal, lending, investment, counterparty, legal and operational records into one connected workspace.' check (length(hero_subtitle) <= 1200),
  primary_cta text not null default 'Request a walkthrough' check (length(primary_cta) <= 80),
  contact_email text not null default '' check (length(contact_email) <= 254),
  contact_phone text not null default '' check (length(contact_phone) <= 40),
  logo_url text not null default '' check (length(logo_url) <= 2000),
  app_url text not null default 'https://axivestra.pages.dev' check (length(app_url) <= 2000),
  seo_title text not null default 'AXIVESTRA — Asset Intelligence Platform' check (length(seo_title) <= 180),
  seo_description text not null default 'Connect asset, capital and relationship workflows in one structured intelligence workspace.' check (length(seo_description) <= 320),
  updated_at timestamptz not null default now()
);

create table if not exists public.website_pages (
  slug text primary key check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 1 and 80),
  title text not null check (length(title) between 1 and 160),
  summary text not null default '' check (length(summary) <= 500),
  body text not null default '' check (length(body) <= 15000),
  seo_title text not null default '' check (length(seo_title) <= 180),
  seo_description text not null default '' check (length(seo_description) <= 320),
  status text not null default 'draft' check (status in ('draft', 'published')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table if not exists public.website_leads (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  email text not null check (length(trim(email)) between 3 and 254),
  phone text not null default '' check (length(phone) <= 40),
  company text not null default '' check (length(company) <= 160),
  message text not null check (length(trim(message)) between 1 and 4000),
  consent boolean not null default false check (consent = true),
  source_url text not null default '' check (length(source_url) <= 2000),
  status text not null default 'new' check (status in ('new', 'contacted', 'closed')),
  created_at timestamptz not null default now()
);

create index if not exists website_leads_created_idx
  on public.website_leads(created_at desc);
create index if not exists website_leads_status_idx
  on public.website_leads(status, created_at desc);

alter table public.website_admins enable row level security;
alter table public.website_settings enable row level security;
alter table public.website_pages enable row level security;
alter table public.website_leads enable row level security;

revoke all on table public.website_admins from anon, authenticated;
revoke all on table public.website_settings from anon, authenticated;
revoke all on table public.website_pages from anon, authenticated;
revoke all on table public.website_leads from anon, authenticated;

grant select on table public.website_admins to authenticated;
grant select on table public.website_settings to anon, authenticated;
grant insert, update, delete on table public.website_settings to authenticated;
grant select on table public.website_pages to anon, authenticated;
grant insert, update, delete on table public.website_pages to authenticated;
grant insert on table public.website_leads to anon, authenticated;
grant select, update, delete on table public.website_leads to authenticated;

drop policy if exists "website admin can view own role" on public.website_admins;
create policy "website admin can view own role"
on public.website_admins for select to authenticated
using (user_id = auth.uid());

drop policy if exists "public can read website settings" on public.website_settings;
create policy "public can read website settings"
on public.website_settings for select to anon, authenticated
using (true);

drop policy if exists "website admins manage settings" on public.website_settings;
create policy "website admins manage settings"
on public.website_settings for all to authenticated
using (public.is_website_admin())
with check (public.is_website_admin());

drop policy if exists "public can read published website pages" on public.website_pages;
create policy "public can read published website pages"
on public.website_pages for select to anon, authenticated
using (status = 'published');

drop policy if exists "website admins manage pages" on public.website_pages;
create policy "website admins manage pages"
on public.website_pages for all to authenticated
using (public.is_website_admin())
with check (public.is_website_admin() and updated_by = auth.uid());

drop policy if exists "public can submit website enquiries" on public.website_leads;
create policy "public can submit website enquiries"
on public.website_leads for insert to anon, authenticated
with check (
  consent = true
  and length(trim(name)) between 1 and 120
  and length(trim(email)) between 3 and 254
  and length(trim(message)) between 1 and 4000
  and status = 'new'
);

drop policy if exists "website admins can read enquiries" on public.website_leads;
create policy "website admins can read enquiries"
on public.website_leads for select to authenticated
using (public.is_website_admin());

drop policy if exists "website admins can update enquiries" on public.website_leads;
create policy "website admins can update enquiries"
on public.website_leads for update to authenticated
using (public.is_website_admin())
with check (public.is_website_admin());

drop policy if exists "website admins can delete enquiries" on public.website_leads;
create policy "website admins can delete enquiries"
on public.website_leads for delete to authenticated
using (public.is_website_admin());

insert into public.website_settings (id)
values ('main')
on conflict (id) do nothing;

-- Provision the first website owner only after that person has a Supabase Auth account.
-- Replace the placeholder email and run the separate statement from website/README.md.
