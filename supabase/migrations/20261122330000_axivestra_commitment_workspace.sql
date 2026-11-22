-- AXIVESTRA E18: structured commitments, ownership and action history.
-- Additive operational record. Existing local task collections are not rewritten or deleted.
begin;

create table if not exists public.company_action_commitments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  record_key text not null check (length(trim(record_key)) between 1 and 180),
  commitment_type text not null check (commitment_type in ('task','promise','obligation','milestone')),
  title text not null check (length(trim(title)) between 1 and 200),
  summary text not null default '' check (length(summary)<=1000),
  status text not null default 'open' check (status in ('open','in_progress','blocked','completed','cancelled')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  next_action_code text not null default 'review_internal'
    check (next_action_code in (
      'review_internal','verify_evidence','prepare_document','collect_internal_input',
      'schedule_internal_review','confirm_milestone','none'
    )),
  due_at timestamptz,
  responsible_user_id uuid references auth.users(id) on delete restrict,
  deal_record_type text not null default 'property' check (deal_record_type='property'),
  deal_record_key text,
  party_record_type text not null default 'contact' check (party_record_type='contact'),
  party_record_key text,
  relationship_id uuid,
  source_task_record_key text,
  change_reason_code text not null default 'created' check (change_reason_code in (
    'created','progress','blocked','completed','cancelled','reopened',
    'reassigned','due_date_changed','details_updated'
  )),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  unique(company_id,id),
  unique(company_id,record_key),
  unique(company_id,source_task_record_key),
  foreign key(company_id,deal_record_type,deal_record_key)
    references public.company_records(company_id,record_type,record_key) on delete restrict,
  foreign key(company_id,party_record_type,party_record_key)
    references public.company_records(company_id,record_type,record_key) on delete restrict,
  foreign key(company_id,relationship_id)
    references public.company_deal_parties(company_id,id) on delete restrict,
  foreign key(company_id,source_task_record_key)
    references public.company_records(company_id,record_type,record_key) on delete restrict,
  check (source_task_record_key is null or source_task_record_key<>''),
  check ((status in ('completed','cancelled') and closed_at is not null)
      or (status not in ('completed','cancelled') and closed_at is null)),
  check (commitment_type<>'milestone' or due_at is not null)
);
create index if not exists company_action_commitments_inbox_idx
  on public.company_action_commitments(company_id,status,due_at,priority);
create index if not exists company_action_commitments_assignee_idx
  on public.company_action_commitments(company_id,responsible_user_id,status,due_at);
create index if not exists company_action_commitments_deal_idx
  on public.company_action_commitments(company_id,deal_record_key,status,due_at);
create index if not exists company_action_commitments_party_idx
  on public.company_action_commitments(company_id,party_record_key,status,due_at);

create table if not exists public.company_commitment_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  commitment_id uuid not null,
  event_type text not null check (event_type in (
    'commitment_created','status_changed','assignee_changed','due_date_changed','details_changed'
  )),
  previous_status text,
  new_status text not null,
  previous_priority text,
  new_priority text not null,
  previous_responsible_user_id uuid,
  new_responsible_user_id uuid,
  previous_due_at timestamptz,
  new_due_at timestamptz,
  reason_code text not null check (reason_code in (
    'created','progress','blocked','completed','cancelled','reopened',
    'reassigned','due_date_changed','details_updated'
  )),
  actor_user_id uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now(),
  unique(company_id,id),
  foreign key(company_id,commitment_id)
    references public.company_action_commitments(company_id,id) on delete cascade
);
create index if not exists company_commitment_events_timeline_idx
  on public.company_commitment_events(company_id,commitment_id,occurred_at desc);

alter table public.company_action_commitments enable row level security;
alter table public.company_commitment_events enable row level security;
drop policy if exists company_action_commitments_read on public.company_action_commitments;
create policy company_action_commitments_read on public.company_action_commitments
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists company_action_commitments_insert on public.company_action_commitments;
create policy company_action_commitments_insert on public.company_action_commitments
  for insert to authenticated with check (
    public.has_company_role(company_id,array['owner','admin','manager','staff'])
    and created_by=auth.uid() and updated_by=auth.uid()
  );
