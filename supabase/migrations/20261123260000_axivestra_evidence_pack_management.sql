-- AXIVESTRA technical E21: Revised E11 evidence management, review and export.
-- Reuses E04 immutable raw evidence and E13 immutable provenance; never copies source bodies or extracted values.
begin;

create table if not exists public.discovery_evidence_packs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  title text not null check(length(trim(title)) between 3 and 160),
  purpose text not null check(length(trim(purpose)) between 10 and 1000),
  status text not null default 'draft' check(status in ('draft','in_review','approved','rejected')),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  review_reason text check(review_reason is null or length(review_reason)<=1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,id),
  check((reviewed_by is null and reviewed_at is null) or (reviewed_by is not null and reviewed_at is not null))
);
create index if not exists discovery_evidence_packs_company_idx
  on public.discovery_evidence_packs(company_id,created_at desc);

create table if not exists public.discovery_evidence_pack_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  pack_id uuid not null,
  provenance_event_id uuid not null references public.discovery_provenance_events(id) on delete restrict,
  added_by uuid not null references auth.users(id) on delete restrict,
  added_at timestamptz not null default now(),
  removed_by uuid references auth.users(id) on delete restrict,
  removed_at timestamptz,
  foreign key(company_id,pack_id)
    references public.discovery_evidence_packs(company_id,id) on delete cascade,
  check((removed_by is null and removed_at is null) or (removed_by is not null and removed_at is not null))
);
create unique index if not exists discovery_evidence_pack_item_active_unique
  on public.discovery_evidence_pack_items(company_id,pack_id,provenance_event_id)
  where removed_at is null;
create index if not exists discovery_evidence_pack_items_pack_idx
  on public.discovery_evidence_pack_items(company_id,pack_id,added_at);

create table if not exists public.discovery_evidence_pack_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  pack_id uuid not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check(event_type in (
    'created','item_added','item_removed','submitted','approved','rejected','reopened','exported'
  )),
  reason text not null check(length(trim(reason)) between 5 and 1000),
  details jsonb not null default '{}'::jsonb
    check(jsonb_typeof(details)='object' and octet_length(details::text)<=4000),
  occurred_at timestamptz not null default now(),
  foreign key(company_id,pack_id)
    references public.discovery_evidence_packs(company_id,id) on delete cascade
);
create index if not exists discovery_evidence_pack_events_idx
  on public.discovery_evidence_pack_events(company_id,pack_id,occurred_at desc);

alter table public.discovery_evidence_packs enable row level security;
alter table public.discovery_evidence_pack_items enable row level security;
alter table public.discovery_evidence_pack_events enable row level security;

drop policy if exists discovery_evidence_packs_company_read on public.discovery_evidence_packs;
create policy discovery_evidence_packs_company_read on public.discovery_evidence_packs
  for select to authenticated using(public.is_company_member(company_id));
drop policy if exists discovery_evidence_pack_items_company_read on public.discovery_evidence_pack_items;
create policy discovery_evidence_pack_items_company_read on public.discovery_evidence_pack_items
  for select to authenticated using(public.is_company_member(company_id));
drop policy if exists discovery_evidence_pack_events_company_read on public.discovery_evidence_pack_events;
create policy discovery_evidence_pack_events_company_read on public.discovery_evidence_pack_events
  for select to authenticated using(public.is_company_member(company_id));

revoke all on public.discovery_evidence_packs,
  public.discovery_evidence_pack_items,public.discovery_evidence_pack_events
  from public,anon,authenticated,service_role;
grant select on public.discovery_evidence_packs,
  public.discovery_evidence_pack_items,public.discovery_evidence_pack_events
  to authenticated,service_role;

create or replace function public.prevent_discovery_evidence_pack_event_mutation()
returns trigger language plpgsql
as $guard$
begin
  raise exception 'Evidence pack history is append-only; create a new event instead.';
