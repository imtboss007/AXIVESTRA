-- AXIVESTRA E16: normalized, deal-specific party relationships.
-- Additive foundation over existing company_records; no legacy payloads are rewritten.
begin;

create table if not exists public.company_deal_parties (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  deal_record_type text not null default 'property' check (deal_record_type='property'),
  deal_record_key text not null,
  party_record_type text not null default 'contact' check (party_record_type='contact'),
  party_record_key text not null,
  role_code text not null check (role_code in (
    'owner','co_owner','buyer','seller','borrower','lender','guarantor',
    'investor','investee','fund_manager','advisor','broker','agent','tenant',
    'developer','contractor','advocate','mediator','introducer','partner','other'
  )),
  responsibility_code text not null default 'participant' check (responsibility_code in (
    'participant','decision_maker','authorized_signatory','beneficial_owner',
    'representative','originator','reviewer','other'
  )),
  authority_scope text not null default '' check (length(authority_scope)<=300),
  effective_from date not null default current_date,
  effective_to date,
  verification_state text not null default 'unverified' check (verification_state in (
    'unverified','claimed','evidence_supported','verified','disputed','rejected'
  )),
  evidence_record_type text not null default 'document_metadata' check (evidence_record_type='document_metadata'),
  evidence_record_key text,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata)='object' and octet_length(metadata::text)<=2000),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,id),
  unique(company_id,deal_record_key,party_record_key,role_code,effective_from),
  foreign key(company_id,deal_record_type,deal_record_key)
    references public.company_records(company_id,record_type,record_key) on delete restrict,
  foreign key(company_id,party_record_type,party_record_key)
    references public.company_records(company_id,record_type,record_key) on delete restrict,
  foreign key(company_id,evidence_record_type,evidence_record_key)
    references public.company_records(company_id,record_type,record_key) on delete restrict,
  check (effective_to is null or effective_to>=effective_from),
  check ((verification_state in ('evidence_supported','verified') and evidence_record_key is not null)
      or verification_state not in ('evidence_supported','verified'))
);
create index if not exists company_deal_parties_deal_idx
  on public.company_deal_parties(company_id,deal_record_key,role_code,effective_to);
create index if not exists company_deal_parties_party_idx
  on public.company_deal_parties(company_id,party_record_key,role_code,effective_to);

create table if not exists public.company_deal_party_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  deal_party_id uuid not null,
  event_type text not null check (event_type in ('party_link_created','party_link_updated')),
  previous_verification_state text,
  new_verification_state text not null,
  previous_effective_to date,
  new_effective_to date,
  actor_user_id uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now(),
  unique(company_id,id),
  foreign key(company_id,deal_party_id)
    references public.company_deal_parties(company_id,id) on delete cascade
);
create index if not exists company_deal_party_events_timeline_idx
  on public.company_deal_party_events(company_id,deal_party_id,occurred_at desc);

alter table public.company_deal_parties enable row level security;
alter table public.company_deal_party_events enable row level security;
drop policy if exists company_deal_parties_read on public.company_deal_parties;
create policy company_deal_parties_read on public.company_deal_parties
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists company_deal_parties_insert on public.company_deal_parties;
create policy company_deal_parties_insert on public.company_deal_parties
  for insert to authenticated with check (
    public.has_company_role(company_id,array['owner','admin','manager','staff'])
    and created_by=auth.uid() and updated_by=auth.uid()
  );
drop policy if exists company_deal_parties_update on public.company_deal_parties;
create policy company_deal_parties_update on public.company_deal_parties
  for update to authenticated
  using (public.has_company_role(company_id,array['owner','admin','manager','staff']))
  with check (public.has_company_role(company_id,array['owner','admin','manager','staff']) and updated_by=auth.uid());
drop policy if exists company_deal_party_events_read on public.company_deal_party_events;
create policy company_deal_party_events_read on public.company_deal_party_events
  for select to authenticated using (public.is_company_member(company_id));

revoke all on public.company_deal_parties,public.company_deal_party_events from public,anon,authenticated,service_role;
grant select,insert,update on public.company_deal_parties to authenticated;
grant select on public.company_deal_party_events to authenticated;

