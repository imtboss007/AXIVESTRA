-- AXIVESTRA E20.2: execution contract and durable lease data model.
-- This migration defines contracts and persistence only. It deliberately exposes no claim/dispatch RPC.
begin;

create table if not exists public.discovery_orchestration_adapter_contracts (
  adapter_key text primary key,
  stage_key text not null references public.discovery_orchestration_stage_registry(stage_key) on delete restrict,
  contract_version text not null,
  input_schema jsonb not null default '{}'::jsonb
    check(jsonb_typeof(input_schema)='object' and octet_length(input_schema::text)<=12000),
  output_schema jsonb not null default '{}'::jsonb
    check(jsonb_typeof(output_schema)='object' and octet_length(output_schema::text)<=12000),
  required_permission_class text not null
    check(required_permission_class in ('source_restricted','company_internal','personal_data','derived_data')),
  required_policy_checks text[] not null default '{}'::text[],
  max_attempts integer not null default 3 check(max_attempts between 1 and 8),
  lease_seconds integer not null default 120 check(lease_seconds between 15 and 1800),
  max_parallel_per_company integer not null default 1 check(max_parallel_per_company between 1 and 4),
  enabled boolean not null default false,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(stage_key,contract_version),
  check ((reviewed_by is null and reviewed_at is null) or (reviewed_by is not null and reviewed_at is not null)),
  check (review_reason is null or length(review_reason)<=1000),
  check (enabled=false or (reviewed_by is not null and reviewed_at is not null and length(coalesce(review_reason,''))>=10))
);

create table if not exists public.discovery_orchestration_executions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  run_id uuid not null,
  step_id uuid not null,
  adapter_key text not null references public.discovery_orchestration_adapter_contracts(adapter_key) on delete restrict,
  state text not null default 'not_started'
    check(state in ('not_started','ready','leased','succeeded','retry_wait','failed','cancelled')),
  attempt_count integer not null default 0 check(attempt_count between 0 and 8),
  max_attempts integer not null check(max_attempts between 1 and 8),
  available_at timestamptz not null default now(),
  last_error_code text,
  last_error_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,step_id),
  unique(company_id,id),
  foreign key(company_id,run_id) references public.discovery_orchestration_runs(company_id,id) on delete cascade,
  foreign key(company_id,step_id) references public.discovery_orchestration_steps(company_id,id) on delete cascade,
  check(last_error_code is null or length(last_error_code)<=120),
  check(last_error_summary is null or length(last_error_summary)<=1000)
);

create table if not exists public.discovery_orchestration_execution_leases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  execution_id uuid not null,
  lease_token_hash text not null check(length(lease_token_hash)=64),
  worker_identity text not null check(length(worker_identity) between 3 and 160),
  leased_at timestamptz not null,
  expires_at timestamptz not null,
  heartbeat_at timestamptz not null,
  released_at timestamptz,
  release_reason text,
  created_at timestamptz not null default now(),
  foreign key(company_id,execution_id)
    references public.discovery_orchestration_executions(company_id,id) on delete cascade,
  check(expires_at>leased_at),
  check(heartbeat_at>=leased_at),
  check(released_at is null or released_at>=leased_at),
  check(release_reason is null or length(release_reason)<=500)
);
create unique index if not exists discovery_orchestration_one_active_lease_per_execution
  on public.discovery_orchestration_execution_leases(company_id,execution_id)
  where released_at is null;
create index if not exists discovery_orchestration_lease_expiry_idx
  on public.discovery_orchestration_execution_leases(expires_at)
  where released_at is null;

create table if not exists public.discovery_orchestration_execution_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  execution_id uuid not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check(event_type in (
    'execution_registered','execution_ready','lease_granted','lease_heartbeat',
    'lease_expired','lease_released','attempt_started','attempt_succeeded',
    'attempt_failed','retry_scheduled','execution_cancelled'
  )),
  previous_state text,
  new_state text not null,
  attempt_number integer not null default 0 check(attempt_number between 0 and 8),
  reason text not null check(length(reason) between 10 and 1000),
  details jsonb not null default '{}'::jsonb
    check(jsonb_typeof(details)='object' and octet_length(details::text)<=3000),
  occurred_at timestamptz not null default now(),
  foreign key(company_id,execution_id)
    references public.discovery_orchestration_executions(company_id,id) on delete cascade
);
create index if not exists discovery_orchestration_execution_events_idx
  on public.discovery_orchestration_execution_events(company_id,execution_id,occurred_at desc);

alter table public.discovery_orchestration_adapter_contracts enable row level security;
alter table public.discovery_orchestration_executions enable row level security;
alter table public.discovery_orchestration_execution_leases enable row level security;
alter table public.discovery_orchestration_execution_events enable row level security;

drop policy if exists discovery_orchestration_adapter_contracts_read on public.discovery_orchestration_adapter_contracts;
create policy discovery_orchestration_adapter_contracts_read on public.discovery_orchestration_adapter_contracts
  for select to authenticated using(true);
drop policy if exists discovery_orchestration_executions_company_read on public.discovery_orchestration_executions;
create policy discovery_orchestration_executions_company_read on public.discovery_orchestration_executions
  for select to authenticated using(public.is_company_member(company_id));
drop policy if exists discovery_orchestration_leases_company_read on public.discovery_orchestration_execution_leases;
create policy discovery_orchestration_leases_company_read on public.discovery_orchestration_execution_leases
  for select to authenticated using(public.is_company_member(company_id));
drop policy if exists discovery_orchestration_execution_events_company_read on public.discovery_orchestration_execution_events;
create policy discovery_orchestration_execution_events_company_read on public.discovery_orchestration_execution_events
  for select to authenticated using(public.is_company_member(company_id));

revoke all on public.discovery_orchestration_adapter_contracts,
  public.discovery_orchestration_executions,
  public.discovery_orchestration_execution_leases,
  public.discovery_orchestration_execution_events
  from public,anon,authenticated,service_role;
grant select on public.discovery_orchestration_adapter_contracts,
  public.discovery_orchestration_executions,
  public.discovery_orchestration_execution_leases,
  public.discovery_orchestration_execution_events
  to authenticated,service_role;

create or replace function public.prevent_discovery_orchestration_execution_event_mutation()
returns trigger language plpgsql
as $guard$
begin
  raise exception 'Execution events are append-only; create a new event instead.';
end;
$guard$;
drop trigger if exists discovery_orchestration_execution_events_immutable
  on public.discovery_orchestration_execution_events;
create trigger discovery_orchestration_execution_events_immutable
  before update or delete on public.discovery_orchestration_execution_events
  for each row execute function public.prevent_discovery_orchestration_execution_event_mutation();
revoke update,delete on public.discovery_orchestration_execution_events from public,anon,authenticated,service_role;

-- Explicitly no adapters are seeded/enabled, no execution rows are created,
-- and no worker claim/heartbeat/complete/retry RPC is granted in E20.2.
comment on table public.discovery_orchestration_adapter_contracts is
  'E20.2 adapter contract catalogue. All adapters remain disabled until reviewed; this table alone cannot dispatch work.';
comment on table public.discovery_orchestration_executions is
  'E20.2 durable execution record schema. No execution rows or dispatch routines are created by this migration.';
comment on table public.discovery_orchestration_execution_leases is
  'E20.2 lease persistence schema only. No worker claim, heartbeat or release routine is exposed in this migration.';
comment on table public.discovery_orchestration_execution_events is
  'E20.2 append-only attempt and lease audit schema. No worker can write events until separately authorized RPCs are implemented.';

commit;