end;
$guard$;
drop trigger if exists discovery_evidence_pack_events_immutable
  on public.discovery_evidence_pack_events;
create trigger discovery_evidence_pack_events_immutable
  before update or delete on public.discovery_evidence_pack_events
  for each row execute function public.prevent_discovery_evidence_pack_event_mutation();
revoke update,delete on public.discovery_evidence_pack_events from public,anon,authenticated,service_role;

-- This inbox is the complete evidence-citation catalogue across E04-E13.
-- It returns only provenance IDs, source snapshots, hashes and allowlisted locators.
-- It deliberately excludes source URLs, raw values, blob refs, object keys and content.
create or replace view public.discovery_evidence_candidate_inbox
with (security_invoker=true) as
select
  p.id as provenance_event_id,p.company_id,p.subject_kind,p.subject_id,p.field_name,
  p.event_type,p.decision,p.source_id,p.evidence_id,p.extraction_run_id,
  p.evidence_content_hash,p.evidence_captured_at,p.source_published_at,
  p.source_name_snapshot,p.source_domain_snapshot,p.source_jurisdiction_snapshot,
  p.source_attribution_snapshot,p.source_license_ref_snapshot,p.source_license_snapshot,
  p.source_span,p.actor_user_id,p.occurred_at,
  case
    when p.evidence_id is null then false
    when exists (
      select 1 from public.discovery_provenance_events rp
      where rp.company_id=p.company_id and rp.evidence_id=p.evidence_id
        and rp.event_type='evidence_retention_purged'
    ) then false
    else true
  end as evidence_retained
from public.discovery_provenance_events p
where p.evidence_id is not null and p.event_type<>'evidence_retention_purged';

create or replace view public.discovery_evidence_pack_inbox
with (security_invoker=true) as
select p.id,p.company_id,p.title,p.purpose,p.status,p.created_by,p.updated_by,
  p.reviewed_by,p.reviewed_at,p.review_reason,p.created_at,p.updated_at,
  count(i.id) filter(where i.removed_at is null)::integer as item_count,
  count(ev.id)::integer as event_count
from public.discovery_evidence_packs p
left join public.discovery_evidence_pack_items i
  on i.company_id=p.company_id and i.pack_id=p.id
left join public.discovery_evidence_pack_events ev
  on ev.company_id=p.company_id and ev.pack_id=p.id
where public.is_company_member(p.company_id)
group by p.id;

create or replace view public.discovery_evidence_pack_item_inbox
with (security_invoker=true) as
select i.id as item_id,i.company_id,i.pack_id,i.provenance_event_id,i.added_by,
  i.added_at,i.removed_by,i.removed_at,c.subject_kind,c.subject_id,c.field_name,
  c.event_type,c.decision,c.source_id,c.evidence_id,c.extraction_run_id,
  c.evidence_content_hash,c.evidence_captured_at,c.source_published_at,
  c.source_name_snapshot,c.source_domain_snapshot,c.source_jurisdiction_snapshot,
  c.source_attribution_snapshot,c.source_license_ref_snapshot,c.source_license_snapshot,
  c.source_span,c.actor_user_id,c.occurred_at as provenance_occurred_at,
  c.evidence_retained
from public.discovery_evidence_pack_items i
join public.discovery_evidence_candidate_inbox c
  on c.company_id=i.company_id and c.provenance_event_id=i.provenance_event_id
where public.is_company_member(i.company_id);

create or replace view public.discovery_evidence_pack_event_inbox
with (security_invoker=true) as
select id,company_id,pack_id,actor_user_id,event_type,reason,details,occurred_at
from public.discovery_evidence_pack_events
where public.is_company_member(company_id);

grant select on public.discovery_evidence_candidate_inbox,
  public.discovery_evidence_pack_inbox,public.discovery_evidence_pack_item_inbox,
  public.discovery_evidence_pack_event_inbox to authenticated,service_role;