drop policy if exists company_action_commitments_update on public.company_action_commitments;
create policy company_action_commitments_update on public.company_action_commitments
  for update to authenticated
  using (public.has_company_role(company_id,array['owner','admin','manager','staff']))
  with check (public.has_company_role(company_id,array['owner','admin','manager','staff']) and updated_by=auth.uid());
drop policy if exists company_commitment_events_read on public.company_commitment_events;
create policy company_commitment_events_read on public.company_commitment_events
  for select to authenticated using (public.is_company_member(company_id));

revoke all on public.company_action_commitments,public.company_commitment_events from public,anon,authenticated,service_role;
grant select,insert,update on public.company_action_commitments to authenticated;
grant select on public.company_commitment_events to authenticated;

create or replace function public.guard_company_action_commitment()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $guard$
declare
  v_role text;
  v_old_status text;
  v_due_changed boolean:=false;
  v_assignee_changed boolean:=false;
  v_status_changed boolean:=false;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user context is required for commitment changes.' using errcode='42501';
  end if;
  select role into v_role from public.company_memberships
    where company_id=case when tg_op='DELETE' then old.company_id else new.company_id end
      and user_id=auth.uid();
  if v_role is null or v_role not in ('owner','admin','manager','staff') then
    raise exception 'Only an authorised company member can change commitments.' using errcode='42501';
  end if;
  if tg_op='DELETE' then
    raise exception 'Commitments cannot be hard-deleted; cancel or complete the record.' using errcode='42501';
  end if;
  if new.responsible_user_id is not null and not exists(
    select 1 from public.company_memberships
    where company_id=new.company_id and user_id=new.responsible_user_id
  ) then raise exception 'Responsible user must be a member of this company.' using errcode='42501'; end if;
  if v_role='staff' and new.responsible_user_id is not null and new.responsible_user_id is distinct from auth.uid() then
    raise exception 'Staff can only assign commitments to themselves.' using errcode='42501';
  end if;

  if new.relationship_id is not null then
    if new.deal_record_key is null or new.party_record_key is null or not exists(
      select 1 from public.company_deal_parties p
      where p.company_id=new.company_id and p.id=new.relationship_id
        and p.deal_record_key=new.deal_record_key and p.party_record_key=new.party_record_key
        and (p.effective_to is null or p.effective_to>=current_date)
    ) then raise exception 'The selected relationship must connect this deal and party.' using errcode='22023'; end if;
  end if;
  if new.deal_record_key is not null and exists(select 1 from public.company_records r
    where r.company_id=new.company_id and r.record_type='property'
      and r.record_key=new.deal_record_key and r.deleted_at is not null) then
    raise exception 'Deleted deal records cannot receive active commitments.';
  end if;
  if new.party_record_key is not null and exists(select 1 from public.company_records r
    where r.company_id=new.company_id and r.record_type='contact'
      and r.record_key=new.party_record_key and r.deleted_at is not null) then
    raise exception 'Deleted contact records cannot receive active commitments.';
  end if;

  if tg_op='INSERT' then
    new.created_by:=auth.uid();
    new.updated_by:=auth.uid();
    new.change_reason_code:='created';
    if new.status<>'open' then raise exception 'New commitments must begin in open status.'; end if;
    return new;
  end if;

  if old.company_id is distinct from new.company_id
    or old.record_key is distinct from new.record_key
    or old.commitment_type is distinct from new.commitment_type
    or old.created_by is distinct from new.created_by then
    raise exception 'Commitment identity and creator are immutable.';
  end if;
  if v_role='staff' and old.responsible_user_id is distinct from auth.uid()
    and old.created_by is distinct from auth.uid() then
    raise exception 'Staff can only update commitments assigned to them or created by them.' using errcode='42501';
  end if;
  new.created_by:=old.created_by;
  new.updated_by:=auth.uid();
  new.updated_at:=clock_timestamp();
  v_old_status:=old.status;
  v_status_changed:=old.status is distinct from new.status;
  v_due_changed:=old.due_at is distinct from new.due_at;
  v_assignee_changed:=old.responsible_user_id is distinct from new.responsible_user_id;

  if v_status_changed then
    if old.status='cancelled' then
      raise exception 'Cancelled commitments are terminal; create a new record instead.' using errcode='42501';
    elsif old.status='completed' then
      if new.status<>'in_progress' or new.change_reason_code<>'reopened' then
        raise exception 'Completed commitments can only be reopened to in_progress with a reason.' using errcode='42501';
      end if;
    elsif not (
      (old.status='open' and new.status in ('in_progress','blocked','completed','cancelled')) or
      (old.status='in_progress' and new.status in ('open','blocked','completed','cancelled')) or
      (old.status='blocked' and new.status in ('open','in_progress','completed','cancelled'))
    ) then raise exception 'Commitment status transition is not allowed.' using errcode='42501';
    end if;
    if new.status='completed' and new.change_reason_code<>'completed' then
      raise exception 'Completing a commitment requires the completed reason.' using errcode='22023';
    elsif new.status='cancelled' and new.change_reason_code<>'cancelled' then
      raise exception 'Cancelling a commitment requires the cancelled reason.' using errcode='22023';
    elsif old.status<>'completed' and new.status not in ('completed','cancelled')
      and new.change_reason_code not in ('progress','blocked') then
      raise exception 'Commitment status change requires a progress or blocked reason.' using errcode='22023';
    end if;
    new.closed_at:=case when new.status in ('completed','cancelled') then coalesce(new.closed_at,clock_timestamp()) else null end;
  elsif v_assignee_changed then
    if new.change_reason_code<>'reassigned' then
      raise exception 'Changing the responsible member requires the reassigned reason.' using errcode='22023';
    end if;
  elsif v_due_changed then
    if new.change_reason_code<>'due_date_changed' then
      raise exception 'Changing a commitment due date requires the due_date_changed reason.' using errcode='22023';
    end if;
  elsif new.change_reason_code not in ('details_updated','reassigned','due_date_changed') then
    raise exception 'Commitment details update reason is invalid.' using errcode='22023';
  end if;

  return new;