create or replace function public.guard_company_deal_party()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $guard$
declare v_role text;
begin
  if pg_trigger_depth()>1 and tg_op='DELETE' then return old; end if;
  if auth.uid() is null then
    raise exception 'Authenticated user context is required for deal-party changes.' using errcode='42501';
  end if;
  select role into v_role from public.company_memberships
    where company_id=case when tg_op='DELETE' then old.company_id else new.company_id end
      and user_id=auth.uid();
  if v_role is null or v_role not in ('owner','admin','manager','staff') then
    raise exception 'Only an authorised company member can change deal-party links.' using errcode='42501';
  end if;
  if tg_op='DELETE' then
    raise exception 'Deal-party links cannot be deleted; close the effective period instead.' using errcode='42501';
  end if;
  if tg_op='INSERT' then
    new.created_by:=auth.uid();
    new.updated_by:=auth.uid();
  else
    if old.company_id is distinct from new.company_id
      or old.deal_record_type is distinct from new.deal_record_type
      or old.deal_record_key is distinct from new.deal_record_key
      or old.party_record_type is distinct from new.party_record_type
      or old.party_record_key is distinct from new.party_record_key
      or old.role_code is distinct from new.role_code
      or old.effective_from is distinct from new.effective_from then
      raise exception 'Deal, party, role and effective-from identity are immutable; create a new relationship instead.';
    end if;
    new.created_by:=old.created_by;
    new.updated_by:=auth.uid();
    new.updated_at:=clock_timestamp();
  end if;

  if exists(select 1 from public.company_records r
    where r.company_id=new.company_id and r.record_type=new.deal_record_type
      and r.record_key=new.deal_record_key and r.deleted_at is not null)
    or exists(select 1 from public.company_records r
    where r.company_id=new.company_id and r.record_type=new.party_record_type
      and r.record_key=new.party_record_key and r.deleted_at is not null) then
    raise exception 'Deleted deal or contact records cannot receive active party links.';
  end if;
  if new.evidence_record_key is not null and exists(
    select 1 from public.company_records r
    where r.company_id=new.company_id and r.record_type='document_metadata'
      and r.record_key=new.evidence_record_key and r.deleted_at is not null
  ) then raise exception 'Deleted evidence metadata cannot verify a deal-party link.'; end if;
  return new;
end;
$guard$;

drop trigger if exists company_deal_parties_guard on public.company_deal_parties;
create trigger company_deal_parties_guard
  before insert or update or delete on public.company_deal_parties
  for each row execute function public.guard_company_deal_party();

create or replace function public.prevent_company_record_soft_delete_with_party_links()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $record_guard$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    if exists(select 1 from public.company_deal_parties p
      where p.company_id=old.company_id and (
        (old.record_type='property' and p.deal_record_type=old.record_type and p.deal_record_key=old.record_key)
        or (old.record_type='contact' and p.party_record_type=old.record_type and p.party_record_key=old.record_key)
        or (old.record_type='document_metadata' and p.evidence_record_type=old.record_type
          and p.evidence_record_key=old.record_key and p.verification_state in ('evidence_supported','verified'))
      ) and (p.effective_to is null or p.effective_to>=current_date)) then
      raise exception 'An active deal-party relationship or its verification evidence prevents soft deletion.';
    end if;
  end if;
  return new;
end;
$record_guard$;
drop trigger if exists company_record_deal_party_soft_delete_guard on public.company_records;
create trigger company_record_deal_party_soft_delete_guard
  before update on public.company_records
  for each row execute function public.prevent_company_record_soft_delete_with_party_links();

create or replace function public.prevent_company_deal_party_event_mutation()
returns trigger language plpgsql
as $event_guard$
begin
  if pg_trigger_depth()>1 then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  raise exception 'Deal-party history is immutable; append a new event instead.';
end;
$event_guard$;
drop trigger if exists company_deal_party_events_no_mutation on public.company_deal_party_events;
create trigger company_deal_party_events_no_mutation
  before update or delete on public.company_deal_party_events
  for each row execute function public.prevent_company_deal_party_event_mutation();

create or replace function public.capture_company_deal_party_event()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $capture$
begin
  insert into public.company_deal_party_events(
    company_id,deal_party_id,event_type,previous_verification_state,new_verification_state,
    previous_effective_to,new_effective_to,actor_user_id
  ) values(
    new.company_id,new.id,
    case when tg_op='INSERT' then 'party_link_created' else 'party_link_updated' end,
    case when tg_op='INSERT' then null else old.verification_state end,
    new.verification_state,
    case when tg_op='INSERT' then null else old.effective_to end,
    new.effective_to,auth.uid()
  );
  return new;
end;
$capture$;
drop trigger if exists company_deal_parties_capture_event on public.company_deal_parties;
create trigger company_deal_parties_capture_event
  after insert or update on public.company_deal_parties
  for each row execute function public.capture_company_deal_party_event();

revoke all on function public.guard_company_deal_party() from public,anon,authenticated,service_role;
revoke all on function public.prevent_company_record_soft_delete_with_party_links() from public,anon,authenticated,service_role;
revoke all on function public.prevent_company_deal_party_event_mutation() from public,anon,authenticated,service_role;
revoke all on function public.capture_company_deal_party_event() from public,anon,authenticated,service_role;

comment on table public.company_deal_parties is
  'E16 normalized deal-specific party links. References stable company record IDs; role identity is immutable and relationship history is retained.';
comment on table public.company_deal_party_events is
  'E16 append-only audit history for deal-party creation and verification/effective-period updates.';

commit;
