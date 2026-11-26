-- AXIVESTRA E05/E08 hardening: encrypt observed email and phone facts before DB persistence.
-- Existing immutable source evidence remains in its private evidence bucket under its retention policy.
-- Contact-derived fact rows are stored masked; only E08's server worker may decrypt them in memory.
begin;

alter table public.discovery_extracted_facts
  add column if not exists raw_value_ciphertext text,
  add column if not exists raw_value_nonce text,
  add column if not exists raw_value_auth_tag text,
  add column if not exists raw_value_fingerprint text,
  add column if not exists raw_value_encryption_version text;

-- Existing legacy contact facts are backfilled by the idempotent worker script
-- before the constraint is validated. NOT VALID permits the schema rollout while
-- still enforcing the constraint for every new or updated contact fact.
alter table public.discovery_extracted_facts
  drop constraint if exists discovery_extracted_facts_contact_encryption_check;
alter table public.discovery_extracted_facts
  add constraint discovery_extracted_facts_contact_encryption_check check (
    (
      value_type in ('email','phone')
      and raw_value_ciphertext is not null
      and length(raw_value_ciphertext) between 1 and 800
      and raw_value_nonce is not null
      and length(raw_value_nonce) between 1 and 64
      and raw_value_auth_tag is not null
      and length(raw_value_auth_tag) between 1 and 64
      and raw_value_fingerprint ~ '^[a-f0-9]{64}$'
      and raw_value_encryption_version = 'aes-256-gcm-v1'
      and normalized_value is null
      and position('*' in raw_value) > 0
      and source_span->>'quoteRedacted' = 'true'
      and source_span->>'quote' = raw_value
      and not (source_span ? 'quoteHash')
    )
    or
    (
      value_type not in ('email','phone')
      and raw_value_ciphertext is null
      and raw_value_nonce is null
      and raw_value_auth_tag is null
      and raw_value_fingerprint is null
      and raw_value_encryption_version is null
    )
  ) not valid;

create index if not exists discovery_extracted_facts_contact_fingerprint_idx
  on public.discovery_extracted_facts(company_id, value_type, raw_value_fingerprint)
  where value_type in ('email','phone');

