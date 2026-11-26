-- AXIVESTRA E12.1: durable, company-gated duplicate-generation queue.
begin;
create table if not exists public.discovery_deduplication_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies(id) on delete cascade,
  status text not null default 'queued' check(status in ('queued','running','succeeded','failed','cancelled')),
  rerun_requested boolean not null default false,
  attempts integer not null default 0 check(attempts>=0),
  max_attempts integer not null default 3 check(max_attempts between 1 and 5),
  available_at timestamptz not null default now(),
  lease_owner text, lease_expires_at timestamptz, heartbeat_at timestamptz,
  started_at timestamptz, finished_at timestamptz,
  last_error_code text,
  last_error_message text check(last_error_message is null or length(last_error_message)<=1000),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists discovery_deduplication_jobs_claim_idx
  on public.discovery_deduplication_jobs(status,available_at,created_at)
  where status in ('queued','running');
alter table public.discovery_deduplication_jobs enable row level security;
revoke all on public.discovery_deduplication_jobs from public,anon,authenticated;
grant all on public.discovery_deduplication_jobs to service_role;

-- Coalesce updates to one job per company; changes during a running pass request one rerun.
create or replace function public.enqueue_discovery_deduplication_job(p_company_id uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp
as $enqueue$
declare v_job public.discovery_deduplication_jobs%rowtype;
begin
  if p_company_id is null then raise exception 'E12 company scope is required' using errcode='22023'; end if;
  insert into public.discovery_deduplication_jobs(company_id,status) values(p_company_id,'queued')
  on conflict(company_id) do update set
    status=case when public.discovery_deduplication_jobs.status='running' then 'running' else 'queued' end,
    rerun_requested=(public.discovery_deduplication_jobs.status='running'),
    attempts=case when public.discovery_deduplication_jobs.status in ('succeeded','failed','cancelled')
      then 0 else public.discovery_deduplication_jobs.attempts end,
    available_at=case when public.discovery_deduplication_jobs.status='running'
      then public.discovery_deduplication_jobs.available_at else clock_timestamp() end,
    lease_owner=case when public.discovery_deduplication_jobs.status='running'
      then public.discovery_deduplication_jobs.lease_owner else null end,
    lease_expires_at=case when public.discovery_deduplication_jobs.status='running'
      then public.discovery_deduplication_jobs.lease_expires_at else null end,
    heartbeat_at=case when public.discovery_deduplication_jobs.status='running'
      then public.discovery_deduplication_jobs.heartbeat_at else null end,
    finished_at=null,
    last_error_code=case when public.discovery_deduplication_jobs.status='running'
      then public.discovery_deduplication_jobs.last_error_code else null end,
    last_error_message=case when public.discovery_deduplication_jobs.status='running'
      then public.discovery_deduplication_jobs.last_error_message else null end,
    updated_at=clock_timestamp()
  returning * into v_job;
  return v_job.id;
end;
$enqueue$;

create or replace function public.enqueue_discovery_deduplication_from_record()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $trigger$
declare v_payload jsonb:=to_jsonb(new);
begin
  if tg_table_name='discovery_canonical_entities'
    and coalesce(v_payload->>'status','')<>'active' then return new; end if;
  if tg_table_name in ('discovery_entity_identifiers','discovery_entity_aliases')
    and coalesce(v_payload->>'review_state','') not in ('owner_accepted','needs_verification') then return new; end if;
  if tg_table_name in ('discovery_professional_people','discovery_contact_points')
    and coalesce(v_payload->>'status','')<>'active' then return new; end if;
  perform public.enqueue_discovery_deduplication_job((v_payload->>'company_id')::uuid);
  return new;
end;
$trigger$;

drop trigger if exists discovery_canonical_entity_enqueue_deduplication on public.discovery_canonical_entities;
create trigger discovery_canonical_entity_enqueue_deduplication after insert or update on public.discovery_canonical_entities
for each row execute function public.enqueue_discovery_deduplication_from_record();
drop trigger if exists discovery_identifier_enqueue_deduplication on public.discovery_entity_identifiers;
create trigger discovery_identifier_enqueue_deduplication after insert or update on public.discovery_entity_identifiers
for each row execute function public.enqueue_discovery_deduplication_from_record();
drop trigger if exists discovery_alias_enqueue_deduplication on public.discovery_entity_aliases;
create trigger discovery_alias_enqueue_deduplication after insert or update on public.discovery_entity_aliases
for each row execute function public.enqueue_discovery_deduplication_from_record();
drop trigger if exists discovery_professional_person_enqueue_deduplication on public.discovery_professional_people;
create trigger discovery_professional_person_enqueue_deduplication after insert or update on public.discovery_professional_people
for each row execute function public.enqueue_discovery_deduplication_from_record();
drop trigger if exists discovery_professional_role_enqueue_deduplication on public.discovery_professional_role_assignments;
create trigger discovery_professional_role_enqueue_deduplication after insert or update on public.discovery_professional_role_assignments
for each row execute function public.enqueue_discovery_deduplication_from_record();
drop trigger if exists discovery_contact_point_enqueue_deduplication on public.discovery_contact_points;
create trigger discovery_contact_point_enqueue_deduplication after insert or update on public.discovery_contact_points
for each row execute function public.enqueue_discovery_deduplication_from_record();

create or replace function public.claim_discovery_deduplication_job(p_worker_id text,p_lease_seconds integer default 90)
returns setof public.discovery_deduplication_jobs language plpgsql security definer set search_path=public,pg_temp
as $claim$
declare v_job public.discovery_deduplication_jobs%rowtype; v_now timestamptz:=clock_timestamp();
begin
  if p_worker_id is null or length(trim(p_worker_id))<8 or length(p_worker_id)>160 then
    raise exception 'Invalid E12 worker identity' using errcode='22023'; end if;
  if p_lease_seconds<15 or p_lease_seconds>300 then
    raise exception 'E12 lease must be 15 to 300 seconds' using errcode='22023'; end if;
  update public.discovery_deduplication_jobs
    set status=case when rerun_requested then 'queued' when attempts>=max_attempts then 'failed' else 'queued' end,
      attempts=case when rerun_requested then 0 else attempts end,rerun_requested=false,
      lease_owner=null,lease_expires_at=null,heartbeat_at=null,
      finished_at=case when attempts>=max_attempts and not rerun_requested then v_now else null end,
      available_at=case when rerun_requested then v_now else v_now+make_interval(secs=>least(30*greatest(attempts,1),300)) end,
      last_error_code=coalesce(last_error_code,'E12_LEASE_EXPIRED'),
      last_error_message=coalesce(last_error_message,'Previous E12 lease expired before completion.'),
      updated_at=v_now where status='running' and lease_expires_at<=v_now;
  select j.* into v_job from public.discovery_deduplication_jobs j
    join public.discovery_company_worker_controls wc on wc.company_id=j.company_id and wc.enabled=true and wc.expires_at>v_now
    where j.status='queued' and j.available_at<=v_now and j.attempts<j.max_attempts
    order by j.available_at,j.created_at for update of j skip locked limit 1;
  if not found then return; end if;
  update public.discovery_deduplication_jobs set status='running',attempts=attempts+1,
    lease_owner=p_worker_id,lease_expires_at=v_now+make_interval(secs=>p_lease_seconds),
    heartbeat_at=v_now,started_at=coalesce(started_at,v_now),updated_at=v_now
    where id=v_job.id returning * into v_job;
  return next v_job;
end;
$claim$;

create or replace function public.heartbeat_discovery_deduplication_job(p_job_id uuid,p_worker_id text,p_lease_seconds integer default 90)
returns boolean language plpgsql security definer set search_path=public,pg_temp
as $heartbeat$
declare v_updated integer;
begin
  if p_lease_seconds<15 or p_lease_seconds>300 then raise exception 'E12 lease must be 15 to 300 seconds' using errcode='22023'; end if;
  update public.discovery_deduplication_jobs j set heartbeat_at=clock_timestamp(),
    lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),updated_at=clock_timestamp()
    where j.id=p_job_id and j.status='running' and j.lease_owner=p_worker_id
      and j.lease_expires_at>clock_timestamp()
      and exists(select 1 from public.discovery_company_worker_controls wc
        where wc.company_id=j.company_id and wc.enabled=true and wc.expires_at>clock_timestamp());
  get diagnostics v_updated=row_count;
  return v_updated=1;