create or replace function public.create_discovery_evidence_pack(
  p_company_id uuid,p_title text,p_purpose text
) returns uuid
language plpgsql security definer
set search_path=public,pg_temp
as $create$
declare
  v_actor uuid:=auth.uid();
  v_role text;
  v_pack public.discovery_evidence_packs%rowtype;
begin
  if v_actor is null then raise exception 'Authenticated user context is required.' using errcode='42501'; end if;
  select role into v_role from public.company_memberships
    where company_id=p_company_id and user_id=v_actor;
  if coalesce(v_role,'') not in ('owner','admin') then
    raise exception 'Only company owners/admins can create evidence packs.' using errcode='42501';
  end if;
  if p_title is null or p_title<>trim(p_title) or length(p_title) not between 3 and 160 then
    raise exception 'Evidence pack title must be 3–160 characters.' using errcode='22023';
  end if;
  if p_purpose is null or p_purpose<>trim(p_purpose) or length(p_purpose) not between 10 and 1000 then
    raise exception 'Evidence pack purpose must be 10–1000 characters.' using errcode='22023';
  end if;
  perform 1 from public.companies where id=p_company_id for update;
  if not found then raise exception 'Company was not found.' using errcode='P0002'; end if;
  insert into public.discovery_evidence_packs(company_id,title,purpose,created_by,updated_by)
    values(p_company_id,p_title,p_purpose,v_actor,v_actor) returning * into v_pack;
  insert into public.discovery_evidence_pack_events(company_id,pack_id,actor_user_id,event_type,reason,details)
    values(p_company_id,v_pack.id,v_actor,'created','Evidence pack created.',
      jsonb_build_object('title',p_title));
  return v_pack.id;
end;
$create$;

create or replace function public.add_discovery_evidence_pack_item(
  p_company_id uuid,p_pack_id uuid,p_provenance_event_id uuid,p_reason text
) returns uuid
language plpgsql security definer
set search_path=public,pg_temp
as $add$
declare
  v_actor uuid:=auth.uid();
  v_role text;
  v_pack public.discovery_evidence_packs%rowtype;
  v_provenance public.discovery_provenance_events%rowtype;
  v_item_id uuid;
begin
  select role into v_role from public.company_memberships
    where company_id=p_company_id and user_id=v_actor;
  if v_actor is null or coalesce(v_role,'') not in ('owner','admin') then
    raise exception 'Only company owners/admins can curate evidence packs.' using errcode='42501';
  end if;
  if p_reason is null or p_reason<>trim(p_reason) or length(p_reason) not between 10 and 1000 then
    raise exception 'An evidence inclusion reason of 10–1000 characters is required.' using errcode='22023';
  end if;
  select * into v_pack from public.discovery_evidence_packs
    where company_id=p_company_id and id=p_pack_id for update;
  if not found then raise exception 'Evidence pack was not found.' using errcode='P0002'; end if;
  if v_pack.status<>'draft' then raise exception 'Only draft evidence packs can be changed.' using errcode='55000'; end if;
  select * into v_provenance from public.discovery_provenance_events
    where company_id=p_company_id and id=p_provenance_event_id;
  if not found or v_provenance.evidence_id is null or v_provenance.source_id is null
    or v_provenance.event_type='evidence_retention_purged' then
    raise exception 'Choose a company-scoped provenance event linked to an evidence snapshot.' using errcode='22023';
  end if;
  select id into v_item_id from public.discovery_evidence_pack_items
    where company_id=p_company_id and pack_id=p_pack_id
      and provenance_event_id=p_provenance_event_id and removed_at is null;
  if found then return v_item_id; end if;
  insert into public.discovery_evidence_pack_items(
    company_id,pack_id,provenance_event_id,added_by
  ) values(p_company_id,p_pack_id,p_provenance_event_id,v_actor) returning id into v_item_id;
  insert into public.discovery_evidence_pack_events(company_id,pack_id,actor_user_id,event_type,reason,details)
    values(p_company_id,p_pack_id,v_actor,'item_added',p_reason,
      jsonb_build_object('itemId',v_item_id,'provenanceEventId',p_provenance_event_id));
  update public.discovery_evidence_packs set updated_by=v_actor,updated_at=clock_timestamp()
    where company_id=p_company_id and id=p_pack_id;
  return v_item_id;
