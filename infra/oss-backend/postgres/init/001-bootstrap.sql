-- AXIVESTRA open-source backend prototype.
-- This is a disposable schema proof, not a production migration or a copy of company data.
\getenv pgrst_password PGRST_DB_PASSWORD
\getenv api_password API_DB_PASSWORD

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD :'pgrst_password';
CREATE ROLE axivestra_api LOGIN NOINHERIT PASSWORD :'api_password';
GRANT anon, authenticated TO authenticator;
GRANT authenticated TO axivestra_api;

CREATE SCHEMA auth;
REVOKE ALL ON SCHEMA auth FROM PUBLIC;
GRANT USAGE ON SCHEMA auth TO authenticated;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub',
    ''
  )::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  );
$$;

GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
GRANT EXECUTE ON FUNCTION auth.jwt() TO authenticated;

CREATE TABLE public.companies (
  id uuid PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE public.company_memberships (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','admin','manager','staff','read_only')),
  PRIMARY KEY (company_id, user_id)
);

CREATE TABLE public.oss_backend_probe_records (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  record_type text NOT NULL,
  record_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (company_id, record_type, record_key)
);

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oss_backend_probe_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY companies_member_read
  ON public.companies FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.company_memberships m
      WHERE m.company_id = companies.id
        AND m.user_id = auth.uid()
    )
  );

CREATE POLICY company_memberships_self_read
  ON public.company_memberships FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY oss_backend_probe_records_member_read
  ON public.oss_backend_probe_records FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.company_memberships m
      WHERE m.company_id = oss_backend_probe_records.company_id
        AND m.user_id = auth.uid()
    )
  );

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.companies, public.company_memberships,
  public.oss_backend_probe_records TO authenticated;

-- Synthetic identities and records are confined to this local database.
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-4111-8111-111111111111', 'lender.demo@axivestra.local'),
  ('22222222-2222-4222-8222-222222222222', 'customer.demo@axivestra.local');

INSERT INTO public.companies (id, name) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'AXIVESTRA Lender Demo Company'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'AXIVESTRA Customer Demo Company');

INSERT INTO public.company_memberships (company_id, user_id, role) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'owner');

INSERT INTO public.oss_backend_probe_records (id, company_id, record_type, record_key, payload) VALUES
  ('aaaaaaaa-0001-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'demo_profile', 'LENDER-DEMO-ONLY', '{"classification":"synthetic","mode":"LENDER"}'),
  ('bbbbbbbb-0001-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'demo_profile', 'CUSTOMER-DEMO-ONLY', '{"classification":"synthetic","mode":"CUSTOMER"}');

GRANT SELECT ON public.companies, public.company_memberships,
  public.oss_backend_probe_records TO axivestra_api;

COMMENT ON TABLE public.oss_backend_probe_records IS
  'Synthetic local-only tenant-isolation fixture for the open-source backend prototype.';