create or replace function public.complete_discovery_extraction(
  p_job_id uuid,
  p_worker_id text,
  p_run jsonb,
  p_entities jsonb,
  p_facts jsonb
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $complete$
declare
  v_job public.discovery_extraction_jobs%rowtype;
  v_source public.discovery_source_registry%rowtype;
  v_run_id uuid;
  v_entity jsonb;
  v_fact jsonb;
  v_entity_id uuid;
  v_entity_map jsonb := '{}'::jsonb;
  v_mention_key text;
  v_field text;
  v_type text;
  v_raw_value text;
  v_normalized_value jsonb;
  v_source_span jsonb;
  v_fact_count integer := 0;
  v_entity_count integer := 0;
  v_evidence public.discovery_evidence_items%rowtype;
begin
  if jsonb_typeof(p_run) <> 'object' or jsonb_typeof(p_entities) <> 'array'
    or jsonb_typeof(p_facts) <> 'array'
    or (p_run ? 'warnings' and jsonb_typeof(p_run->'warnings') <> 'array')
    or jsonb_array_length(p_entities) > 500
    or jsonb_array_length(p_facts) > 2000 then
    raise exception 'Extraction result payload is outside approved bounds' using errcode = '22023';
  end if;

  select * into v_job from public.discovery_extraction_jobs
    where id = p_job_id and status = 'running'
      and lease_owner = p_worker_id and lease_expires_at > clock_timestamp()
    for update;
  if not found then
    raise exception 'Extraction job lease is no longer valid' using errcode = '42501';
  end if;

  select * into v_source from public.discovery_source_registry
    where company_id = v_job.company_id and id = v_job.source_id and status = 'approved'
    for share;
  if not found then
    raise exception 'Extraction source approval has been revoked' using errcode = '42501';
  end if;
  select * into v_evidence from public.discovery_evidence_items
    where company_id = v_job.company_id and id = v_job.evidence_id
    for share;
  if not found or v_evidence.source_id <> v_job.source_id
    or v_evidence.content_hash is distinct from p_run->>'source_content_hash' then
    raise exception 'Extraction evidence hash or source does not match the immutable snapshot' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.discovery_jobs dj
    join public.discovery_profiles p
      on p.company_id = dj.company_id and p.id = dj.profile_id and p.enabled = true
    join public.discovery_profile_sources ps
      on ps.company_id = dj.company_id and ps.profile_id = dj.profile_id and ps.source_id = v_job.source_id
    where dj.company_id = v_job.company_id and dj.id = v_evidence.job_id and dj.status = 'succeeded'
  ) then
    raise exception 'Parent discovery job, profile or source attachment is no longer eligible for extraction' using errcode = '42501';
  end if;
  if v_source.field_schema is distinct from p_run->'source_field_schema_snapshot'
    or to_jsonb(v_source.allowed_fields) is distinct from p_run->'source_allowed_fields_snapshot' then
    raise exception 'Source extraction schema changed during processing; retry against the current reviewed schema' using errcode = '40001';
  end if;

  insert into public.discovery_extraction_runs(
    company_id, extraction_job_id, evidence_id, source_id,
    extractor_version, schema_hash, extraction_method, status,
    extracted_entity_count, fact_count, invalid_fact_count, warnings,
    source_content_hash, completed_at
  ) values (
    v_job.company_id, v_job.id, v_job.evidence_id, v_job.source_id,
    left(coalesce(p_run->>'extractor_version','deterministic-v1'),80),
    p_run->>'schema_hash',
    'deterministic',
    case
      when jsonb_array_length(p_facts) = 0 then 'no_structured_facts'
      when coalesce((p_run->>'invalid_fact_count')::integer,0) > 0 then 'completed_with_warnings'
      when jsonb_array_length(p_run->'warnings') > 0 then 'completed_with_warnings'
      else 'completed'
    end,
    jsonb_array_length(p_entities), jsonb_array_length(p_facts),
    coalesce((p_run->>'invalid_fact_count')::integer,0),
    coalesce(p_run->'warnings','[]'::jsonb),
    p_run->>'source_content_hash',
    clock_timestamp()
  ) returning id into v_run_id;

  for v_entity in select value from jsonb_array_elements(p_entities)
  loop
    v_mention_key := v_entity->>'mention_key';
    if v_mention_key is null or length(v_mention_key) = 0 or length(v_mention_key) > 160 then
      raise exception 'Invalid extracted entity mention key' using errcode = '22023';
    end if;
    insert into public.discovery_extracted_entities(
      company_id, extraction_run_id, evidence_id, mention_key, entity_kind,
      raw_name, normalized_name, source_span, confidence, extraction_method
    ) values (
      v_job.company_id, v_run_id, v_job.evidence_id, v_mention_key,
      coalesce(v_entity->>'entity_kind','organization'),
      v_entity->>'raw_name', v_entity->>'normalized_name',
      coalesce(v_entity->'source_span','{}'::jsonb),
      (v_entity->>'confidence')::numeric, 'deterministic'
    ) returning id into v_entity_id;
    v_entity_map := jsonb_set(v_entity_map, array[v_mention_key], to_jsonb(v_entity_id), true);
    v_entity_count := v_entity_count + 1;
  end loop;

  for v_fact in select value from jsonb_array_elements(p_facts)
  loop
    v_field := v_fact->>'field_name';
    v_type := v_fact->>'value_type';
    if v_field is null or not (v_field = any(v_source.allowed_fields)) then
      raise exception 'Extraction attempted a field outside the approved source field allow-list' using errcode = '42501';
    end if;
    if not (v_source.field_schema ? v_field) then
      raise exception 'Extraction attempted a field without an approved field schema' using errcode = '42501';
    end if;
    if v_source.field_schema->v_field->>'type' is distinct from v_type then
      raise exception 'Extraction value type does not match the approved field schema' using errcode = '42501';
    end if;
    v_mention_key := nullif(v_fact->>'mention_key','');
    v_entity_id := null;
    if v_mention_key is not null then
      v_entity_id := nullif(v_entity_map->>v_mention_key,'')::uuid;
      if v_entity_id is null then
        raise exception 'Extracted fact references an unknown entity mention' using errcode = '22023';
      end if;
    end if;

    v_raw_value := left(coalesce(v_fact->>'raw_value',''),20000);
    v_normalized_value := v_fact->'normalized_value';
    v_source_span := coalesce(v_fact->'source_span','{}'::jsonb);
    if v_type in ('email','phone') then
      if v_fact->>'raw_value_encryption_version' is distinct from 'aes-256-gcm-v1'
        or coalesce(v_fact->>'raw_value_ciphertext','') = ''
        or length(v_fact->>'raw_value_ciphertext') > 800
        or coalesce(v_fact->>'raw_value_nonce','') = ''
        or length(v_fact->>'raw_value_nonce') > 64
        or coalesce(v_fact->>'raw_value_auth_tag','') = ''
        or length(v_fact->>'raw_value_auth_tag') > 64
        or coalesce(v_fact->>'raw_value_fingerprint','') !~ '^[a-f0-9]{64}$'
        or position('*' in v_raw_value) = 0
        or v_source_span->>'quoteRedacted' is distinct from 'true'
        or v_source_span->>'quote' is distinct from v_raw_value
        or v_source_span ? 'quoteHash' then
        raise exception 'E05 refuses plaintext or incomplete encrypted contact facts.' using errcode = '42501';
      end if;
      v_normalized_value := null;
    else
      if v_fact ? 'raw_value_ciphertext' or v_fact ? 'raw_value_nonce'
        or v_fact ? 'raw_value_auth_tag' or v_fact ? 'raw_value_fingerprint'
        or v_fact ? 'raw_value_encryption_version' then
        raise exception 'Non-contact extraction fact contains unexpected contact-encryption fields.' using errcode = '22023';
      end if;
    end if;

    insert into public.discovery_extracted_facts(
      company_id, extraction_run_id, evidence_id, extracted_entity_id,
      field_name, value_type, raw_value, normalized_value, source_span,
      raw_value_ciphertext, raw_value_nonce, raw_value_auth_tag, raw_value_fingerprint,
      raw_value_encryption_version, confidence, validation_status, validation_message, extraction_method
    ) values (
      v_job.company_id, v_run_id, v_job.evidence_id, v_entity_id,
      v_field, v_type, v_raw_value,
      v_normalized_value, v_source_span,
      case when v_type in ('email','phone') then v_fact->>'raw_value_ciphertext' else null end,
      case when v_type in ('email','phone') then v_fact->>'raw_value_nonce' else null end,
      case when v_type in ('email','phone') then v_fact->>'raw_value_auth_tag' else null end,
      case when v_type in ('email','phone') then v_fact->>'raw_value_fingerprint' else null end,
      case when v_type in ('email','phone') then v_fact->>'raw_value_encryption_version' else null end,
      (v_fact->>'confidence')::numeric,
      coalesce(v_fact->>'validation_status','valid'),
      left(v_fact->>'validation_message',500), 'deterministic'
    );
    v_fact_count := v_fact_count + 1;
  end loop;

  update public.discovery_extraction_jobs
    set status = 'succeeded', finished_at = clock_timestamp(),
        lease_owner = null, lease_expires_at = null, heartbeat_at = null,
        updated_at = clock_timestamp()
    where id = v_job.id;

  return v_run_id;
end;
$complete$;

comment on column public.discovery_extracted_facts.raw_value_ciphertext is
  'E05 AES-256-GCM ciphertext for source-observed email/phone values. Never expose through client inbox views.';
comment on constraint discovery_extracted_facts_contact_encryption_check on public.discovery_extracted_facts is
  'NOT VALID during rollout; run the resumable E05 contact backfill, then VALIDATE CONSTRAINT after legacy rows are encrypted.';

comment on column public.discovery_extracted_facts.raw_value_fingerprint is
  'E05 keyed HMAC fingerprint used only for controlled duplicate detection; not a plain SHA hash.';

commit;