end;
$add$;

create or replace function public.remove_discovery_evidence_pack_item(
  p_company_id uuid,p_pack_id uuid,p_item_id uuid,p_reason text
) returns uuid
language plpgsql security definer
set search_path=public,pg_temp
as $remove$
declare
  v_actor uuid:=auth.uid();
  v_role text;
  v_pack public.discovery_evidence_packs%rowtype;
  v_item public.discovery_evidence_pack_items%rowtype;
  v_event_id uuid;
begin
  select role into v_role from public.company_memberships
    where company_id=p_company_id and user_id=v_actor;
  if v_actor is null or coalesce(v_role,'') not in ('owner','admin') then
    raise exception 'Only company owners/admins can curate evidence packs.' using errcode='42501';
  end if;
  if p_reason is null or p_reason<>trim(p_reason) or length(p_reason) not between 10 and 1000 then
    raise exception 'An evidence removal reason of 10–1000 characters is required.' using errcode='22023';
  end if;
  select * into v_pack from public.discovery_evidence_packs
    where company_id=p_company_id and id=p_pack_id for update;
  if not found or v_pack.status<>'draft' then
    raise exception 'Only an existing draft evidence pack can be changed.' using errcode='55000';
  end if;
  select * into v_item from public.discovery_evidence_pack_items
    where company_id=p_company_id and pack_id=p_pack_id and id=p_item_id and removed_at is null
    for update;
  if not found then raise exception 'Active evidence pack item was not found.' using errcode='P0002'; end if;
  update public.discovery_evidence_pack_items
    set removed_by=v_actor,removed_at=clock_timestamp()
    where company_id=p_company_id and id=p_item_id;
  insert into public.discovery_evidence_pack_events(company_id,pack_id,actor_user_id,event_type,reason,details)
    values(p_company_id,p_pack_id,v_actor,'item_removed',p_reason,
      jsonb_build_object('itemId',p_item_id,'provenanceEventId',v_item.provenance_event_id))
    returning id into v_event_id;
  update public.discovery_evidence_packs set updated_by=v_actor,updated_at=clock_timestamp()
    where company_id=p_company_id and id=p_pack_id;
  return v_event_id;
end;
$remove$;

create or replace function public.submit_discovery_evidence_pack(
  p_company_id uuid,p_pack_id uuid,p_reason text
) returns uuid
language plpgsql security definer
set search_path=public,pg_temp
as $submit$
declare
  v_actor uuid:=auth.uid();
  v_role text;
  v_pack public.discovery_evidence_packs%rowtype;
  v_count integer;
  v_event_id uuid;
begin
  select role into v_role from public.company_memberships
    where company_id=p_company_id and user_id=v_actor;
  if v_actor is null or coalesce(v_role,'') not in ('owner','admin') then
    raise exception 'Only company owners/admins can submit evidence packs.' using errcode='42501';
  end if;
  if p_reason is null or p_reason<>trim(p_reason) or length(p_reason) not between 10 and 1000 then
    raise exception 'A submission reason of 10–1000 characters is required.' using errcode='22023';
  end if;
  select * into v_pack from public.discovery_evidence_packs
    where company_id=p_company_id and id=p_pack_id for update;
  if not found or v_pack.status<>'draft' then raise exception 'Only a draft evidence pack can be submitted.' using errcode='55000'; end if;
  select count(*)::integer into v_count from public.discovery_evidence_pack_items
    where company_id=p_company_id and pack_id=p_pack_id and removed_at is null;
  if v_count<1 then raise exception 'Add at least one evidence item before submission.' using errcode='22023'; end if;
  update public.discovery_evidence_packs set status='in_review',updated_by=v_actor,updated_at=clock_timestamp()
    where company_id=p_company_id and id=p_pack_id;
  insert into public.discovery_evidence_pack_events(company_id,pack_id,actor_user_id,event_type,reason,details)
    values(p_company_id,p_pack_id,v_actor,'submitted',p_reason,jsonb_build_object('itemCount',v_count))
    returning id into v_event_id;
  return v_event_id;