end;
$heartbeat$;

create or replace function public.complete_discovery_deduplication_job(p_job_id uuid,p_worker_id text)
returns integer language plpgsql security definer set search_path=public,pg_temp
as $complete$
declare v_job public.discovery_deduplication_jobs%rowtype; v_generated integer;
begin
  select * into v_job from public.discovery_deduplication_jobs
    where id=p_job_id and status='running' and lease_owner=p_worker_id
      and lease_expires_at>clock_timestamp() for update;
  if not found then raise exception 'E12 lease is no longer valid' using errcode='42501'; end if;
  if not exists(select 1 from public.discovery_company_worker_controls wc
    where wc.company_id=v_job.company_id and wc.enabled=true and wc.expires_at>clock_timestamp()) then
    raise exception 'E12 company worker grant is disabled or expired' using errcode='42501'; end if;
  v_generated:=public.generate_discovery_deduplication_candidates(v_job.company_id);
  update public.discovery_deduplication_jobs set
    status=case when rerun_requested then 'queued' else 'succeeded' end,
    attempts=case when rerun_requested then 0 else attempts end,rerun_requested=false,
    available_at=case when rerun_requested then clock_timestamp() else available_at end,
    lease_owner=null,lease_expires_at=null,heartbeat_at=null,
    finished_at=case when rerun_requested then null else clock_timestamp() end,
    last_error_code=null,last_error_message=null,updated_at=clock_timestamp()
    where id=v_job.id;
  return v_generated;
