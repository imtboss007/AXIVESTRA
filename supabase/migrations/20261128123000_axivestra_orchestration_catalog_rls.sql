-- Protect the static orchestration catalog while preserving authenticated read access.
-- These tables contain platform workflow/stage definitions, not company records.
begin;

alter table public.discovery_orchestration_stage_registry enable row level security;
alter table public.discovery_orchestration_workflows enable row level security;

drop policy if exists discovery_orchestration_stage_registry_authenticated_read
  on public.discovery_orchestration_stage_registry;
create policy discovery_orchestration_stage_registry_authenticated_read
  on public.discovery_orchestration_stage_registry
  for select to authenticated
  using (true);

drop policy if exists discovery_orchestration_workflows_authenticated_read
  on public.discovery_orchestration_workflows;
create policy discovery_orchestration_workflows_authenticated_read
  on public.discovery_orchestration_workflows
  for select to authenticated
  using (true);

revoke all on public.discovery_orchestration_stage_registry,
  public.discovery_orchestration_workflows
  from public, anon, authenticated, service_role;

grant select on public.discovery_orchestration_stage_registry,
  public.discovery_orchestration_workflows
  to authenticated, service_role;

comment on table public.discovery_orchestration_stage_registry is
  'Platform-controlled stage catalog. Authenticated users may read; writes remain migration/admin-only.';
comment on table public.discovery_orchestration_workflows is
  'Platform-controlled workflow catalog. Authenticated users may read; writes remain migration/admin-only.';

commit;