end;
$submit$;

create or replace function public.review_discovery_evidence_pack(
  p_company_id uuid,p_pack_id uuid,p_decision text,p_reason text
) returns uuid
language plpgsql security definer
set search_path=public,pg_temp
as $review$
declare
  v_actor uuid:=auth.uid();
  v_role text;
  v_pack public.discovery_evidence_packs%rowtype;
  v_event_id uuid;
begin
  select role into v_role from public.company_memberships
    where company_id=p_company_id and user_id=v_actor;
  if v_actor is null or coalesce(v_role,'') not in ('owner','admin') then
    raise exception 'Only company owners/admins can review evidence packs.' using errcode='42501';
  end if;
  if p_decision not in ('approved','rejected') then raise exception 'Choose approved or rejected.' using errcode='22023'; end if;
  if p_reason is null or p_reason<>trim(p_reason) or length(p_reason) not between 10 and 1000 then
    raise exception 'A review reason of 10–1000 characters is required.' using errcode='22023';
  end if;
  select * into v_pack from public.discovery_evidence_packs
    where company_id=p_company_id and id=p_pack_id for update;
  if not found or v_pack.status<>'in_review' then raise exception 'Only a submitted evidence pack can be reviewed.' using errcode='55000'; end if;
  update public.discovery_evidence_packs
    set status=p_decision,updated_by=v_actor,updated_at=clock_timestamp(),
        reviewed_by=v_actor,reviewed_at=clock_timestamp(),review_reason=p_reason
    where company_id=p_company_id and id=p_pack_id;
  insert into public.discovery_evidence_pack_events(company_id,pack_id,actor_user_id,event_type,reason,details)
    values(p_company_id,p_pack_id,v_actor,p_decision,p_reason,jsonb_build_object('reviewedStatus',p_decision))
    returning id into v_event_id;
  return v_event_id;
end;
$review$;

create or replace function public.reopen_discovery_evidence_pack(
  p_company_id uuid,p_pack_id uuid,p_reason text
) returns uuid
language plpgsql security definer
set search_path=public,pg_temp
as $reopen$
declare
  v_actor uuid:=auth.uid();
  v_role text;
  v_pack public.discovery_evidence_packs%rowtype;
  v_event_id uuid;
begin
  select role into v_role from public.company_memberships
    where company_id=p_company_id and user_id=v_actor;
  if v_actor is null or coalesce(v_role,'') not in ('owner','admin') then
    raise exception 'Only company owners/admins can reopen evidence packs.' using errcode='42501';
  end if;
  if p_reason is null or p_reason<>trim(p_reason) or length(p_reason) not between 10 and 1000 then
    raise exception 'A reopening reason of 10–1000 characters is required.' using errcode='22023';
  end if;
  select * into v_pack from public.discovery_evidence_packs
    where company_id=p_company_id and id=p_pack_id for update;
  if not found or v_pack.status<>'rejected' then raise exception 'Only a rejected evidence pack can be reopened.' using errcode='55000'; end if;
  update public.discovery_evidence_packs
    set status='draft',updated_by=v_actor,updated_at=clock_timestamp(),
        reviewed_by=null,reviewed_at=null,review_reason=null
    where company_id=p_company_id and id=p_pack_id;
  insert into public.discovery_evidence_pack_events(company_id,pack_id,actor_user_id,event_type,reason,details)
    values(p_company_id,p_pack_id,v_actor,'reopened',p_reason,'{}'::jsonb)
    returning id into v_event_id;
  return v_event_id;