end;
$complete$;

create or replace function public.fail_discovery_deduplication_job(p_job_id uuid,p_worker_id text,p_error_code text,p_error_message text)
returns boolean language plpgsql security definer set search_path=public,pg_temp
as $fail$
declare v_updated integer;
begin
  update public.discovery_deduplication_jobs set
    status=case when rerun_requested then 'queued' when attempts>=max_attempts then 'failed' else 'queued' end,
    attempts=case when rerun_requested then 0 else attempts end,rerun_requested=false,
    available_at=case when rerun_requested then clock_timestamp() else clock_timestamp()+make_interval(secs=>least(30*greatest(attempts,1),300)) end,
    lease_owner=null,lease_expires_at=null,heartbeat_at=null,
    finished_at=case when attempts>=max_attempts and not rerun_requested then clock_timestamp() else null end,
    last_error_code=left(coalesce(nullif(trim(p_error_code),''),'E12_WORKER_FAILED'),100),
    last_error_message=left(coalesce(nullif(trim(p_error_message),''),'E12 deduplication worker failed.'),1000),
    updated_at=clock_timestamp()
    where id=p_job_id and status='running' and lease_owner=p_worker_id and lease_expires_at>clock_timestamp();
  get diagnostics v_updated=row_count;
  return v_updated=1;
end;
$fail$;

revoke all on function public.enqueue_discovery_deduplication_job(uuid) from public,anon,authenticated;
revoke all on function public.claim_discovery_deduplication_job(text,integer) from public,anon,authenticated;
revoke all on function public.heartbeat_discovery_deduplication_job(uuid,text,integer) from public,anon,authenticated;
revoke all on function public.complete_discovery_deduplication_job(uuid,text) from public,anon,authenticated;
revoke all on function public.fail_discovery_deduplication_job(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_discovery_deduplication_job(text,integer) to service_role;
grant execute on function public.heartbeat_discovery_deduplication_job(uuid,text,integer) to service_role;
grant execute on function public.complete_discovery_deduplication_job(uuid,text) to service_role;
grant execute on function public.fail_discovery_deduplication_job(uuid,text,text,text) to service_role;
comment on table public.discovery_deduplication_jobs is
  'Coalesced E12 company-scoped queue. Claims and heartbeats require the temporary owner/admin worker grant.';
commit;