end;
$guard$;
drop trigger if exists company_action_commitments_guard on public.company_action_commitments;
create trigger company_action_commitments_guard
  before insert or update or delete on public.company_action_commitments
  for each row execute function public.guard_company_action_commitment();

create or replace function public.prevent_company_commitment_event_mutation()
returns trigger language plpgsql
as $event_guard$
begin
  if pg_trigger_depth()>1 then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  raise exception 'Commitment event history is immutable; append a new event instead.';
end;
$event_guard$;
drop trigger if exists company_commitment_events_no_mutation on public.company_commitment_events;
create trigger company_commitment_events_no_mutation
  before update or delete on public.company_commitment_events
  for each row execute function public.prevent_company_commitment_event_mutation();

create or replace function public.capture_company_action_commitment_event()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $capture$
declare v_event_type text;
begin
  if tg_op='INSERT' then
    v_event_type:='commitment_created';
  elsif old.status is distinct from new.status then
    v_event_type:='status_changed';
  elsif old.responsible_user_id is distinct from new.responsible_user_id then
    v_event_type:='assignee_changed';
  elsif old.due_at is distinct from new.due_at then
    v_event_type:='due_date_changed';
  elsif old.title is distinct from new.title or old.summary is distinct from new.summary
    or old.priority is distinct from new.priority or old.next_action_code is distinct from new.next_action_code
    or old.deal_record_key is distinct from new.deal_record_key
    or old.party_record_key is distinct from new.party_record_key
    or old.relationship_id is distinct from new.relationship_id then
    v_event_type:='details_changed';
  else
    return new;
  end if;
  insert into public.company_commitment_events(
    company_id,commitment_id,event_type,previous_status,new_status,
    previous_priority,new_priority,previous_responsible_user_id,new_responsible_user_id,
    previous_due_at,new_due_at,reason_code,actor_user_id
  ) values (
    new.company_id,new.id,v_event_type,
    case when tg_op='INSERT' then null else old.status end,new.status,
    case when tg_op='INSERT' then null else old.priority end,new.priority,
    case when tg_op='INSERT' then null else old.responsible_user_id end,new.responsible_user_id,
    case when tg_op='INSERT' then null else old.due_at end,new.due_at,
    new.change_reason_code,auth.uid()
  );
  return new;