end;
$reopen$;

create or replace function public.record_discovery_evidence_pack_export(
  p_company_id uuid,p_pack_id uuid,p_manifest_hash text,p_item_count integer
) returns uuid
language plpgsql security definer
set search_path=public,pg_temp
as $export$
declare
  v_actor uuid:=auth.uid();
  v_role text;
  v_pack public.discovery_evidence_packs%rowtype;
  v_count integer;
  v_event_id uuid;
begin
  select role into v_role from public.company_memberships
    where company_id=p_company_id and user_id=v_actor;
  if v_actor is null or coalesce(v_role,'') not in ('owner','admin') then
    raise exception 'Only company owners/admins can export evidence packs.' using errcode='42501';
  end if;
  if p_manifest_hash is null or p_manifest_hash !~ '^[a-f0-9]{64}$'
    or p_item_count is null or p_item_count<1 or p_item_count>500 then
    raise exception 'A valid SHA-256 manifest hash and item count are required.' using errcode='22023';
  end if;
  select * into v_pack from public.discovery_evidence_packs
    where company_id=p_company_id and id=p_pack_id for update;
  if not found or v_pack.status<>'approved' then raise exception 'Only an approved evidence pack can be exported.' using errcode='42501'; end if;
  select count(*)::integer into v_count from public.discovery_evidence_pack_items
    where company_id=p_company_id and pack_id=p_pack_id and removed_at is null;
  if v_count<>p_item_count then raise exception 'Evidence pack changed during export; refresh and create a new export.' using errcode='40001'; end if;
  insert into public.discovery_evidence_pack_events(company_id,pack_id,actor_user_id,event_type,reason,details)
    values(p_company_id,p_pack_id,v_actor,'exported','Approved metadata/provenance bundle exported.',
      jsonb_build_object('manifestHash',p_manifest_hash,'itemCount',v_count))
    returning id into v_event_id;
  return v_event_id;
end;
$export$;

revoke all on function public.prevent_discovery_evidence_pack_event_mutation() from public,anon,authenticated,service_role;
revoke all on function public.create_discovery_evidence_pack(uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.add_discovery_evidence_pack_item(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.remove_discovery_evidence_pack_item(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.submit_discovery_evidence_pack(uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.review_discovery_evidence_pack(uuid,uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.reopen_discovery_evidence_pack(uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.record_discovery_evidence_pack_export(uuid,uuid,text,integer) from public,anon,authenticated,service_role;

grant execute on function public.create_discovery_evidence_pack(uuid,text,text) to authenticated;
grant execute on function public.add_discovery_evidence_pack_item(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.remove_discovery_evidence_pack_item(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.submit_discovery_evidence_pack(uuid,uuid,text) to authenticated;
grant execute on function public.review_discovery_evidence_pack(uuid,uuid,text,text) to authenticated;
grant execute on function public.reopen_discovery_evidence_pack(uuid,uuid,text) to authenticated;
grant execute on function public.record_discovery_evidence_pack_export(uuid,uuid,text,integer) to authenticated;

comment on table public.discovery_evidence_packs is
  'E21 curated, reviewed evidence-pack record. References existing E04 evidence and E13 provenance; it never duplicates source content.';
comment on table public.discovery_evidence_pack_items is
  'E21 immutable citation membership with soft-removal history; each item points to one E13 provenance event linked to an E04 evidence ID.';
comment on table public.discovery_evidence_pack_events is
  'E21 append-only pack creation, curation, submission, approval/rejection, reopening and export receipts.';
comment on view public.discovery_evidence_candidate_inbox is
  'E21 all-stage evidence citation catalogue. No canonical URL, raw body, extracted field value, storage reference or access credential is returned.';
comment on view public.discovery_evidence_pack_item_inbox is
  'E21 pack citations and provenance metadata, including raw-evidence retention status; no source body or object reference is included.';

commit;