end;
$capture$;
drop trigger if exists company_action_commitments_capture_event on public.company_action_commitments;
create trigger company_action_commitments_capture_event
  after insert or update on public.company_action_commitments
  for each row execute function public.capture_company_action_commitment_event();

create or replace function public.prevent_company_record_soft_delete_with_commitments()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $record_guard$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    if exists(
      select 1 from public.company_action_commitments c
      where c.company_id=old.company_id and c.status not in ('completed','cancelled') and (
        (old.record_type='property' and c.deal_record_key=old.record_key)
        or (old.record_type='contact' and c.party_record_key=old.record_key)
        or (old.record_type='task' and c.source_task_record_key=old.record_key)
      )
    ) then
      raise exception 'Active commitments prevent soft deletion of a linked deal, party or source task.';
    end if;
  end if;
  return new;
end;
$record_guard$;
drop trigger if exists company_record_commitment_soft_delete_guard on public.company_records;
create trigger company_record_commitment_soft_delete_guard
  before update on public.company_records
  for each row execute function public.prevent_company_record_soft_delete_with_commitments();

create or replace view public.company_commitment_inbox
with (security_invoker=true)
as
select
  c.id,c.company_id,c.record_key,c.commitment_type,c.title,c.summary,c.status,c.priority,
  c.next_action_code,c.due_at,c.responsible_user_id,c.deal_record_key,c.party_record_key,
  c.relationship_id,c.source_task_record_key,c.created_by,c.updated_by,c.created_at,c.updated_at,c.closed_at,
  case
    when c.status in ('completed','cancelled') then 'closed'
    when c.due_at is null then 'no_due_date'
    when c.due_at<now() then 'overdue'
    when c.due_at::date=current_date then 'due_today'
    else 'upcoming'
  end as due_state,
  case when c.status in ('completed','cancelled') or c.due_at is null or c.due_at>=now()
    then 0 else greatest(0,ceil(extract(epoch from (now()-c.due_at))/86400.0)::int) end as days_overdue,
  coalesce(nullif(d.payload->>'title',''),nullif(d.payload->>'name',''),c.deal_record_key) as deal_label,
  coalesce(nullif(p.payload->>'name',''),nullif(p.payload->>'legal_name',''),c.party_record_key) as party_label
from public.company_action_commitments c
left join public.company_records d on d.company_id=c.company_id and d.record_type='property'
  and d.record_key=c.deal_record_key and d.deleted_at is null
left join public.company_records p on p.company_id=c.company_id and p.record_type='contact'
  and p.record_key=c.party_record_key and p.deleted_at is null;

revoke all on public.company_commitment_inbox from public,anon,authenticated;
grant select on public.company_commitment_inbox to authenticated;

revoke all on function public.guard_company_action_commitment() from public,anon,authenticated,service_role;
revoke all on function public.prevent_company_record_soft_delete_with_commitments() from public,anon,authenticated,service_role;
revoke all on function public.prevent_company_commitment_event_mutation() from public,anon,authenticated,service_role;
revoke all on function public.capture_company_action_commitment_event() from public,anon,authenticated,service_role;

comment on table public.company_action_commitments is
  'E18 company-scoped structured tasks, promises, obligations and milestones. Not a replacement for local task records.';
comment on table public.company_commitment_events is
  'E18 append-only status, assignment, due-date and detail history for structured commitments.';
comment on view public.company_commitment_inbox is
  'E18 security-invoker action inbox; overdue and due-today are derived from due_at and current status.';

commit;
