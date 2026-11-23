import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const databaseUrl = process.env.DISCOVERY_TEST_DATABASE_URL;

test("PostgreSQL migrations, atomic claims, shared quotas and kill-switch gating", { skip: !databaseUrl }, async () => {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: databaseUrl, max: 8 });
  try {
    await pool.query(`
      create extension if not exists pgcrypto;
      do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
      do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
      do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
      create schema if not exists auth;
      create table if not exists auth.users(id uuid primary key);
      create schema if not exists storage;
      create table if not exists storage.buckets(
        id text primary key, name text not null, public boolean not null default false,
        file_size_limit bigint, allowed_mime_types text[]
      );
      create table if not exists public.companies(id uuid primary key);
      create table if not exists public.company_records(
        id uuid primary key default gen_random_uuid(),
        company_id uuid not null references public.companies(id) on delete cascade,
        record_type text not null check(record_type in ('property','contact','document_metadata','task','financial','risk','approval','whatsapp_group','audit_event','settings')),
        record_key text not null, payload jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
        deleted_at timestamptz, created_by uuid not null references auth.users(id),
        updated_by uuid not null references auth.users(id),
        unique(company_id,record_type,record_key)
      );
      create or replace function auth.uid()
      returns uuid language sql stable as $auth_uid$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
      $auth_uid$;
      create table if not exists public.company_memberships(
        company_id uuid not null references public.companies(id),
        user_id uuid not null references auth.users(id),
        role text not null,
        primary key(company_id,user_id)
      );
      create or replace function public.is_company_member(p_company_id uuid)
      returns boolean language sql stable as $member$ select true $member$;
      create or replace function public.has_company_role(target_company uuid, allowed_roles text[])
      returns boolean language sql stable as $role$ select true $role$;
    `);

    const sourceMigration = await readFile(new URL("../../supabase/migrations/20261122150000_discovery_source_governance.sql", import.meta.url), "utf8");
    const queueMigration = await readFile(new URL("../../supabase/migrations/20261122170000_discovery_durable_queue.sql", import.meta.url), "utf8");
    const fetchMigration = await readFile(new URL("../../supabase/migrations/20261122180000_discovery_fetch_evidence.sql", import.meta.url), "utf8");
    const extractionMigration = await readFile(new URL("../../supabase/migrations/20261122190000_discovery_extraction.sql", import.meta.url), "utf8");
    const entityIntelligenceMigration = await readFile(new URL("../../supabase/migrations/20261122200000_discovery_entity_intelligence.sql", import.meta.url), "utf8");
    const professionalRolesMigration = await readFile(new URL("../../supabase/migrations/20261122210000_discovery_professional_roles.sql", import.meta.url), "utf8");
    const contactValidationMigration = await readFile(new URL("../../supabase/migrations/20261122220000_discovery_contact_validation.sql", import.meta.url), "utf8");
    const geoResolutionMigration = await readFile(new URL("../../supabase/migrations/20261122230000_discovery_geo_resolution.sql", import.meta.url), "utf8");
    const enrichmentMigration = await readFile(new URL("../../supabase/migrations/20261122240000_discovery_enrichment.sql", import.meta.url), "utf8");
    await pool.query(sourceMigration);
    await pool.query(queueMigration);
    await pool.query(fetchMigration);
    await pool.query(extractionMigration);
    await pool.query(entityIntelligenceMigration);
    await pool.query(professionalRolesMigration);
    await pool.query(contactValidationMigration);
    await pool.query(geoResolutionMigration);
    await pool.query(enrichmentMigration);
    const matchingMigration = await readFile(new URL("../../supabase/migrations/20261122250000_discovery_matching.sql", import.meta.url), "utf8");
    await pool.query(matchingMigration);
    const deduplicationMigration = await readFile(new URL("../../supabase/migrations/20261122260000_discovery_deduplication.sql", import.meta.url), "utf8");
    await pool.query(deduplicationMigration);
    const deduplicationQueueMigration = await readFile(new URL("../../supabase/migrations/20261122270000_discovery_deduplication_queue.sql", import.meta.url), "utf8");
    await pool.query(deduplicationQueueMigration);
    const provenanceMigration = await readFile(new URL("../../supabase/migrations/20261122280000_discovery_provenance_ledger.sql", import.meta.url), "utf8");
    await pool.query(provenanceMigration);
    const privacyMigration = await readFile(new URL("../../supabase/migrations/20261122290000_discovery_privacy_compliance.sql", import.meta.url), "utf8");
    await pool.query(privacyMigration);
    const leadWorkspaceMigration = await readFile(new URL("../../supabase/migrations/20261122300000_discovery_lead_workspace.sql", import.meta.url), "utf8");
    await pool.query(leadWorkspaceMigration);
    const dealPartyMigration = await readFile(new URL("../../supabase/migrations/20261122310000_axivestra_deal_party_relationships.sql", import.meta.url), "utf8");
    await pool.query(dealPartyMigration);
    const relationshipGraphMigration = await readFile(new URL("../../supabase/migrations/20261122320000_axivestra_relationship_graph.sql", import.meta.url), "utf8");
    await pool.query(relationshipGraphMigration);
    const commitmentWorkspaceMigration = await readFile(new URL("../../supabase/migrations/20261122330000_axivestra_commitment_workspace.sql", import.meta.url), "utf8");
    await pool.query(commitmentWorkspaceMigration);

    const verificationConfidenceMigration = await readFile(new URL("../../supabase/migrations/20261123110000_axivestra_verification_confidence.sql", import.meta.url), "utf8");
    await pool.query(verificationConfidenceMigration);
    const orchestrationMigration = await readFile(new URL("../../supabase/migrations/20261123130000_axivestra_agent_orchestration.sql", import.meta.url), "utf8");
    await pool.query(orchestrationMigration);
    const orchestrationPreflightMigration = await readFile(new URL("../../supabase/migrations/20261123150000_axivestra_orchestration_preflight.sql", import.meta.url), "utf8");
    await pool.query(orchestrationPreflightMigration);
    const orchestrationExecutionMigration = await readFile(new URL("../../supabase/migrations/20261123170000_axivestra_orchestration_execution_contracts.sql", import.meta.url), "utf8");
    await pool.query(orchestrationExecutionMigration);

    // E20.2 is a persistence-contract migration only. Assert at this exact
    // migration boundary (before E20.3/E20.4 are applied) that it exposes no
    // worker lease broker or direct execution/dispatch RPCs.
    const e20_2WorkerRpcNames = [
      "claim_discovery_orchestration_lease",
      "heartbeat_discovery_orchestration_lease",
      "release_discovery_orchestration_lease",
      "expire_discovery_orchestration_leases",
      "claim_discovery_orchestration_execution",
      "heartbeat_discovery_orchestration_execution",
      "complete_discovery_orchestration_execution",
      "retry_discovery_orchestration_execution"
    ];
    const e20_2WorkerRpcs = await pool.query(
      "select p.proname, pg_get_function_identity_arguments(p.oid) as arguments from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any($1::text[]) order by p.proname",
      [e20_2WorkerRpcNames]
    );
    assert.deepEqual(
      e20_2WorkerRpcs.rows,
      [],
      "E20.2 must create no worker lease, execution, completion, retry or dispatch RPCs"
    );

    const orchestrationContextMigration = await readFile(new URL("../../supabase/migrations/20261123190000_axivestra_orchestration_context_binding.sql", import.meta.url), "utf8");
    await pool.query(orchestrationContextMigration);
    const orchestrationWorkerMigration = await readFile(new URL("../../supabase/migrations/20261123210000_axivestra_orchestration_worker_identity_leases.sql", import.meta.url), "utf8");
    await pool.query(orchestrationWorkerMigration);
    const orchestrationAdapterApprovalMigration = await readFile(new URL("../../supabase/migrations/20261123230000_axivestra_orchestration_adapter_approvals.sql", import.meta.url), "utf8");
    await pool.query(orchestrationAdapterApprovalMigration);

    // E20.4 adds only the three narrow broker RPCs consumed by the worker
    // Edge Function. Confirm the cumulative database has exactly those APIs,
    // all SECURITY DEFINER, with execute granted only to service_role.
    const e20_4WorkerBrokerRpcNames = [
      "claim_discovery_orchestration_lease",
      "heartbeat_discovery_orchestration_lease",
      "release_discovery_orchestration_lease"
    ];
    const e20_4WorkerBrokerRpcs = await pool.query(
      "select p.proname, pg_get_function_identity_arguments(p.oid) as arguments, p.prosecdef as security_definer from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any($1::text[]) order by p.proname",
      [e20_4WorkerBrokerRpcNames]
    );
    assert.deepEqual(
      e20_4WorkerBrokerRpcs.rows.map(row => row.proname),
      [...e20_4WorkerBrokerRpcNames].sort(),
      "E20.4 must expose exactly the explicit claim/heartbeat/release broker RPCs"
    );
    assert.ok(
      e20_4WorkerBrokerRpcs.rows.every(row => row.security_definer === true),
      "E20.4 worker broker RPCs must execute through their server-side SECURITY DEFINER boundary"
    );

    // The legacy broad execution/complete/retry names must remain absent.
    const forbiddenDirectDispatchRpcs = await pool.query(
      "select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any($1::text[]) order by p.proname",
      [[
        "claim_discovery_orchestration_execution",
        "heartbeat_discovery_orchestration_execution",
        "complete_discovery_orchestration_execution",
        "retry_discovery_orchestration_execution"
      ]]
    );
    assert.deepEqual(
      forbiddenDirectDispatchRpcs.rows,
      [],
      "E20.4 must not expose broad direct execution, completion or retry RPCs"
    );

    const companyId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const actorId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const profileId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const sourceId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const jobIds = [
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1",
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2"
    ];
    await pool.query("insert into public.companies(id) values($1)", [companyId]);
    await pool.query("insert into auth.users(id) values($1)", [actorId]);
    await pool.query(`
      insert into public.discovery_source_registry(
        id,company_id,name,canonical_url,domain,source_type,connector_key,jurisdiction,
        terms_url,license_ref,allowed_purposes,allowed_fields,field_schema,allowed_paths,access_method,
        rate_limit_per_minute,max_pages_per_job,retention_days,attribution,legal_basis,
        status,reviewed_by,reviewed_at,created_by,updated_by
      ) values (
        $1,$2,'Example registry','https://registry.example.gov.in/api','registry.example.gov.in',
        'official_api','official_api','IN','https://registry.example.gov.in/terms','Reviewed terms',
        array['company identity verification','geocoding','enrichment'],array['legal_name','registration_id','status','work_email','work_phone','address_line_1','city','state','country','country_code','latitude','longitude','annual_revenue','employee_count','land_area','industry'],
        '{"legal_name":{"type":"string","aliases":["legal_name"],"required":true,"entityKind":"organization"},"registration_id":{"type":"identifier","aliases":["registration_id"]},"status":{"type":"string","aliases":["status"]},"work_email":{"type":"email","aliases":["work_email"]},"work_phone":{"type":"phone","aliases":["work_phone"]},"address_line_1":{"type":"string","aliases":["address_line_1"]},"city":{"type":"string","aliases":["city"]},"state":{"type":"string","aliases":["state"]},"country":{"type":"string","aliases":["country"]},"country_code":{"type":"string","aliases":["country_code"]},"latitude":{"type":"number","aliases":["latitude"]},"longitude":{"type":"number","aliases":["longitude"]},"annual_revenue":{"type":"currency","aliases":["annual_revenue"],"currencyCode":"INR"},"employee_count":{"type":"number","aliases":["employee_count"]},"land_area":{"type":"number","aliases":["land_area"],"unit":"sqm"},"industry":{"type":"string","aliases":["industry"]}}'::jsonb,
        array['/api/v1/entities'],'official_api',1,10,30,'Source attribution','Approved public company registry use',
        'approved',$3,now(),$3,$3
      )
    `, [sourceId, companyId, actorId]);
    await pool.query(`
      insert into public.discovery_profiles(id,company_id,workspace_key,discovery_mode,jurisdiction,purpose,enabled,criteria,created_by,updated_by)
      values($1,$2,'startup','LENDER','IN','company identity verification',true,'{}'::jsonb,$3,$3)
    `, [profileId, companyId, actorId]);
    await pool.query(`
      insert into public.discovery_profile_sources(company_id,profile_id,source_id,created_by)
      values($1,$2,$3,$4)
    `, [companyId, profileId, sourceId, actorId]);
    await pool.query("insert into public.company_memberships(company_id,user_id,role) values($1,$2,'owner')", [companyId, actorId]);
    const grantResult = await pool.query(
      "select * from public.set_discovery_company_worker_grant($1,$2,true,$3)",
      [companyId, actorId, "integration test"]
    );
    assert.equal(grantResult.rows[0].enabled, true);
    assert.ok(Date.parse(grantResult.rows[0].expires_at) > Date.now());
    const grantAudit = await pool.query(
      "select count(*)::int as count from public.discovery_audit_events where company_id=$1 and action='discovery_worker_grant_enabled'",
      [companyId]
    );
    assert.equal(grantAudit.rows[0].count, 1, "grant and audit receipt must commit together");
    const profileSnapshot = await pool.query("select updated_at::text as updated_at from public.discovery_profiles where id=$1", [profileId]);
    const sourceSnapshot = await pool.query("select updated_at::text as updated_at from public.discovery_source_registry where id=$1", [sourceId]);
    const enqueueArgs = [
      companyId, profileId, sourceId, actorId,
      JSON.stringify({ purpose: "company identity verification", criteria: { test: true }, candidateUrls: ["https://registry.example.gov.in/api/v1/entities/rpc"] }),
      "integration-enqueue-key-0001",
      profileSnapshot.rows[0].updated_at, sourceSnapshot.rows[0].updated_at
    ];
    const enqueueResults = await Promise.all([
      pool.query("select duplicate from public.enqueue_discovery_job($1,$2,$3,$4,$5::jsonb,$6,$7,$8)", enqueueArgs),
      pool.query("select duplicate from public.enqueue_discovery_job($1,$2,$3,$4,$5::jsonb,$6,$7,$8)", enqueueArgs)
    ]);
    const duplicates = enqueueResults.flatMap(result => result.rows.map(row => row.duplicate));
    assert.equal(duplicates.filter(Boolean).length, 1, "concurrent identical enqueue attempts must resolve as one new job and one duplicate");
    const atomicAudit = await pool.query(`
      select count(*)::int as count from public.discovery_audit_events
      where action='discovery_job_queued' and entity_id=(
        select id from public.discovery_jobs where company_id=$1 and idempotency_key=$2
      )
    `, [companyId, "integration-enqueue-key-0001"]);
    assert.equal(atomicAudit.rows[0].count, 1, "an enqueue must create exactly one audit receipt in the same transaction");

    await pool.query(`
      insert into public.discovery_jobs(id,company_id,profile_id,source_id,requested_by,payload,idempotency_key)
      values
      ($1,$2,$3,$4,$5,'{"purpose":"company identity verification","candidateUrls":["https://registry.example.gov.in/api/v1/entities/1"]}'::jsonb,'integration-job-0001'),
      ($6,$2,$3,$4,$5,'{"purpose":"company identity verification","candidateUrls":["https://registry.example.gov.in/api/v1/entities/2"]}'::jsonb,'integration-job-0002')
    `, [jobIds[0],companyId,profileId,sourceId,actorId,jobIds[1]]);

    const claimResults = await Promise.all([
      pool.query("select * from public.claim_enabled_discovery_job($1,90)", ["worker-test-one"]),
      pool.query("select * from public.claim_enabled_discovery_job($1,90)", ["worker-test-two"])
    ]);
    const claimed = claimResults.flatMap(result => result.rows);
    assert.equal(claimed.length, 2, "two concurrent workers must claim two distinct queued jobs");
    assert.notEqual(claimed[0].id, claimed[1].id);

    const reservations = await Promise.all(claimed.map(job =>
      pool.query("select * from public.reserve_discovery_fetch_request($1,$2,$3,$4)", [
        companyId, sourceId, job.id, job.lease_owner
      ])
    ));
    const allowed = reservations.map(result => result.rows[0].allowed);
    assert.equal(allowed.filter(Boolean).length, 1, "one shared source quota slot permits only one concurrent request");
    assert.equal(allowed.filter(value => !value).length, 1);

    const activeJob = claimed[0];
    await pool.query(`
      insert into public.discovery_audit_events(company_id,actor_user_id,action,entity_type,entity_id,details)
      values($1,$2,'discovery_job_queued','discovery_job',$3,'{}'::jsonb)
    `, [companyId, actorId, activeJob.id]);

    const evidenceId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const evidenceJobId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3";
    await pool.query(`
      insert into public.discovery_jobs(
        id,company_id,profile_id,source_id,requested_by,status,payload,idempotency_key,started_at,finished_at
      ) values($1,$2,$3,$4,$5,'succeeded',
        '{"purpose":"company identity verification","criteria":{},"candidateUrls":["https://registry.example.gov.in/api/v1/entities/1"]}'::jsonb,
        'integration-evidence-job-0003',now(),now())
    `, [evidenceJobId,companyId,profileId,sourceId,actorId]);
    await pool.query(`
      insert into public.discovery_evidence_items(
        id,company_id,job_id,source_id,canonical_url,captured_at,content_hash,raw_blob_ref,
        content_type,byte_length,attribution,jurisdiction,licence_snapshot,response_metadata
      ) values($1,$2,$3,$4,'https://registry.example.gov.in/api/v1/entities/1',now()-interval '2 days',
        repeat('a',64),'discovery-evidence:company/job/evidence.bin',
        'application/json',12,'Example registry','IN','{"retention_days":1}'::jsonb,'{}'::jsonb)
    `, [evidenceId, companyId, evidenceJobId, sourceId]);
    const evidenceCaptureLineage=await pool.query(
      "select evidence_content_hash,source_name_snapshot,source_attribution_snapshot,evidence_retained from public.discovery_field_provenance where company_id=$1 and subject_kind='evidence' and subject_id=$2 and event_type='evidence_captured'",
      [companyId,evidenceId]
    );
    assert.equal(evidenceCaptureLineage.rows.length,1,"E13 must begin lineage at original evidence capture");
    assert.equal(evidenceCaptureLineage.rows[0].evidence_content_hash,"a".repeat(64));
    assert.ok(evidenceCaptureLineage.rows[0].source_name_snapshot);
    assert.ok(evidenceCaptureLineage.rows[0].source_attribution_snapshot);
    assert.equal(evidenceCaptureLineage.rows[0].evidence_retained,true);

    const extractionClaim = await pool.query(
      "select * from public.claim_discovery_extraction_job($1,90)",
      ["extraction-worker-test"]
    );
    assert.equal(extractionClaim.rows.length, 1, "approved source evidence linked to a succeeded job should enqueue deterministic extraction");
    const extractionJob = extractionClaim.rows[0];
    const span = { kind: "json-pointer", locator: "$/legal_name", quote: "Acme Holdings Pvt Ltd", quoteHash: "c".repeat(64) };
    const runResult = await pool.query(
      "select public.complete_discovery_extraction($1,$2,$3::jsonb,$4::jsonb,$5::jsonb) as run_id",
      [
        extractionJob.id,
        extractionJob.lease_owner,
        JSON.stringify({
          extractor_version: "deterministic-v1.0.0",
          schema_hash: "b".repeat(64),
          source_content_hash: "a".repeat(64),
          source_field_schema_snapshot: {
            legal_name: { type: "string", aliases: ["legal_name"], required: true, entityKind: "organization" },
            registration_id: { type: "identifier", aliases: ["registration_id"] },
            status: { type: "string", aliases: ["status"] },
            work_email: { type: "email", aliases: ["work_email"] },
            work_phone: { type: "phone", aliases: ["work_phone"] },
            address_line_1: { type: "string", aliases: ["address_line_1"] },
            city: { type: "string", aliases: ["city"] },
            state: { type: "string", aliases: ["state"] },
            country: { type: "string", aliases: ["country"] },
            country_code: { type: "string", aliases: ["country_code"] },
            latitude: { type: "number", aliases: ["latitude"] },
            longitude: { type: "number", aliases: ["longitude"] },
            annual_revenue: { type: "currency", aliases: ["annual_revenue"], currencyCode: "INR" },
            employee_count: { type: "number", aliases: ["employee_count"] },
            land_area: { type: "number", aliases: ["land_area"], unit: "sqm" },
            industry: { type: "string", aliases: ["industry"] }
          },
          source_allowed_fields_snapshot: ["legal_name","registration_id","status","work_email","work_phone","address_line_1","city","state","country","country_code","latitude","longitude","annual_revenue","employee_count","land_area","industry"],
          invalid_fact_count: 0,
          warnings: []
        }),
        JSON.stringify([{
          mention_key: "organization:acme-1", entity_kind: "organization",
          raw_name: "Acme Holdings Pvt Ltd", normalized_name: "Acme Holdings Pvt Ltd",
          source_span: span, confidence: 0.99
        }]),
        JSON.stringify([
          {
            mention_key: "organization:acme-1", field_name: "legal_name",
            value_type: "string", raw_value: "Acme Holdings Pvt Ltd",
            normalized_value: "Acme Holdings Pvt Ltd", source_span: span,
            confidence: 0.99, validation_status: "valid"
          },
          {
            mention_key: "organization:acme-1", field_name: "registration_id",
            value_type: "identifier", raw_value: "REG-AXI-0001",
            normalized_value: "REG-AXI-0001",
            source_span: { kind: "json-pointer", locator: "$/registration_id" },
            confidence: 0.99, validation_status: "valid"
          },
          {
            mention_key: "organization:acme-1", field_name: "work_email",
            value_type: "email", raw_value: "team@acme.example",
            normalized_value: "team@acme.example",
            source_span: { kind: "json-pointer", locator: "$/contact/email" },
            confidence: 0.97, validation_status: "valid"
          },
          {
            mention_key: "organization:acme-1", field_name: "work_phone",
            value_type: "phone", raw_value: "+91 98765 43210",
            normalized_value: "+919876543210",
            source_span: { kind: "json-pointer", locator: "$/contact/phone" },
            confidence: 0.96, validation_status: "valid"
          },
          {
            mention_key: "organization:acme-1", field_name: "address_line_1",
            value_type: "string", raw_value: "12 Industrial Road",
            normalized_value: "12 Industrial Road",
            source_span: { kind: "json-pointer", locator: "$/address" },
            confidence: 0.96, validation_status: "valid"
          },
          {
            mention_key: "organization:acme-1", field_name: "city",
            value_type: "string", raw_value: "Bengaluru",
            normalized_value: "Bengaluru",
            source_span: { kind: "json-pointer", locator: "$/city" },
            confidence: 0.98, validation_status: "valid"
          },
          {
            mention_key: "organization:acme-1", field_name: "state",
            value_type: "string", raw_value: "Karnataka",
            normalized_value: "Karnataka",
            source_span: { kind: "json-pointer", locator: "$/state" },
            confidence: 0.98, validation_status: "valid"
          },
          {
            mention_key: "organization:acme-1", field_name: "country",
            value_type: "string", raw_value: "India",
            normalized_value: "India",
            source_span: { kind: "json-pointer", locator: "$/country" },
            confidence: 0.97, validation_status: "valid"
          },
          {
            mention_key: "organization:acme-1", field_name: "country_code",
            value_type: "string", raw_value: "IN",
            normalized_value: "IN",
            source_span: { kind: "json-pointer", locator: "$/country_code" },
            confidence: 0.97, validation_status: "valid"
          },
          {
            mention_key: "organization:acme-1", field_name: "latitude",
            value_type: "number", raw_value: "12.9716",
            normalized_value: 12.9716,
            source_span: { kind: "json-pointer", locator: "$/latitude" },
            confidence: 0.96, validation_status: "valid"
          },
          {
            mention_key: "organization:acme-1", field_name: "longitude",
            value_type: "number", raw_value: "77.5946",
            normalized_value: 77.5946,
            source_span: { kind: "json-pointer", locator: "$/longitude" },
            confidence: 0.96, validation_status: "valid"
          },
          {
            mention_key: "organization:acme-1", field_name: "annual_revenue",
            value_type: "currency", raw_value: "₹12 crore",
            normalized_value: {amount:120000000,currency:"INR"},
            source_span: { kind: "json-pointer", locator: "$/annual_revenue" },
            confidence: 0.97, validation_status: "valid"
          },
          {
            mention_key: "organization:acme-1", field_name: "employee_count",
            value_type: "number", raw_value: "420", normalized_value: 420,
            source_span: { kind: "json-pointer", locator: "$/employee_count" },
            confidence: 0.93, validation_status: "valid"
          },
          {
            mention_key: "organization:acme-1", field_name: "land_area",
            value_type: "number", raw_value: "12500", normalized_value: 12500,
            source_span: { kind: "json-pointer", locator: "$/land_area" },
            confidence: 0.91, validation_status: "valid"
          },
          {
            mention_key: "organization:acme-1", field_name: "industry",
            value_type: "string", raw_value: "Precision Engineering",
            normalized_value: "Precision Engineering",
            source_span: { kind: "json-pointer", locator: "$/industry" },
            confidence: 0.96, validation_status: "valid"
          }
        ])
      ]
    );
    const extractionRunId = runResult.rows[0].run_id;
    assert.ok(extractionRunId);
    const extractedFact = await pool.query(
      "select id,field_name,normalized_value,source_span,confidence from public.discovery_extracted_facts where extraction_run_id=$1",
      [extractionRunId]
    );
    assert.equal(extractedFact.rows.length, 15);
    assert.equal(extractedFact.rows[0].normalized_value, "Acme Holdings Pvt Ltd");
    assert.equal(extractedFact.rows[0].source_span.locator, "$/legal_name");

    const reviewResult = await pool.query(
      "select * from public.record_discovery_extraction_review($1,$2,$3,$4,null,$5,$6,null)",
      [companyId,actorId,extractionRunId,extractedFact.rows[0].id,"accepted","Reviewed original evidence span in PostgreSQL integration test"]
    );
    const reviewId = reviewResult.rows[0].id;
    assert.ok(reviewId);
    assert.equal(reviewResult.rows[0].decision,"accepted");
    const reviewAudit = await pool.query(
      "select count(*)::int as count from public.discovery_audit_events where company_id=$1 and action='extraction_review_recorded' and entity_id=$2",
      [companyId,reviewId]
    );
    assert.equal(reviewAudit.rows[0].count,1,"review receipt and audit record must commit atomically");

    const viewerId = "12121212-1212-4121-8121-121212121212";
    await pool.query("insert into auth.users(id) values($1)",[viewerId]);
    await pool.query("insert into public.company_memberships(company_id,user_id,role) values($1,$2,'viewer')",[companyId,viewerId]);

    // E20: plan-only orchestration preserves dependencies and requires owner/admin approval.
    const orchestrationClient=await pool.connect();
    try{
      await orchestrationClient.query("select set_config('request.jwt.claim.sub',$1,false)",[viewerId]);
      const planKey="e20-integration-company-identity-01";
      const requestedPlan=await orchestrationClient.query(
        "select public.request_discovery_orchestration_run($1,'company_identity',$2) as id",
        [companyId,planKey]
      );
      const orchestrationRunId=requestedPlan.rows[0].id;
      const duplicatePlan=await orchestrationClient.query(
        "select public.request_discovery_orchestration_run($1,'company_identity',$2) as id",
        [companyId,planKey]
      );
      assert.equal(duplicatePlan.rows[0].id,orchestrationRunId,"E20 idempotent requests must return the original plan");
      const pendingPlan=await orchestrationClient.query(
        "select status,dispatch_state,stage_count,unavailable_adapter_count,disabled_stage_count from public.discovery_orchestration_run_inbox where company_id=$1 and id=$2",
        [companyId,orchestrationRunId]
      );
      assert.equal(pendingPlan.rows[0].status,"awaiting_approval");
      assert.equal(pendingPlan.rows[0].dispatch_state,"not_configured");
      assert.equal(pendingPlan.rows[0].stage_count,3);
      assert.equal(pendingPlan.rows[0].unavailable_adapter_count,3);
      assert.equal(pendingPlan.rows[0].disabled_stage_count,3);
      const plannedSteps=await orchestrationClient.query(
        "select stage_key,step_order,depends_on_step_ids,status,dispatch_state from public.discovery_orchestration_steps where company_id=$1 and run_id=$2 order by step_order",
        [companyId,orchestrationRunId]
      );
      assert.deepEqual(plannedSteps.rows.map(row=>row.stage_key),["e04_source_capture","e05_extraction","e06_entity_resolution"]);
      assert.equal(plannedSteps.rows[0].depends_on_step_ids.length,0);
      assert.equal(plannedSteps.rows[1].depends_on_step_ids.length,1);
      assert.equal(plannedSteps.rows[2].depends_on_step_ids.length,1);
      assert.ok(plannedSteps.rows.every(row=>row.status==="planned"&&row.dispatch_state==="adapter_not_registered"));
      const dependencyPreview=await orchestrationClient.query(
        "select stage_key,dependency_count,unsatisfied_dependency_count,dependency_state,schedule_preview_state,dispatch_permitted from public.discovery_orchestration_dependency_schedule where company_id=$1 and run_id=$2 order by step_order",
        [companyId,orchestrationRunId]
      );
      assert.deepEqual(dependencyPreview.rows.map(row=>row.dependency_state),["dependencies_satisfied","waiting_for_dependencies","waiting_for_dependencies"]);
      assert.ok(dependencyPreview.rows.every(row=>row.schedule_preview_state==="run_approval_required"&&row.dispatch_permitted===false),"E20.5 dependency preview must stay read-only and non-dispatchable");
      const stageControls=await orchestrationClient.query(
        "select bool_and(enabled) as any_enabled,count(*)::int as count from public.discovery_orchestration_company_stage_controls where company_id=$1 and stage_key=any(array['e04_source_capture','e05_extraction','e06_entity_resolution'])",
        [companyId]
      );
      assert.equal(stageControls.rows[0].count,3);
      assert.equal(stageControls.rows[0].any_enabled,false,"E20 per-stage kill switches must start disabled");
      const initialPreflight=await orchestrationClient.query(
        "select stage_key,blocker_codes,unsatisfied_dependency_count,dispatch_permitted,company_worker_grant_active from public.discovery_orchestration_step_preflight where company_id=$1 and run_id=$2 order by step_order",
        [companyId,orchestrationRunId]
      );
      assert.equal(initialPreflight.rows.length,3);
      assert.ok(initialPreflight.rows.every(row=>row.dispatch_permitted===false),"E20.1 preflight must never dispatch");
      assert.ok(initialPreflight.rows.every(row=>row.blocker_codes.includes("run_not_approved")));
      assert.ok(initialPreflight.rows.every(row=>row.blocker_codes.includes("stage_kill_switch_off")));
      assert.ok(initialPreflight.rows.every(row=>row.blocker_codes.includes("adapter_not_registered")));
      assert.ok(initialPreflight.rows.every(row=>row.blocker_codes.includes("worker_identity_scope_missing")));
      assert.ok(initialPreflight.rows.every(row=>row.company_worker_grant_active===true));
      assert.ok(initialPreflight.rows.every(row=>row.blocker_codes.includes("run_context_missing")));
      const bindContextSql="select public.bind_discovery_orchestration_run_context($1,$2,$3,$4,$5,$6::text[],$7) as id";
      const contextArgs=[companyId,orchestrationRunId,profileId,sourceId,"company identity verification",["legal_name","registration_id"],"Owner bound the approved company identity source and exact field scope for this test run."];
      await assert.rejects(
        orchestrationClient.query(bindContextSql,contextArgs),
        new RegExp("Only company owners/admins can bind orchestration execution context")
      );
      await orchestrationClient.query("select set_config('request.jwt.claim.sub',$1,false)",[actorId]);
      await assert.rejects(
        orchestrationClient.query(bindContextSql,[companyId,orchestrationRunId,profileId,sourceId,"company identity verification",["unapproved_private_field"],"Owner attempted a field outside the registered source allow-list."]),
        /outside the source field allow-list/
      );
      const contextEvent=await orchestrationClient.query(bindContextSql,contextArgs);
      assert.ok(contextEvent.rows[0].id);
      await orchestrationClient.query("select set_config('request.jwt.claim.sub',$1,false)",[viewerId]);
      const boundContext=await orchestrationClient.query(
        "select execution_context_bound,profile_enabled,source_status,context_snapshot_current,purpose_still_allowed,fields_still_allowed from public.discovery_orchestration_step_preflight where company_id=$1 and run_id=$2",
        [companyId,orchestrationRunId]
      );
      assert.equal(boundContext.rows.length,3);
      assert.ok(boundContext.rows.every(row=>row.execution_context_bound===true));
      assert.ok(boundContext.rows.every(row=>row.profile_enabled===true));
      assert.ok(boundContext.rows.every(row=>row.source_status==="approved"));
      assert.ok(boundContext.rows.every(row=>row.context_snapshot_current===true));
      assert.ok(boundContext.rows.every(row=>row.purpose_still_allowed===true));
      assert.ok(boundContext.rows.every(row=>row.fields_still_allowed===true));
      const contextHistory=await orchestrationClient.query(
        "select count(*)::int as count,event_type from public.discovery_orchestration_context_events where company_id=$1 and run_id=$2 group by event_type",
        [companyId,orchestrationRunId]
      );
      assert.equal(contextHistory.rows[0].count,1);
      assert.equal(contextHistory.rows[0].event_type,"run_context_bound");
      await assert.rejects(
        pool.query("update public.discovery_orchestration_context_events set reason='changed history' where id=$1",[contextEvent.rows[0].id]),
        /append-only/
      );
      const executionCatalogue=await orchestrationClient.query(
        "select count(*)::int as adapters from public.discovery_orchestration_adapter_contracts"
      );
      assert.equal(executionCatalogue.rows[0].adapters,0,"E20.2 must not silently register runnable adapters");
      const executionGrants=await orchestrationClient.query(
        "select has_table_privilege('authenticated','public.discovery_orchestration_executions','insert') as can_insert_execution, has_table_privilege('authenticated','public.discovery_orchestration_execution_leases','insert') as can_insert_lease, has_table_privilege('authenticated','public.discovery_orchestration_execution_events','insert') as can_insert_event"
      );
      assert.equal(executionGrants.rows[0].can_insert_execution,false);
      assert.equal(executionGrants.rows[0].can_insert_lease,false);
      assert.equal(executionGrants.rows[0].can_insert_event,false);
      // E20.2 and E20.4 migration-boundary and RPC allow-list assertions
      // run immediately after their respective migrations above. Keep this
      // orchestration flow check focused on the hard-off dispatch invariant.
      const cumulativePreflight=await orchestrationClient.query(
        "select bool_and(dispatch_permitted=false) as dispatch_stays_off from public.discovery_orchestration_step_preflight where company_id=$1 and run_id=$2",
        [companyId,orchestrationRunId]
      );
      assert.equal(cumulativePreflight.rows[0].dispatch_stays_off,true,"E20.4 does not enable dispatch");

      assert.equal(initialPreflight.rows[0].unsatisfied_dependency_count,0);
      assert.equal(initialPreflight.rows[1].unsatisfied_dependency_count,1);
      assert.equal(initialPreflight.rows[2].unsatisfied_dependency_count,1);

      await assert.rejects(
        orchestrationClient.query(
          "select public.record_discovery_orchestration_decision($1,$2,'approve','Viewer cannot approve an orchestration plan.')",
          [companyId,orchestrationRunId]
        ),
        /Only company owners\/admin/
      );
      await orchestrationClient.query("select set_config('request.jwt.claim.sub',$1,false)",[actorId]);
      const approvedEvent=await orchestrationClient.query(
        "select public.record_discovery_orchestration_decision($1,$2,'approve','Approved for adapter-readiness review only; execution remains disabled.') as id",
        [companyId,orchestrationRunId]
      );
      assert.ok(approvedEvent.rows[0].id);
      const approvedPlan=await orchestrationClient.query(
        "select status,dispatch_state from public.discovery_orchestration_runs where company_id=$1 and id=$2",
        [companyId,orchestrationRunId]
      );
      assert.equal(approvedPlan.rows[0].status,"approved_not_dispatched");
      assert.equal(approvedPlan.rows[0].dispatch_state,"not_configured");
      const orchestrationHistory=await orchestrationClient.query(
        "select count(*)::int as count from public.discovery_orchestration_events where company_id=$1 and run_id=$2",
        [companyId,orchestrationRunId]
      );
      assert.equal(orchestrationHistory.rows[0].count,2,"E20 writes immutable request and approval receipts");
      await assert.rejects(
        orchestrationClient.query("update public.discovery_orchestration_events set reason='rewritten' where run_id=$1",[orchestrationRunId]),
        /append-only/
      );

      // E20.4: scoped worker identity, service-role lease API, global-grant revocation.
      await orchestrationClient.query("select set_config('request.jwt.claim.sub',$1,false)",[viewerId]);
      await assert.rejects(
        orchestrationClient.query(
          "select * from public.grant_discovery_orchestration_worker_identity($1,'e20-test-worker','E20 test worker',$2,array['e05_extraction'],1,60,clock_timestamp()+interval '20 minutes','Viewer is not allowed to grant a worker identity.')",
          [companyId,"a".repeat(64)]
        ),
        /Only company owners\/admins can grant orchestration worker identity/
      );
      await orchestrationClient.query("select set_config('request.jwt.claim.sub',$1,false)",[actorId]);
      const workerCredentialHash="f".repeat(64);
      const workerGrant=await orchestrationClient.query(
        "select * from public.grant_discovery_orchestration_worker_identity($1,'e20-test-worker','E20 test worker',$2,array['e05_extraction'],1,60,clock_timestamp()+interval '20 minutes','Temporary E20.4 integration worker restricted to extraction stage.')",
        [companyId,workerCredentialHash]
      );
      assert.equal(workerGrant.rows.length,1);
      const workerIdentityId=workerGrant.rows[0].worker_identity_id;
      assert.equal(workerGrant.rows[0].status,"active");
      assert.deepEqual(workerGrant.rows[0].stage_keys,["e05_extraction"]);
      assert.ok(Date.parse(workerGrant.rows[0].expires_at)>Date.now());
      await assert.rejects(
        orchestrationClient.query(
          "select * from public.grant_discovery_orchestration_worker_identity($1,'e20-test-worker','E20 test worker',$2,array['e05_extraction'],1,60,clock_timestamp()+interval '20 minutes','Attempt to re-use the prior worker credential must be rejected.')",
          [companyId,workerCredentialHash]
        ),
        /A new random worker credential is required/
      );
      const safeWorkerDirectory=await orchestrationClient.query(
        "select * from public.discovery_orchestration_worker_directory where company_id=$1 and id=$2",
        [companyId,workerIdentityId]
      );
      assert.equal(safeWorkerDirectory.rows.length,1);
      assert.equal(Object.hasOwn(safeWorkerDirectory.rows[0],"credential_hash"),false);
      const workerGrantExpiry=await pool.query(
        "select c.expires_at as company_expiry,w.expires_at as worker_expiry,w.stage_keys,w.max_active_leases,w.lease_seconds from public.discovery_company_worker_controls c join public.discovery_orchestration_worker_identities w on w.company_id=c.company_id where c.company_id=$1 and w.id=$2",
        [companyId,workerIdentityId]
      );
      assert.ok(Date.parse(workerGrantExpiry.rows[0].worker_expiry)<=Date.parse(workerGrantExpiry.rows[0].company_expiry));
      assert.equal(workerGrantExpiry.rows[0].max_active_leases,1);
      assert.equal(workerGrantExpiry.rows[0].lease_seconds,60);

      const memberReadClient=await pool.connect();
      try {
        await memberReadClient.query("set role authenticated");
        await memberReadClient.query("select set_config('request.jwt.claim.sub',$1,false)",[viewerId]);
        const viewerPreflight=await memberReadClient.query(
          "select stage_key,company_worker_grant_active,worker_identity_scope_available,dispatch_permitted from public.discovery_orchestration_step_preflight where company_id=$1 and run_id=$2 order by step_order",
          [companyId,orchestrationRunId]
        );
        assert.equal(viewerPreflight.rows.length,3,"a regular company member can read the safe orchestration preflight");
        assert.equal(viewerPreflight.rows[1].stage_key,"e05_extraction");
        assert.equal(viewerPreflight.rows[1].company_worker_grant_active,true);
        assert.equal(viewerPreflight.rows[1].worker_identity_scope_available,true);
        assert.equal(viewerPreflight.rows[1].dispatch_permitted,false);
        const viewerWorkerDirectory=await memberReadClient.query(
          "select id from public.discovery_orchestration_worker_directory where company_id=$1",
          [companyId]
        );
        assert.equal(viewerWorkerDirectory.rows.length,0,"worker identity names are owner/admin only");
      } finally {
        await memberReadClient.query("reset role");
        memberReadClient.release();
      }

      const tokenPrivileges=await pool.query(
        "select has_table_privilege('authenticated','public.discovery_orchestration_execution_leases','select') as raw_lease_select,has_table_privilege('authenticated','public.discovery_orchestration_execution_lease_inbox','select') as safe_lease_select,has_table_privilege('authenticated','public.discovery_orchestration_worker_identities','select') as worker_table_select,has_table_privilege('authenticated','public.discovery_orchestration_worker_directory','select') as safe_worker_directory_select"
      );
      assert.equal(tokenPrivileges.rows[0].raw_lease_select,false,"raw lease-token hashes must not be exposed to authenticated members");
      assert.equal(tokenPrivileges.rows[0].safe_lease_select,true,"company members can read the safe lease inspector");
      assert.equal(tokenPrivileges.rows[0].worker_table_select,false,"credential-bearing worker identity rows are never directly readable by authenticated users");
      assert.equal(tokenPrivileges.rows[0].safe_worker_directory_select,true,"owners/admins use the safe worker directory view");
      const workerRpcPrivileges=await pool.query(
        "select " +
        "has_function_privilege('authenticated','public.grant_discovery_orchestration_worker_identity(uuid,text,text,text,text[],integer,integer,timestamptz,text)','execute') as can_grant, " +
        "has_function_privilege('anon','public.claim_discovery_orchestration_lease(uuid,uuid,text,text,integer)','execute') as anon_can_claim, " +
        "has_function_privilege('authenticated','public.claim_discovery_orchestration_lease(uuid,uuid,text,text,integer)','execute') as authenticated_can_claim, " +
        "has_function_privilege('service_role','public.claim_discovery_orchestration_lease(uuid,uuid,text,text,integer)','execute') as service_can_claim, " +
        "has_function_privilege('anon','public.heartbeat_discovery_orchestration_lease(uuid,uuid,uuid,text,text,integer)','execute') as anon_can_heartbeat, " +
        "has_function_privilege('authenticated','public.heartbeat_discovery_orchestration_lease(uuid,uuid,uuid,text,text,integer)','execute') as authenticated_can_heartbeat, " +
        "has_function_privilege('service_role','public.heartbeat_discovery_orchestration_lease(uuid,uuid,uuid,text,text,integer)','execute') as service_can_heartbeat, " +
        "has_function_privilege('anon','public.release_discovery_orchestration_lease(uuid,uuid,uuid,text,text,text)','execute') as anon_can_release, " +
        "has_function_privilege('authenticated','public.release_discovery_orchestration_lease(uuid,uuid,uuid,text,text,text)','execute') as authenticated_can_release, " +
        "has_function_privilege('service_role','public.release_discovery_orchestration_lease(uuid,uuid,uuid,text,text,text)','execute') as service_can_release"
      );
      assert.equal(workerRpcPrivileges.rows[0].can_grant,true,"authenticated control path is guarded by owner/admin checks");
      for (const field of ["anon_can_claim","authenticated_can_claim","anon_can_heartbeat","authenticated_can_heartbeat","anon_can_release","authenticated_can_release"]) {
        assert.equal(workerRpcPrivileges.rows[0][field],false,field+" must not be executable by anon/authenticated");
      }
      for (const field of ["service_can_claim","service_can_heartbeat","service_can_release"]) {
        assert.equal(workerRpcPrivileges.rows[0][field],true,field+" must be executable by the server-side service role");
      }

      const preflightAfterGrant=await orchestrationClient.query(
        "select stage_key,worker_identity_scope_available,company_worker_grant_active,dispatch_permitted,blocker_codes from public.discovery_orchestration_step_preflight where company_id=$1 and run_id=$2 order by step_order",
        [companyId,orchestrationRunId]
      );
      assert.equal(preflightAfterGrant.rows[0].stage_key,"e04_source_capture");
      assert.equal(preflightAfterGrant.rows[0].worker_identity_scope_available,false);
      assert.equal(preflightAfterGrant.rows[1].stage_key,"e05_extraction");
      assert.equal(preflightAfterGrant.rows[1].worker_identity_scope_available,true);
      assert.equal(preflightAfterGrant.rows[1].company_worker_grant_active,true);
      assert.equal(preflightAfterGrant.rows[1].dispatch_permitted,false,"worker scope never overrides the hard dispatch gate");
      assert.ok(preflightAfterGrant.rows[1].blocker_codes.includes("no_dispatcher_registered"));

      // Create a ready test execution behind the still-false dispatch gate.
      await pool.query(
        "update public.discovery_orchestration_stage_registry set adapter_key='e05-test-adapter',dispatch_ready=true where stage_key='e05_extraction'"
      );
      await pool.query(
        "insert into public.discovery_orchestration_adapter_contracts(adapter_key,stage_key,contract_version,required_permission_class,required_policy_checks,max_attempts,lease_seconds,max_parallel_per_company,enabled,reviewed_by,reviewed_at,review_reason) values('e05-test-adapter','e05_extraction','test-v1','source_restricted',array['company_worker_grant','source_purpose','personal_data_policy'],2,60,1,true,$1,now(),'Reviewed only as an isolated PostgreSQL contract fixture; no production adapter exists.')",
        [actorId]
      );
      await orchestrationClient.query("select set_config('request.jwt.claim.sub',$1,false)",[viewerId]);
      await assert.rejects(
        orchestrationClient.query(
          "select public.review_discovery_orchestration_company_adapter($1,'e05-test-adapter','test-v1','approved','Viewer must not approve company adapter contracts.')",
          [companyId]
        ),
        /Only company owners\/admins can review a company adapter contract/
      );
      await orchestrationClient.query("select set_config('request.jwt.claim.sub',$1,false)",[actorId]);
      const adapterApprovalEvent=await orchestrationClient.query(
        "select public.review_discovery_orchestration_company_adapter($1,'e05-test-adapter','test-v1','approved','Owner approved exact test adapter version for this company only.') as id",
        [companyId]
      );
      assert.ok(adapterApprovalEvent.rows[0].id);
      const adapterApproval=await orchestrationClient.query(
        "select adapter_key,contract_version,status from public.discovery_orchestration_company_adapter_approvals where company_id=$1 and adapter_key='e05-test-adapter'",
        [companyId]
      );
      assert.deepEqual(adapterApproval.rows,[{adapter_key:"e05-test-adapter",contract_version:"test-v1",status:"approved"}]);
      const adapterApprovalHistory=await orchestrationClient.query(
        "select event_type,new_status from public.discovery_orchestration_company_adapter_events where company_id=$1 and adapter_key='e05-test-adapter'",
        [companyId]
      );
      assert.deepEqual(adapterApprovalHistory.rows,[{event_type:"approved",new_status:"approved"}]);
      await assert.rejects(
        pool.query("update public.discovery_orchestration_company_adapter_events set reason='tampered' where id=$1",[adapterApprovalEvent.rows[0].id]),
        /append-only/
      );
      await pool.query(
        "update public.discovery_orchestration_company_stage_controls set enabled=true,changed_by=$2,changed_at=now(),reason='Isolated E20.5 test fixture only; dispatch remains blocked.' where company_id=$1 and stage_key='e05_extraction'",
        [companyId,actorId]
      );
      const e05StepId=await pool.query(
        "select id from public.discovery_orchestration_steps where company_id=$1 and run_id=$2 and stage_key='e05_extraction'",
        [companyId,orchestrationRunId]
      );
      const execution=await pool.query(
        "insert into public.discovery_orchestration_executions(company_id,run_id,step_id,adapter_key,state,max_attempts) values($1,$2,$3,'e05-test-adapter','ready',2) returning id",
        [companyId,orchestrationRunId,e05StepId.rows[0].id]
      );
      const executionId=execution.rows[0].id;
      const finalPreflight=await pool.query(
        "select dispatch_permitted,blocker_codes,adapter_contract_platform_approved,company_adapter_approved from public.discovery_orchestration_step_preflight where company_id=$1 and run_id=$2 and stage_key='e05_extraction'",
        [companyId,orchestrationRunId]
      );
      assert.equal(finalPreflight.rows[0].dispatch_permitted,false);
      assert.equal(finalPreflight.rows[0].adapter_contract_platform_approved,true);
      assert.equal(finalPreflight.rows[0].company_adapter_approved,true);
      assert.ok(!finalPreflight.rows[0].blocker_codes.includes("company_adapter_not_approved"));
      assert.ok(finalPreflight.rows[0].blocker_codes.includes("run_dispatch_not_configured"));
      assert.ok(finalPreflight.rows[0].blocker_codes.includes("personal_data_policy_not_checked"));

      const workerServiceClient=await pool.connect();
      try {
        await workerServiceClient.query("set role service_role");
        const blockedClaim=await workerServiceClient.query(
          "select * from public.claim_discovery_orchestration_lease($1,$2,$3,$4,60)",
          [companyId,workerIdentityId,workerCredentialHash,"b".repeat(64)]
        );
        assert.equal(blockedClaim.rows.length,0,"scoped worker cannot claim while preflight dispatch_permitted is false");
        const unchangedExecution=await workerServiceClient.query(
          "select state,attempt_count from public.discovery_orchestration_executions where company_id=$1 and id=$2",
          [companyId,executionId]
        );
        assert.equal(unchangedExecution.rows[0].state,"ready");
        assert.equal(unchangedExecution.rows[0].attempt_count,0);

        // Exercise heartbeat and explicit release against a synthetic lease receipt.
        const leaseOne=await pool.query(
          "insert into public.discovery_orchestration_execution_leases(company_id,execution_id,worker_identity_id,lease_token_hash,worker_identity,leased_at,expires_at,heartbeat_at) values($1,$2,$3,$4,'e20-test-worker',clock_timestamp(),clock_timestamp()+interval '120 seconds',clock_timestamp()) returning id",
          [companyId,executionId,workerIdentityId,"c".repeat(64)]
        );
        const memberLeaseClient=await pool.connect();
        try {
          await memberLeaseClient.query("set role authenticated");
          await memberLeaseClient.query("select set_config('request.jwt.claim.sub',$1,false)",[viewerId]);
          const safeLease=await memberLeaseClient.query(
            "select * from public.discovery_orchestration_execution_lease_inbox where company_id=$1 and id=$2",
            [companyId,leaseOne.rows[0].id]
          );
          assert.equal(safeLease.rows.length,1);
          assert.equal(Object.hasOwn(safeLease.rows[0],"lease_token_hash"),false);
          await assert.rejects(
            memberLeaseClient.query("select lease_token_hash from public.discovery_orchestration_execution_leases where company_id=$1 and id=$2",[companyId,leaseOne.rows[0].id]),
            /permission denied/
          );
        } finally {
          await memberLeaseClient.query("reset role");
          memberLeaseClient.release();
        }
        await pool.query(
          "update public.discovery_orchestration_executions set state='leased' where company_id=$1 and id=$2",
          [companyId,executionId]
        );
        const beforeBlockedHeartbeat=await pool.query(
          "select expires_at,heartbeat_at from public.discovery_orchestration_execution_leases where company_id=$1 and id=$2",
          [companyId,leaseOne.rows[0].id]
        );
        const heartbeatLease=await workerServiceClient.query(
          "select public.heartbeat_discovery_orchestration_lease($1,$2,$3,$4,$5,45) as ok",
          [companyId,leaseOne.rows[0].id,workerIdentityId,workerCredentialHash,"c".repeat(64)]
        );
        assert.equal(heartbeatLease.rows[0].ok,false,"E20.4 heartbeat must fail closed while E20 preflight dispatch_permitted remains false");
        const afterBlockedHeartbeat=await pool.query(
          "select expires_at,heartbeat_at from public.discovery_orchestration_execution_leases where company_id=$1 and id=$2",
          [companyId,leaseOne.rows[0].id]
        );
        assert.equal(afterBlockedHeartbeat.rows[0].expires_at.toISOString(),beforeBlockedHeartbeat.rows[0].expires_at.toISOString(),"blocked heartbeat must not extend the lease");
        assert.equal(afterBlockedHeartbeat.rows[0].heartbeat_at.toISOString(),beforeBlockedHeartbeat.rows[0].heartbeat_at.toISOString(),"blocked heartbeat must not advance its timestamp");
        const releaseLease=await workerServiceClient.query(
          "select public.release_discovery_orchestration_lease($1,$2,$3,$4,$5,$6) as ok",
          [companyId,leaseOne.rows[0].id,workerIdentityId,workerCredentialHash,"c".repeat(64),"Worker completed an isolated heartbeat and lease-release lifecycle test."]
        );
        assert.equal(releaseLease.rows[0].ok,true);
        const releasedState=await workerServiceClient.query(
          "select e.state,l.released_at from public.discovery_orchestration_executions e join public.discovery_orchestration_execution_leases l on l.company_id=e.company_id and l.execution_id=e.id where e.company_id=$1 and e.id=$2 and l.id=$3",
          [companyId,executionId,leaseOne.rows[0].id]
        );
        assert.equal(releasedState.rows[0].state,"ready");
        assert.ok(releasedState.rows[0].released_at);

        // Expired leases return to ready without consuming an attempt; retry classification is E20.6.
        const expiredLease=await pool.query(
          "insert into public.discovery_orchestration_execution_leases(company_id,execution_id,worker_identity_id,lease_token_hash,worker_identity,leased_at,expires_at,heartbeat_at) values($1,$2,$3,$4,'e20-test-worker',clock_timestamp()-interval '90 seconds',clock_timestamp()-interval '30 seconds',clock_timestamp()-interval '30 seconds') returning id",
          [companyId,executionId,workerIdentityId,"f".repeat(64)]
        );
        await pool.query(
          "update public.discovery_orchestration_executions set state='leased' where company_id=$1 and id=$2",
          [companyId,executionId]
        );
        const expiredCount=await workerServiceClient.query(
          "select public.expire_discovery_orchestration_leases($1,10) as count",
          [companyId]
        );
        assert.equal(expiredCount.rows[0].count,1);
        const expiredState=await workerServiceClient.query(
          "select e.state,e.attempt_count,l.released_at from public.discovery_orchestration_executions e join public.discovery_orchestration_execution_leases l on l.company_id=e.company_id and l.execution_id=e.id where e.company_id=$1 and e.id=$2 and l.id=$3",
          [companyId,executionId,expiredLease.rows[0].id]
        );
        assert.equal(expiredState.rows[0].state,"ready");
        assert.equal(expiredState.rows[0].attempt_count,0);
        assert.ok(expiredState.rows[0].released_at);
        await assert.rejects(
          pool.query("update public.discovery_orchestration_execution_events set reason='tampered' where execution_id=$1",[executionId]),
          /append-only/
        );

        // Pausing a scoped worker immediately releases its active lease.
        const leaseTwo=await pool.query(
          "insert into public.discovery_orchestration_execution_leases(company_id,execution_id,worker_identity_id,lease_token_hash,worker_identity,leased_at,expires_at,heartbeat_at) values($1,$2,$3,$4,'e20-test-worker',clock_timestamp(),clock_timestamp()+interval '120 seconds',clock_timestamp()) returning id",
          [companyId,executionId,workerIdentityId,"d".repeat(64)]
        );
        await pool.query(
          "update public.discovery_orchestration_executions set state='leased' where company_id=$1 and id=$2",
          [companyId,executionId]
        );
        const pausedWorker=await orchestrationClient.query(
          "select * from public.set_discovery_orchestration_worker_identity_status($1,$2,'paused',$3)",
          [companyId,workerIdentityId,"Owner paused the scoped worker to release its active test lease immediately."]
        );
        assert.equal(pausedWorker.rows[0].status,"paused");
        assert.equal(pausedWorker.rows[0].released_leases,1);
        const pausedLease=await workerServiceClient.query(
          "select l.released_at,e.state from public.discovery_orchestration_execution_leases l join public.discovery_orchestration_executions e on e.company_id=l.company_id and e.id=l.execution_id where l.company_id=$1 and l.id=$2",
          [companyId,leaseTwo.rows[0].id]
        );
        assert.ok(pausedLease.rows[0].released_at);
        assert.equal(pausedLease.rows[0].state,"ready");
        await orchestrationClient.query(
          "select * from public.set_discovery_orchestration_worker_identity_status($1,$2,'active',$3)",
          [companyId,workerIdentityId,"Owner resumed the paused worker within the active company grant."]
        );

        // Shortening an active company grant must pause the scoped worker and release its lease immediately.
        const leaseThree=await pool.query(
          "insert into public.discovery_orchestration_execution_leases(company_id,execution_id,worker_identity_id,lease_token_hash,worker_identity,leased_at,expires_at,heartbeat_at) values($1,$2,$3,$4,'e20-test-worker',clock_timestamp(),clock_timestamp()+interval '120 seconds',clock_timestamp()) returning id",
          [companyId,executionId,workerIdentityId,"e".repeat(64)]
        );
        await pool.query(
          "update public.discovery_orchestration_executions set state='leased' where company_id=$1 and id=$2",
          [companyId,executionId]
        );
        await pool.query(
          "update public.discovery_company_worker_controls set expires_at=clock_timestamp()+interval '30 seconds',updated_at=clock_timestamp(),reason='E20.4 test shortened the active company worker grant.' where company_id=$1",
          [companyId]
        );
        const shortenedPause=await pool.query(
          "select status from public.discovery_orchestration_worker_identities where company_id=$1 and id=$2",
          [companyId,workerIdentityId]
        );
        assert.equal(shortenedPause.rows[0].status,"paused","shortening a still-enabled company grant must pause scoped workers");
        const shortenedReleasedLease=await pool.query(
          "select l.released_at,e.state from public.discovery_orchestration_execution_leases l join public.discovery_orchestration_executions e on e.company_id=l.company_id and e.id=l.execution_id where l.company_id=$1 and l.id=$2",
          [companyId,leaseThree.rows[0].id]
        );
        assert.ok(shortenedReleasedLease.rows[0].released_at);
        assert.equal(shortenedReleasedLease.rows[0].state,"ready");

        await orchestrationClient.query(
          "select * from public.set_discovery_company_worker_grant($1,$2,true,$3)",
          [companyId,actorId,"Re-enabled the temporary company grant after the E20.4 shortening test."]
        );
        await orchestrationClient.query(
          "select * from public.set_discovery_orchestration_worker_identity_status($1,$2,'active',$3)",
          [companyId,workerIdentityId,"Owner resumed the worker after restoring the temporary company grant."]
        );

        // Disabling the existing company-wide grant pauses all scoped identities and releases leases.
        const leaseFour=await pool.query(
          "insert into public.discovery_orchestration_execution_leases(company_id,execution_id,worker_identity_id,lease_token_hash,worker_identity,leased_at,expires_at,heartbeat_at) values($1,$2,$3,$4,'e20-test-worker',clock_timestamp(),clock_timestamp()+interval '120 seconds',clock_timestamp()) returning id",
          [companyId,executionId,workerIdentityId,"9".repeat(64)]
        );
        await pool.query(
          "update public.discovery_orchestration_executions set state='leased' where company_id=$1 and id=$2",
          [companyId,executionId]
        );
        await orchestrationClient.query(
          "select * from public.set_discovery_company_worker_grant($1,$2,false,$3)",
          [companyId,actorId,"E20.4 integration test for global company grant revocation."]
        );
        const globalPause=await pool.query(
          "select status from public.discovery_orchestration_worker_identities where company_id=$1 and id=$2",
          [companyId,workerIdentityId]
        );
        assert.equal(globalPause.rows[0].status,"paused");
        const globalReleasedLease=await pool.query(
          "select l.released_at,e.state from public.discovery_orchestration_execution_leases l join public.discovery_orchestration_executions e on e.company_id=l.company_id and e.id=l.execution_id where l.company_id=$1 and l.id=$2",
          [companyId,leaseFour.rows[0].id]
        );
        assert.ok(globalReleasedLease.rows[0].released_at);
        assert.equal(globalReleasedLease.rows[0].state,"ready");

        await orchestrationClient.query(
          "select * from public.set_discovery_company_worker_grant($1,$2,true,$3)",
          [companyId,actorId,"Re-enabled the temporary company grant after the E20.4 revocation test."]
        );
        await orchestrationClient.query(
          "select * from public.set_discovery_orchestration_worker_identity_status($1,$2,'active',$3)",
          [companyId,workerIdentityId,"Owner resumed the worker after restoring the temporary company grant."]
        );
        const revokedWorker=await orchestrationClient.query(
          "select * from public.set_discovery_orchestration_worker_identity_status($1,$2,'revoked',$3)",
          [companyId,workerIdentityId,"Owner permanently revoked the test worker identity after lifecycle assertions."]
        );
        assert.equal(revokedWorker.rows[0].status,"revoked");
        assert.equal(revokedWorker.rows[0].released_leases,0);
        const workerHistory=await pool.query(
          "select count(*)::int as count from public.discovery_orchestration_worker_events where company_id=$1 and worker_identity_id=$2",
          [companyId,workerIdentityId]
        );
        assert.ok(workerHistory.rows[0].count>=7);
      } finally {
        await workerServiceClient.query("reset role");
        workerServiceClient.release();
      }
    } finally { orchestrationClient.release(); }
    // E16: normalized deal-specific party links use stable record keys and retain history.
    const partyClient=await pool.connect();
    try {
      await partyClient.query("select set_config('request.jwt.claim.sub',$1,false)",[actorId]);
      await partyClient.query(
        "insert into public.company_records(company_id,record_type,record_key,payload,created_by,updated_by) values($1,'property','deal-e16',$2::jsonb,$3,$3),($1,'contact','party-e16',$4::jsonb,$3,$3),($1,'document_metadata','evidence-e16',$5::jsonb,$3,$3)",
        [companyId,'{"module":"Property Sale","title":"E16 Deal"}',actorId,'{"name":"E16 Counterparty"}','{"name":"Reviewed authority evidence"}']
      );
      const partyLink=await partyClient.query(
        "insert into public.company_deal_parties(company_id,deal_record_key,party_record_key,role_code,responsibility_code) values($1,'deal-e16','party-e16','buyer','decision_maker') returning *",
        [companyId]
      );
      const partyId=partyLink.rows[0].id;
      assert.equal(partyLink.rows[0].created_by,actorId);
      assert.equal(partyLink.rows[0].verification_state,"unverified");
      await assert.rejects(
        partyClient.query("update public.company_deal_parties set verification_state='verified' where id=$1",[partyId]),
        /check constraint|violates check/i
      );
      const verifiedParty=await partyClient.query(
        "update public.company_deal_parties set verification_state='verified',evidence_record_key='evidence-e16',effective_to='2027-01-31' where id=$1 returning *",
        [partyId]
      );
      assert.equal(verifiedParty.rows[0].verification_state,"verified");
      assert.equal(verifiedParty.rows[0].evidence_record_key,"evidence-e16");
      await assert.rejects(
        partyClient.query("update public.company_records set deleted_at=now() where company_id=$1 and record_type='contact' and record_key='party-e16'",[companyId]),
        /active deal-party relationship/
      );
      await assert.rejects(
        partyClient.query("update public.company_records set deleted_at=now() where company_id=$1 and record_type='document_metadata' and record_key='evidence-e16'",[companyId]),
        /active deal-party relationship/
      );
      await assert.rejects(
        partyClient.query("update public.company_deal_parties set role_code='seller' where id=$1",[partyId]),
        /identity are immutable/
      );
      const eventCount=await partyClient.query(
        "select count(*)::int as count from public.company_deal_party_events where company_id=$1 and deal_party_id=$2",
        [companyId,partyId]
      );
      assert.equal(eventCount.rows[0].count,2);
      await assert.rejects(
        partyClient.query("update public.company_deal_party_events set event_type='party_link_updated' where deal_party_id=$1",[partyId]),
        /history is immutable/
      );
      await partyClient.query("select set_config('request.jwt.claim.sub',$1,false)",[viewerId]);
      await assert.rejects(
        partyClient.query("update public.company_deal_parties set authority_scope='unauthorised' where id=$1",[partyId]),
        /authorised company member/
      );
      await partyClient.query("select set_config('request.jwt.claim.sub',$1,false)",[actorId]);
      await assert.rejects(
        partyClient.query("delete from public.company_deal_parties where id=$1",[partyId]),
        /cannot be deleted/
      );
      await partyClient.query("insert into public.companies(id) values('99999999-9999-4999-8999-999999999999')");
      await partyClient.query("insert into auth.users(id) values('88888888-8888-4888-8888-888888888888')");
      await partyClient.query(
        "insert into public.company_records(company_id,record_type,record_key,payload,created_by,updated_by) values('99999999-9999-4999-8999-999999999999','contact','foreign-party','{}'::jsonb,'88888888-8888-4888-8888-888888888888','88888888-8888-4888-8888-888888888888')"
      );
      await assert.rejects(
        partyClient.query(
          "insert into public.company_deal_parties(company_id,deal_record_key,party_record_key,role_code,created_by,updated_by) values($1,'deal-e16','foreign-party','buyer',$2,$2)",
          [companyId,actorId]
        ),
        /foreign key constraint/
      );

      // E17: graph projection exposes explicit, date-aware links and safe node labels.
      const graphView=await partyClient.query(
        "select relationship_id,deal_label,party_label,role_code,verification_state,evidence_label from public.company_relationship_graph where company_id=$1 and relationship_id=$2",
        [companyId,partyId]
      );
      assert.equal(graphView.rows.length,1);
      assert.equal(graphView.rows[0].deal_label,"E16 Deal");
      assert.equal(graphView.rows[0].party_label,"E16 Counterparty");
      assert.equal(graphView.rows[0].verification_state,"verified");
      assert.equal(graphView.rows[0].evidence_label,"Reviewed authority evidence");
      const graphResult=await partyClient.query(
        "select public.get_company_relationship_graph($1,'2026-12-01'::date) as graph",
        [companyId]
      );
      const graph=graphResult.rows[0].graph;
      assert.equal(graph.counts.relationship_count,1);
      assert.equal(graph.counts.verified_count,1);
      assert.equal(graph.nodes.length,2);
      assert.equal(graph.edges.length,1);
      assert.equal(graph.edges[0].role,"buyer");
      assert.equal(graph.edges[0].source,"property:deal-e16");
      assert.equal(graph.edges[0].target,"contact:party-e16");
      const expiredGraph=await partyClient.query(
        "select public.get_company_relationship_graph($1,'2028-02-01'::date) as graph",
        [companyId]
      );
      assert.equal(expiredGraph.rows[0].graph.counts.relationship_count,0);
      // E18: structured commitments link to the canonical deal-party edge and retain a full event history.
      const commitment=await partyClient.query(
        "insert into public.company_action_commitments(company_id,record_key,commitment_type,title,status,priority,due_at,responsible_user_id,deal_record_key,party_record_key,relationship_id) values($1,'e18-record-1','promise','Review verified counterparty documents','open','high',now()-interval '2 days',$2,'deal-e16','party-e16',$3) returning *",
        [companyId,actorId,partyId]
      );
      const commitmentId=commitment.rows[0].id;
      assert.equal(commitment.rows[0].created_by,actorId);
      await assert.rejects(
        partyClient.query("update public.company_records set deleted_at=now() where company_id=$1 and record_type='contact' and record_key='party-e16'",[companyId]),
        /Active commitments prevent soft deletion/
      );
      await assert.rejects(
        partyClient.query("update public.company_records set deleted_at=now() where company_id=$1 and record_type='property' and record_key='deal-e16'",[companyId]),
        /Active commitments prevent soft deletion/
      );
      await partyClient.query(
        "insert into public.company_records(company_id,record_type,record_key,payload,created_by,updated_by) values($1,'task','e18-source-task',$2::jsonb,$3,$3)",
        [companyId,'{"title":"Linked source task"}',actorId]
      );
      const sourceTaskCommitment=await partyClient.query(
        "insert into public.company_action_commitments(company_id,record_key,commitment_type,title,status,responsible_user_id,source_task_record_key) values($1,'e18-source-task-commitment','task','Preserve linked source task','open',$2,'e18-source-task') returning id",
        [companyId,actorId]
      );
      await assert.rejects(
        partyClient.query("update public.company_records set deleted_at=now() where company_id=$1 and record_type='task' and record_key='e18-source-task'",[companyId]),
        /Active commitments prevent soft deletion/
      );
      await partyClient.query(
        "update public.company_action_commitments set status='cancelled',change_reason_code='cancelled' where company_id=$1 and id=$2",
        [companyId,sourceTaskCommitment.rows[0].id]
      );
      await partyClient.query(
        "update public.company_records set deleted_at=now() where company_id=$1 and record_type='task' and record_key='e18-source-task'",
        [companyId]
      );
      await assert.rejects(
        partyClient.query(
          "insert into public.company_action_commitments(company_id,record_key,commitment_type,title,responsible_user_id,source_task_record_key) values($1,'e18-deleted-source-task','task','Reject deleted source task',$2,'e18-source-task')",
          [companyId,actorId]
        ),
        /Deleted source task records cannot receive active commitments/
      );
      await partyClient.query(
        "insert into public.company_records(company_id,record_type,record_key,payload,created_by,updated_by) values($1,'property','deal-other-e18',$2::jsonb,$3,$3)",
        [companyId,'{"title":"Different Deal"}',actorId]
      );
      await assert.rejects(
        partyClient.query(
          "insert into public.company_action_commitments(company_id,record_key,commitment_type,title,responsible_user_id,deal_record_key,party_record_key,relationship_id) values($1,'e18-wrong-edge','task','Invalid relationship',$2,'deal-other-e18','party-e16',$3)",
          [companyId,actorId,partyId]
        ),
        /selected relationship must connect this deal and party/
      );
      await assert.rejects(
        partyClient.query(
          "insert into public.company_action_commitments(company_id,record_key,commitment_type,title,responsible_user_id) values($1,'e18-foreign-assignee','task','Invalid assignee','88888888-8888-4888-8888-888888888888')",
          [companyId]
        ),
        /Responsible user must be a member/
      );
      const inbox=await partyClient.query(
        "select due_state,days_overdue,deal_label,party_label from public.company_commitment_inbox where company_id=$1 and id=$2",
        [companyId,commitmentId]
      );
      assert.equal(inbox.rows[0].due_state,"overdue");
      assert.ok(inbox.rows[0].days_overdue>=1);
      assert.equal(inbox.rows[0].deal_label,"E16 Deal");
      assert.equal(inbox.rows[0].party_label,"E16 Counterparty");
      const started=await partyClient.query(
        "update public.company_action_commitments set status='in_progress',change_reason_code='progress' where company_id=$1 and id=$2 returning *",
        [companyId,commitmentId]
      );
      assert.equal(started.rows[0].status,"in_progress");
      const completed=await partyClient.query(
        "update public.company_action_commitments set status='completed',change_reason_code='completed' where company_id=$1 and id=$2 returning *",
        [companyId,commitmentId]
      );
      assert.equal(completed.rows[0].status,"completed");
      assert.ok(completed.rows[0].closed_at);
      const closedInbox=await partyClient.query(
        "select due_state from public.company_commitment_inbox where company_id=$1 and id=$2",
        [companyId,commitmentId]
      );
      assert.equal(closedInbox.rows[0].due_state,"closed");
      await assert.rejects(
        partyClient.query("update public.company_action_commitments set status='open',change_reason_code='progress' where id=$1",[commitmentId]),
        /only be reopened to in_progress/
      );
      const reopened=await partyClient.query(
        "update public.company_action_commitments set status='in_progress',change_reason_code='reopened' where company_id=$1 and id=$2 returning *",
        [companyId,commitmentId]
      );
      assert.equal(reopened.rows[0].status,"in_progress");
      assert.equal(reopened.rows[0].closed_at,null);
      const commitmentEvents=await partyClient.query(
        "select count(*)::int as count from public.company_commitment_events where company_id=$1 and commitment_id=$2",
        [companyId,commitmentId]
      );
      assert.equal(commitmentEvents.rows[0].count,4);
      await assert.rejects(
        partyClient.query("update public.company_commitment_events set reason_code='details_updated' where commitment_id=$1",[commitmentId]),
        /history is immutable/
      );
      await partyClient.query("select set_config('request.jwt.claim.sub',$1,false)",[viewerId]);
      await assert.rejects(
        partyClient.query("update public.company_action_commitments set priority='urgent',change_reason_code='details_updated' where id=$1",[commitmentId]),
        /authorised company member/
      );
      await partyClient.query("select set_config('request.jwt.claim.sub',$1,false)",[actorId]);

    } finally { partyClient.release(); }

    // E06 queues the completed E05 run and requires explicit owner/admin approval
    // before a canonical company identity, identifier or assignment is created.
    const extractedEntity = await pool.query(
      "select id from public.discovery_extracted_entities where company_id=$1 and extraction_run_id=$2",
      [companyId, extractionRunId]
    );
    assert.equal(extractedEntity.rows.length, 1);
    const entityClaim = await pool.query(
      "select * from public.claim_discovery_entity_resolution_job($1,90)",
      ["entity-resolution-worker-test"]
    );
    assert.equal(entityClaim.rows.length, 1, "completed E05 organisation run must enqueue one E06 job");
    const entityJob = entityClaim.rows[0];
    const candidatePayload = [{
      extracted_entity_id: extractedEntity.rows[0].id,
      match_type: "new_entity_proposal",
      matched_entity_id: null,
      proposed_name: "Acme Holdings Pvt Ltd",
      normalized_name: "acme holdings",
      jurisdiction: "IN",
      identifier_proposals: [{
        scheme: "REGISTRATION_ID",
        jurisdiction: "IN",
        normalized_value: "REGAXI0001",
        raw_value: "REG-AXI-0001",
        field_name: "registration_id",
        source_span: { kind: "json-pointer", locator: "$/registration_id" }
      }],
      match_score: 0,
      rationale: {
        method: "no_scoped_match",
        auto_link_permitted: false,
        human_review_required: true
      }
    }];
    const completedCandidates = await pool.query(
      "select public.complete_discovery_entity_resolution($1,$2,$3::jsonb) as count",
      [entityJob.id,entityJob.lease_owner,JSON.stringify(candidatePayload)]
    );
    assert.equal(completedCandidates.rows[0].count,1);
    const entityCandidate = await pool.query(
      "select id,review_state,match_type from public.discovery_entity_match_candidates where company_id=$1 and extraction_run_id=$2",
      [companyId,extractionRunId]
    );
    assert.equal(entityCandidate.rows.length,1);
    assert.equal(entityCandidate.rows[0].review_state,"pending_review");
    await assert.rejects(
      pool.query(
        "select * from public.record_discovery_entity_resolution_review($1,$2,$3,$4,$5)",
        [companyId,viewerId,entityCandidate.rows[0].id,"created_new","Viewer cannot create canonical company identities"]
      ),
      /Only a company owner or admin can review entity matches/
    );
    const entityReview = await pool.query(
      "select * from public.record_discovery_entity_resolution_review($1,$2,$3,$4,$5)",
      [companyId,actorId,entityCandidate.rows[0].id,"created_new","Owner reviewed the source-backed registry identity"]
    );
    assert.equal(entityReview.rows[0].decision,"created_new");
    const canonical = await pool.query(
      "select id,legal_name,normalized_name,jurisdiction,status from public.discovery_canonical_entities where company_id=$1",
      [companyId]
    );
    assert.equal(canonical.rows.length,1);
    assert.equal(canonical.rows[0].normalized_name,"acme holdings");
    assert.equal(canonical.rows[0].jurisdiction,"IN");
    const acceptedIdentifier = await pool.query(
      "select scheme,normalized_value from public.discovery_entity_identifiers where company_id=$1 and canonical_entity_id=$2",
      [companyId,canonical.rows[0].id]
    );
    assert.deepEqual(acceptedIdentifier.rows.map(row=>row.scheme),["REGISTRATION_ID"]);
    assert.equal(acceptedIdentifier.rows[0].normalized_value,"REGAXI0001");
    const assignment = await pool.query(
      "select canonical_entity_id,review_event_id from public.discovery_entity_assignments where company_id=$1 and extraction_run_id=$2",
      [companyId,extractionRunId]
    );
    assert.equal(assignment.rows.length,1);
    assert.equal(assignment.rows[0].canonical_entity_id,canonical.rows[0].id);
    const entityAudit = await pool.query(
      "select count(*)::int as count from public.discovery_audit_events where company_id=$1 and action='entity_resolution_review_recorded' and entity_id=$2",
      [companyId,canonical.rows[0].id]
    );
    assert.equal(entityAudit.rows[0].count,1,"canonical entity review and audit receipt must commit together");

    // Legal-entity relationships are recorded only through the owner/admin evidence review RPC.
    const relatedEntity = await pool.query(
      "insert into public.discovery_canonical_entities(company_id,entity_kind,legal_name,normalized_name,jurisdiction,entity_type,status,source_evidence_id,created_by) values($1,'organization','Acme Finance Services Ltd','acme finance services','IN','company','active',$2,$3) returning id",
      [companyId,evidenceId,actorId]
    );
    const relatedEntityId = relatedEntity.rows[0].id;
    const relationshipArgs = [
      companyId,actorId,canonical.rows[0].id,relatedEntityId,"subsidiary",evidenceId,
      JSON.stringify({kind:"html-table-cell",locator:"table:nth-of-type(1) tr:nth-of-type(4) td:nth-of-type(2)",row:4,column:2}),
      "owner_accepted","The official registry filing identifies the subsidiary relationship."
    ];
    await assert.rejects(
      pool.query(
        "select * from public.record_discovery_entity_relationship_review($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)",
        [companyId,viewerId,...relationshipArgs.slice(2)]
      ),
      /Only a company owner or admin can review entity relationships/
    );
    await assert.rejects(
      pool.query(
        "select * from public.record_discovery_entity_relationship_review($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)",
        [companyId,actorId,canonical.rows[0].id,canonical.rows[0].id,"subsidiary",evidenceId,
          relationshipArgs[6],"owner_accepted","Self-relationship must be rejected"]
      ),
      /cannot have a relationship to itself/
    );
    const acceptedRelationship = await pool.query(
      "select * from public.record_discovery_entity_relationship_review($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)",
      relationshipArgs
    );
    assert.equal(acceptedRelationship.rows[0].relationship_type,"subsidiary");
    assert.equal(acceptedRelationship.rows[0].review_state,"owner_accepted");
    const relationshipAudit = await pool.query(
      "select count(*)::int as count from public.discovery_audit_events where company_id=$1 and action='entity_relationship_review_recorded' and entity_id=$2",
      [companyId,acceptedRelationship.rows[0].id]
    );
    assert.equal(relationshipAudit.rows[0].count,1,"relationship decision must have an audit receipt");

    // E07 is queued only after the E06 company assignment exists.
    const personMention = await pool.query(
      "insert into public.discovery_extracted_entities(company_id,extraction_run_id,evidence_id,mention_key,entity_kind,raw_name,normalized_name,source_span,confidence) values($1,$2,$3,'person:asha-rao','person','Asha Rao','Asha Rao',$4::jsonb,0.96) returning id",
      [companyId,extractionRunId,evidenceId,JSON.stringify({kind:"html-text",start:20,end:28})]
    );
    const personMentionId = personMention.rows[0].id;
    const mentionLineage=await pool.query(
      "select event_type,field_name,evidence_content_hash,source_span from public.discovery_field_provenance where company_id=$1 and origin_table='discovery_extracted_entities' and origin_record_id=$2",
      [companyId,personMentionId]
    );
    assert.equal(mentionLineage.rows.length,1,"E13 must preserve extracted-entity mention lineage");
    assert.equal(mentionLineage.rows[0].field_name,"entity_mention");
    assert.equal(mentionLineage.rows[0].source_span.kind,"html-text");
    assert.match(mentionLineage.rows[0].evidence_content_hash,/^[a-f0-9]{64}$/);
    await pool.query(
      "insert into public.discovery_extracted_facts(company_id,extraction_run_id,evidence_id,extracted_entity_id,field_name,value_type,raw_value,normalized_value,source_span,confidence,validation_status) values ($1,$2,$3,$4,'job_title','string','Chief Financial Officer',to_jsonb('Chief Financial Officer'::text),'{\"kind\":\"html-text\",\"start\":30,\"end\":53}'::jsonb,0.94,'valid'),($1,$2,$3,$4,'employer_entity_id','identifier',$5,to_jsonb($5::text),'{\"kind\":\"json-pointer\",\"locator\":\"$/officers/0/company\"}'::jsonb,0.91,'valid')",
      [companyId,extractionRunId,evidenceId,personMentionId,extractedEntity.rows[0].id]
    );
    const sourceFieldLineage = await pool.query(
      "select field_name,evidence_id,extraction_run_id,evidence_content_hash,source_span,source_name_snapshot,source_attribution_snapshot,evidence_retained from public.discovery_field_provenance where company_id=$1 and extraction_run_id=$2 and origin_table='discovery_extracted_facts' and field_name in ('job_title','employer_entity_id') order by field_name",
      [companyId,extractionRunId]
    );
    assert.equal(sourceFieldLineage.rows.length,2,"E13 must append lineage for each extracted field");
    assert.ok(sourceFieldLineage.rows.every(row=>row.evidence_id===evidenceId));
    assert.ok(sourceFieldLineage.rows.every(row=>/^[a-f0-9]{64}$/.test(row.evidence_content_hash)));
    assert.ok(sourceFieldLineage.rows.every(row=>row.source_name_snapshot&&row.source_attribution_snapshot));
    const jobTitleLineage=sourceFieldLineage.rows.find(row=>row.field_name==="job_title");
    const employerLineage=sourceFieldLineage.rows.find(row=>row.field_name==="employer_entity_id");
    assert.equal(jobTitleLineage.source_span.kind,"html-text");
    assert.equal(jobTitleLineage.source_span.start,30);
    assert.equal(employerLineage.source_span.kind,"json-pointer");
    assert.equal(employerLineage.source_span.locator,"$/officers/0/company");
    assert.ok(sourceFieldLineage.rows.every(row=>row.evidence_retained===true),
      "raw evidence is retained until a purge receipt is recorded");

    const roleClaim = await pool.query(
      "select * from public.claim_discovery_professional_role_job($1,90)",
      ["professional-role-worker-test"]
    );
    assert.equal(roleClaim.rows.length,1,"E06 reviewed company assignment must enqueue E07 role work");
    const roleJob = roleClaim.rows[0];
    const rolePayload = [{
      extracted_person_id: personMentionId,
      person_name: "Asha Rao",
      normalized_person_name: "asha rao",
      canonical_entity_id: canonical.rows[0].id,
      role_title: "Chief Financial Officer",
      department: null,
      valid_from: null,
      valid_to: null,
      jurisdiction: "IN",
      evidence_id: evidenceId,
      source_span: {
        person: {kind:"html-text",start:20,end:28},
        role: {kind:"html-text",start:30,end:53},
        relationship: {kind:"json-pointer",locator:"$/officers/0/company"}
      },
      confidence: 0.91,
      relationship_method: "reviewed_entity_assignment",
      candidate_state: "pending_review",
      missing_requirements: [],
      rationale: {role_source_backed:true,employer_link_source_backed:true,requires_human_review:true,auto_publish_permitted:false}
    }];
    const roleComplete = await pool.query(
      "select public.complete_discovery_professional_role_job($1,$2,$3::jsonb) as count",
      [roleJob.id,roleJob.lease_owner,JSON.stringify(rolePayload)]
    );
    assert.equal(roleComplete.rows[0].count,1);
    const roleCandidate = await pool.query(
      "select id,review_state,candidate_state,canonical_entity_id,role_title from public.discovery_professional_role_candidates where company_id=$1 and extraction_run_id=$2",
      [companyId,extractionRunId]
    );
    assert.equal(roleCandidate.rows.length,1);
    assert.equal(roleCandidate.rows[0].review_state,"pending_review");
    assert.equal(roleCandidate.rows[0].candidate_state,"pending_review");
    assert.equal(roleCandidate.rows[0].canonical_entity_id,canonical.rows[0].id);
    assert.equal(roleCandidate.rows[0].role_title,"Chief Financial Officer");
    const retentionDate = new Date(Date.now()+180*86400000).toISOString().slice(0,10);
    await assert.rejects(
      pool.query(
        "select * from public.record_discovery_professional_role_review($1,$2,$3,$4,$5,$6,$7,null)",
        [companyId,viewerId,roleCandidate.rows[0].id,"created_new","Viewer cannot create professional identity","public executive role verification",retentionDate]
      ),
      /Only a company owner or admin can review professional roles/
    );
    const roleReview = await pool.query(
      "select * from public.record_discovery_professional_role_review($1,$2,$3,$4,$5,$6,$7,null)",
      [companyId,actorId,roleCandidate.rows[0].id,"created_new","Owner verified the public company disclosure","public executive role verification",retentionDate]
    );
    assert.equal(roleReview.rows[0].decision,"created_new");
    const professionalPerson = await pool.query(
      "select full_name,retention_until,status from public.discovery_professional_people where company_id=$1",
      [companyId]
    );
    assert.equal(professionalPerson.rows.length,1);
    assert.equal(professionalPerson.rows[0].full_name,"Asha Rao");
    assert.equal(professionalPerson.rows[0].status,"active");
    assert.ok(new Date(professionalPerson.rows[0].retention_until)>new Date());
    const roleAssignment = await pool.query(
      "select role_title,canonical_entity_id from public.discovery_professional_role_assignments where company_id=$1",
      [companyId]
    );
    assert.equal(roleAssignment.rows.length,1);
    assert.equal(roleAssignment.rows[0].role_title,"Chief Financial Officer");
    assert.equal(roleAssignment.rows[0].canonical_entity_id,canonical.rows[0].id);
    const roleAudit = await pool.query(
      "select count(*)::int as count from public.discovery_audit_events where company_id=$1 and action='professional_role_review_recorded'",
      [companyId]
    );
    assert.equal(roleAudit.rows[0].count,1,"professional role approval and audit receipt must commit together");

    // E08 consumes only E05 source-allow-listed, typed contact facts.
    const contactClaim = await pool.query(
      "select * from public.claim_discovery_contact_validation_job($1,90)",
      ["contact-validation-worker-test"]
    );
    assert.equal(contactClaim.rows.length,1,"completed E05 run with approved contact fields must enqueue E08");
    const contactJob = contactClaim.rows[0];
    const contactFacts = await pool.query(
      "select f.id as fact_id,f.extracted_entity_id,f.field_name,f.value_type,f.source_span,x.entity_kind from public.discovery_extracted_facts f join public.discovery_extracted_entities x on x.company_id=f.company_id and x.extraction_run_id=f.extraction_run_id and x.id=f.extracted_entity_id where f.company_id=$1 and f.extraction_run_id=$2 and f.field_name in ('work_email','work_phone') order by f.field_name",
      [companyId,extractionRunId]
    );
    assert.equal(contactFacts.rows.length,2);
    const contactPayload = contactFacts.rows.map(row => ({
      extracted_fact_id:row.fact_id,
      extracted_entity_id:row.extracted_entity_id,
      entity_kind:row.entity_kind,
      contact_type:row.value_type,
      field_name:row.field_name,
      value_ciphertext:"Y2lwaGVydGV4dA==",
      value_nonce:"AAAAAAAAAAAAAAAA",
      value_auth_tag:"AAAAAAAAAAAAAAAAAAAAAA==",
      value_fingerprint:"c".repeat(64),
      encryption_version:"aes-256-gcm-v1",
      masked_value:row.value_type==="email"?"t***@acme.example":"+91********10",
      validation_method:"syntax_only",
      validation_result:"syntax_valid",
      validation_confidence:0.99,
      validation:{method:"syntax_only",result:"syntax_valid",reason:null,confidence:0.99,catch_all_result:null,bounce_type:null},
      source_span:row.source_span,
      evidence_id:evidenceId
    }));
    const contactComplete = await pool.query(
      "select public.complete_discovery_contact_validation_job($1,$2,$3::jsonb) as count",
      [contactJob.id,contactJob.lease_owner,JSON.stringify(contactPayload)]
    );
    assert.equal(contactComplete.rows[0].count,2);
    const contactCandidates = await pool.query(
      "select id,contact_type,masked_value,value_ciphertext,validation_result from public.discovery_contact_candidates where company_id=$1 and extraction_run_id=$2 order by contact_type",
      [companyId,extractionRunId]
    );
    assert.equal(contactCandidates.rows.length,2);
    assert.equal(contactCandidates.rows.some(row=>row.masked_value.includes("team@acme.example")),false);
    assert.ok(contactCandidates.rows.every(row=>row.value_ciphertext!=="team@acme.example"));

    await assert.rejects(
      pool.query(
        "select * from public.record_discovery_contact_review($1,$2,$3,'approved',$4,$5,$6,$7,null)",
        [companyId,viewerId,contactCandidates.rows[0].id,"viewer cannot approve contact data","company contact verification",retentionDate,canonical.rows[0].id]
      ),
      /Only a company owner or admin can review contact points/
    );
    const approvedContact = await pool.query(
      "select * from public.record_discovery_contact_review($1,$2,$3,'approved',$4,$5,$6,$7,null)",
      [companyId,actorId,contactCandidates.rows[0].id,"owner verified source-disclosed company contact","company contact verification",retentionDate,canonical.rows[0].id]
    );
    assert.equal(approvedContact.rows[0].contact_type,contactCandidates.rows[0].contact_type);
    assert.equal(approvedContact.rows[0].status,"active");
    assert.equal(approvedContact.rows[0].masked_value,contactCandidates.rows[0].masked_value);
    const catchAllEvent = await pool.query(
      "select * from public.record_discovery_contact_validation_event($1,'reacher_self_hosted','catch_all',0.72,true,null,$2,'{}'::jsonb)",
      [approvedContact.rows[0].id,"integration-catch-all"]
    );
    assert.equal(catchAllEvent.rows[0].result,"catch_all");
    assert.equal(catchAllEvent.rows[0].catch_all_result,true);
    const bounceEvent = await pool.query(
      "select * from public.record_discovery_contact_validation_event($1,'inbound_bounce','bounced',0.99,false,'hard_bounce',$2,'{}'::jsonb)",
      [approvedContact.rows[0].id,"integration-bounce"]
    );
    assert.equal(bounceEvent.rows[0].bounce_type,"hard_bounce");
    await assert.rejects(
      pool.query("update public.discovery_contact_validation_events set result='reachable' where id=$1",[catchAllEvent.rows[0].id]),
      /append-only/
    );


    await assert.rejects(
      pool.query(
        "select * from public.record_discovery_extraction_review($1,$2,$3,$4,null,$5,$6,null)",
        [companyId,viewerId,extractionRunId,extractedFact.rows[0].id,"accepted","Viewer role must not write reviews"]
      ),
      /Only a company owner or admin/
    );
    await assert.rejects(
      pool.query("update public.discovery_extraction_review_events set reason='rewritten' where id=$1",[reviewId]),
      /append-only/
    );

    await assert.rejects(
      pool.query("update public.discovery_extracted_facts set raw_value='rewritten' where extraction_run_id=$1", [extractionRunId]),
      /append-only/
    );
    // A syntactically valid worker payload must still be rejected when it
    // attempts to emit a field outside the reviewed source field allow-list.
    const invalidEvidenceId = "ffffffff-ffff-4fff-8fff-fffffffffff0";
    const invalidEvidenceJobId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4";
    await pool.query(`
      insert into public.discovery_jobs(
        id,company_id,profile_id,source_id,requested_by,status,payload,idempotency_key,started_at,finished_at
      ) values($1,$2,$3,$4,$5,'succeeded',
        '{"purpose":"company identity verification","criteria":{},"candidateUrls":["https://registry.example.gov.in/api/v1/entities/2"]}'::jsonb,
        'integration-evidence-job-0004',now(),now())
    `, [invalidEvidenceJobId,companyId,profileId,sourceId,actorId]);
    await pool.query(`
      insert into public.discovery_evidence_items(
        id,company_id,job_id,source_id,canonical_url,captured_at,content_hash,raw_blob_ref,
        content_type,byte_length,attribution,jurisdiction,licence_snapshot,response_metadata
      ) values($1,$2,$3,$4,'https://registry.example.gov.in/api/v1/entities/2',now(),
        repeat('d',64),'discovery-evidence:company/job/invalid-evidence.bin',
        'application/json',16,'Example registry','IN','{"retention_days":30}'::jsonb,'{}'::jsonb)
    `, [invalidEvidenceId,companyId,invalidEvidenceJobId,sourceId]);
    const invalidClaim = await pool.query(
      "select * from public.claim_discovery_extraction_job($1,90)",
      ["extraction-worker-invalid-test"]
    );
    assert.equal(invalidClaim.rows.length, 1);
    await assert.rejects(
      pool.query(
        "select public.complete_discovery_extraction($1,$2,$3::jsonb,$4::jsonb,$5::jsonb)",
        [
          invalidClaim.rows[0].id,
          invalidClaim.rows[0].lease_owner,
          JSON.stringify({
            extractor_version:"deterministic-v1.0.0", schema_hash:"b".repeat(64),
            source_content_hash:"d".repeat(64),
            source_field_schema_snapshot: {
              legal_name: { type: "string", aliases: ["legal_name"], required: true, entityKind: "organization" },
              registration_id: { type: "identifier", aliases: ["registration_id"] },
              status: { type: "string", aliases: ["status"] },
              work_email: { type: "email", aliases: ["work_email"] },
              work_phone: { type: "phone", aliases: ["work_phone"] },
              address_line_1: { type: "string", aliases: ["address_line_1"] },
              city: { type: "string", aliases: ["city"] },
              state: { type: "string", aliases: ["state"] },
              country: { type: "string", aliases: ["country"] },
              country_code: { type: "string", aliases: ["country_code"] },
              latitude: { type: "number", aliases: ["latitude"] },
              longitude: { type: "number", aliases: ["longitude"] },
              annual_revenue: { type: "currency", aliases: ["annual_revenue"], currencyCode: "INR" },
              employee_count: { type: "number", aliases: ["employee_count"] },
              land_area: { type: "number", aliases: ["land_area"], unit: "sqm" },
              industry: { type: "string", aliases: ["industry"] }
            },
            source_allowed_fields_snapshot: ["legal_name","registration_id","status","work_email","work_phone","address_line_1","city","state","country","country_code","latitude","longitude","annual_revenue","employee_count","land_area","industry"],
            invalid_fact_count:0, warnings:[]
          }),
          "[]",
          JSON.stringify([{
            field_name:"unapproved_private_field", value_type:"string",
            raw_value:"must not persist", normalized_value:"must not persist",
            source_span:span, confidence:0.99, validation_status:"valid"
          }])
        ]
      ),
      /outside the approved source field allow-list/
    );
    const failedInvalidClaim = await pool.query(
      "select public.fail_discovery_extraction_job($1,$2,$3,$4) as ok",
      [invalidClaim.rows[0].id,invalidClaim.rows[0].lease_owner,"EXPECTED_POLICY_REJECTION","Integration policy test"]
    );
    assert.equal(failedInvalidClaim.rows[0].ok,true);

    // Two extraction consumers must claim separate jobs under PostgreSQL row locks.
    const parallelParentJobs = [
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5",
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee6"
    ];
    const parallelEvidenceIds = [
      "ffffffff-ffff-4fff-8fff-fffffffffff1",
      "ffffffff-ffff-4fff-8fff-fffffffffff2"
    ];
    await pool.query(`
      insert into public.discovery_jobs(
        id,company_id,profile_id,source_id,requested_by,status,payload,idempotency_key,started_at,finished_at
      ) values
        ($1,$3,$4,$5,$6,'succeeded',
          '{"purpose":"company identity verification","criteria":{},"candidateUrls":["https://registry.example.gov.in/api/v1/entities/3"]}'::jsonb,
          'integration-evidence-job-0005',now(),now()),
        ($2,$3,$4,$5,$6,'succeeded',
          '{"purpose":"company identity verification","criteria":{},"candidateUrls":["https://registry.example.gov.in/api/v1/entities/4"]}'::jsonb,
          'integration-evidence-job-0006',now(),now())
    `, [parallelParentJobs[0],parallelParentJobs[1],companyId,profileId,sourceId,actorId]);
    await pool.query(`
      insert into public.discovery_evidence_items(
        id,company_id,job_id,source_id,canonical_url,captured_at,content_hash,raw_blob_ref,
        content_type,byte_length,attribution,jurisdiction,licence_snapshot,response_metadata
      ) values
        ($1,$3,$4,$5,'https://registry.example.gov.in/api/v1/entities/3',now(),
          repeat('e',64),$7,
          'application/json',20,'Example registry','IN','{"retention_days":30}'::jsonb,'{}'::jsonb),
        ($2,$3,$6,$5,'https://registry.example.gov.in/api/v1/entities/4',now(),
          repeat('f',64),$8,
          'application/json',20,'Example registry','IN','{"retention_days":30}'::jsonb,'{}'::jsonb)
    `, [
      parallelEvidenceIds[0],parallelEvidenceIds[1],companyId,
      parallelParentJobs[0],sourceId,parallelParentJobs[1],
      "discovery-evidence:" + companyId + "/" + parallelParentJobs[0] + "/" + parallelEvidenceIds[0] + "-" + "e".repeat(64) + ".bin",
      "discovery-evidence:" + companyId + "/" + parallelParentJobs[1] + "/" + parallelEvidenceIds[1] + "-" + "f".repeat(64) + ".bin"
    ]);
    const parallelClaims = await Promise.all([
      pool.query("select * from public.claim_discovery_extraction_job($1,90)", ["extraction-parallel-worker-1"]),
      pool.query("select * from public.claim_discovery_extraction_job($1,90)", ["extraction-parallel-worker-2"])
    ]);
    const parallelClaimed = parallelClaims.flatMap(result => result.rows);
    assert.equal(parallelClaimed.length,2,"two extraction worker slots must claim two separate queued evidence jobs");
    assert.notEqual(parallelClaimed[0].id,parallelClaimed[1].id,"SKIP LOCKED must not hand one job to two workers");
    await Promise.all(parallelClaimed.map(job =>
      pool.query(
        "select public.fail_discovery_extraction_job($1,$2,$3,$4)",
        [job.id,job.lease_owner,"PARALLEL_CLAIM_TEST_CLEANUP","End-to-end parallel claim test cleanup"]
      )
    ));

    // E09: source-backed address normalisation and source coordinates are separate from title/ownership.
    const geoClaim = await pool.query(
      "select * from public.claim_discovery_geo_resolution_job($1,90)",
      ["geo-resolution-worker-test"]
    );
    assert.equal(geoClaim.rows.length,1,"E05 source-approved location fields must enqueue E09");
    const geoJob=geoClaim.rows[0];
    const geoFactRows=await pool.query(
      "select f.field_name,f.source_span from public.discovery_extracted_facts f where f.company_id=$1 and f.extraction_run_id=$2 and f.field_name=any($3::text[]) and f.validation_status='valid'",
      [companyId,extractionRunId,["address_line_1","city","state","country","country_code","latitude","longitude"]]
    );
    assert.equal(geoFactRows.rows.length,7);
    const geoFieldSpans={};
    for(const row of geoFactRows.rows) geoFieldSpans[row.field_name]=row.source_span;
    const geoPayload=[{
      extracted_entity_id:extractedEntity.rows[0].id,
      entity_kind:"organization",
      place_label:"Acme Holdings Pvt Ltd",
      address:{
        formatted:"12 Industrial Road, Bengaluru, Karnataka, India",
        line1:"12 Industrial Road",street:null,house_number:null,
        locality:null,district:null,city:"Bengaluru",state:"Karnataka",
        region:null,postcode:null,country:"India",country_code:"IN"
      },
      source_coordinates:{latitude:12.9716,longitude:77.5946},
      coordinate_state:"source_coordinates",
      source_coordinate_confidence:0.96,
      source_confidence:0.96,
      confidence_method:"minimum_source_lat_lon_fact_confidence",
      address_completeness:{has_formatted_address:true,component_count:4,country_code_validated:true},
      provider:null,provider_candidates:[],provider_attribution:null,
      source_span:{entity:span,fields:geoFieldSpans},
      evidence_id:evidenceId,
      candidate_state:"source_coordinates_available",
      rationale:{
        no_person_entities:true,source_field_allowlist_enforced:true,
        coordinates_not_inferred:true,geocoding_is_not_ownership_evidence:true,
        requires_human_review:true
      }
    }];
    const geoComplete=await pool.query(
      "select public.complete_discovery_geo_resolution_job($1,$2,$3::jsonb) as count",
      [geoJob.id,geoJob.lease_owner,JSON.stringify(geoPayload)]
    );
    assert.equal(geoComplete.rows[0].count,1);
    const placeCandidate=await pool.query(
      "select id,entity_kind,address_components,source_coordinates,review_state,candidate_state from public.discovery_place_candidates where company_id=$1 and extraction_run_id=$2",
      [companyId,extractionRunId]
    );
    assert.equal(placeCandidate.rows.length,1);
    assert.equal(placeCandidate.rows[0].entity_kind,"organization");
    assert.equal(placeCandidate.rows[0].address_components.city,"Bengaluru");
    assert.equal(placeCandidate.rows[0].source_coordinates.latitude,12.9716);
    assert.equal(placeCandidate.rows[0].review_state,"pending_review");
    await assert.rejects(
      pool.query(
        "select * from public.record_discovery_place_review($1,$2,$3,'accepted',$4)",
        [companyId,viewerId,placeCandidate.rows[0].id,"Viewer cannot accept geo candidates"]
      ),
      /Only a company owner or admin can review place candidates/
    );
    const placeReview=await pool.query(
      "select * from public.record_discovery_place_review($1,$2,$3,'accepted',$4)",
      [companyId,actorId,placeCandidate.rows[0].id,"Owner reviewed the published business location"]
    );
    assert.equal(placeReview.rows[0].decision,"accepted");
    const placeAudit=await pool.query(
      "select count(*)::int as count from public.discovery_audit_events where company_id=$1 and action='place_resolution_review_recorded' and entity_id=$2",
      [companyId,placeCandidate.rows[0].id]
    );
    assert.equal(placeAudit.rows[0].count,1);

    // E10 stores source-specific values, their published/captured timestamps and conflicts without overwriting the E06 company.
    const enrichmentClaim=await pool.query(
      "select * from public.claim_discovery_enrichment_job($1,90)",
      ["enrichment-worker-test"]
    );
    assert.equal(enrichmentClaim.rows.length,1,"E06 assignment plus approved enrichment fields must enqueue E10");
    const enrichmentJob=enrichmentClaim.rows[0];
    const enrichmentSource=await pool.query(
      "select name,domain,jurisdiction,attribution,license_ref,allowed_fields,field_schema from public.discovery_source_registry where id=$1",
      [sourceId]
    );
    const enrichmentRun=await pool.query(
      "select completed_at,source_content_hash from public.discovery_extraction_runs where id=$1",
      [extractionRunId]
    );
    const enrichmentEvidence=await pool.query(
      "select captured_at,source_published_at from public.discovery_evidence_items where id=$1",
      [evidenceId]
    );
    const enrichmentFacts=await pool.query(
      "select f.id as fact_id,f.extracted_entity_id,f.field_name,f.value_type,f.raw_value,f.normalized_value,f.source_span,f.confidence from public.discovery_extracted_facts f where f.company_id=$1 and f.extraction_run_id=$2 and f.field_name=any($3::text[]) order by f.field_name",
      [companyId,extractionRunId,["annual_revenue","employee_count","land_area","industry"]]
    );
    assert.equal(enrichmentFacts.rows.length,4);
    const categoryByField={annual_revenue:"finance",employee_count:"operating",land_area:"property",industry:"business"};
    const enrichmentPayload=enrichmentFacts.rows.map(f=>({
      extracted_fact_id:f.fact_id,
      extracted_entity_id:f.extracted_entity_id,
      canonical_entity_id:canonical.rows[0].id,
      entity_kind:"organization",
      attribute_key:f.field_name,
      attribute_category:categoryByField[f.field_name],
      source_field_name:f.field_name,
      value_type:f.value_type,
      raw_value:f.raw_value,
      normalized_value:f.normalized_value,
      source_unit:f.field_name==="land_area"?"sqm":null,
      currency_code:f.field_name==="annual_revenue"?"INR":null,
      source_confidence:Number(f.confidence),
      source_span:f.source_span
    }));
    const enrichmentComplete=await pool.query(
      "select public.complete_discovery_enrichment_job($1,$2,$3::jsonb) as count",
      [enrichmentJob.id,enrichmentJob.lease_owner,JSON.stringify(enrichmentPayload)]
    );
    assert.equal(enrichmentComplete.rows[0].count,4);
    const enrichmentObservations=await pool.query(
      "select id,attribute_key,attribute_category,raw_value,normalized_value,source_unit,currency_code,source_published_at,evidence_captured_at,review_state from public.discovery_enrichment_observations where company_id=$1 and extraction_run_id=$2 order by attribute_key",
      [companyId,extractionRunId]
    );
    assert.equal(enrichmentObservations.rows.length,4);
    const revenueObservation=enrichmentObservations.rows.find(x=>x.attribute_key==="annual_revenue");
    assert.equal(revenueObservation.raw_value,"₹12 crore");
    assert.equal(revenueObservation.normalized_value.amount,120000000);
    assert.equal(revenueObservation.normalized_value.currency,"INR");
    assert.equal(revenueObservation.currency_code,"INR");
    assert.equal(revenueObservation.source_published_at,null,"E10 must not invent a source publication timestamp when the source did not provide one");
    assert.ok(revenueObservation.evidence_captured_at,"E10 must preserve the evidence capture timestamp");
    assert.ok(enrichmentObservations.rows.every(x=>x.review_state==="pending_review"));
    await assert.rejects(
      pool.query(
        "select * from public.record_discovery_enrichment_review($1,$2,$3,'accepted',$4)",
        [companyId,viewerId,enrichmentObservations.rows[0].id,"Viewer cannot approve enrichment"]
      ),
      /Only a company owner or admin can review enrichment observations/
    );
    const industryObservation=enrichmentObservations.rows.find(x=>x.attribute_key==="industry");
    const industryReview=await pool.query(
      "select * from public.record_discovery_enrichment_review($1,$2,$3,'accepted',$4)",
      [companyId,actorId,industryObservation.id,"Owner reviewed the source-disclosed industry attribute"]
    );
    assert.equal(industryReview.rows[0].decision,"accepted");
    const enrichmentAudit=await pool.query(
      "select count(*)::int as count from public.discovery_audit_events where company_id=$1 and action='enrichment_observation_review_recorded' and entity_id=$2",
      [companyId,industryObservation.id]
    );
    assert.equal(enrichmentAudit.rows[0].count,1);

    // A second independent source disagrees on annual revenue. Both source observations
    // must be preserved with timestamps; neither is automatically selected.
    const secondSourceId="dddddddd-dddd-4ddd-8ddd-ddddddddddde";
    const secondParentJobId="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee7";
    const secondEvidenceId="ffffffff-ffff-4fff-8fff-fffffffffff3";
    await pool.query(`
      insert into public.discovery_source_registry(
        id,company_id,name,canonical_url,domain,source_type,connector_key,jurisdiction,
        terms_url,license_ref,allowed_purposes,allowed_fields,field_schema,allowed_paths,access_method,
        rate_limit_per_minute,max_pages_per_job,retention_days,attribution,legal_basis,
        status,reviewed_by,reviewed_at,created_by,updated_by
      ) values (
        $1,$2,'Licensed financial feed','https://finance.example.org/api','finance.example.org',
        'licensed_api','licensed_api','IN','https://finance.example.org/terms','Contracted financial feed',
        array['company identity verification','enrichment'],array['legal_name','annual_revenue'],
        '{"legal_name":{"type":"string","aliases":["legal_name"],"entityKind":"organization"},"annual_revenue":{"type":"currency","aliases":["annual_revenue"],"currencyCode":"INR"}}'::jsonb,
        array['/api/v1/company'],'licensed_api',1,10,30,'Licensed financial feed attribution','Approved contracted financial enrichment',
        'approved',$3,now(),$3,$3
      )
    `,[secondSourceId,companyId,actorId]);
    await pool.query(
      "insert into public.discovery_profile_sources(company_id,profile_id,source_id,created_by) values($1,$2,$3,$4)",
      [companyId,profileId,secondSourceId,actorId]
    );
    await pool.query(`
      insert into public.discovery_jobs(
        id,company_id,profile_id,source_id,requested_by,status,payload,idempotency_key,started_at,finished_at
      ) values($1,$2,$3,$4,$5,'succeeded',
        '{"purpose":"company identity verification","criteria":{},"candidateUrls":["https://finance.example.org/api/v1/company/acme"]}'::jsonb,
        'integration-enrichment-source-b',now(),now())
    `,[secondParentJobId,companyId,profileId,secondSourceId,actorId]);
    await pool.query(`
      insert into public.discovery_evidence_items(
        id,company_id,job_id,source_id,canonical_url,captured_at,source_published_at,content_hash,raw_blob_ref,
        content_type,byte_length,attribution,jurisdiction,licence_snapshot,response_metadata
      ) values($1,$2,$3,$4,'https://finance.example.org/api/v1/company/acme',now()-interval '1 day',now()-interval '3 days',
        repeat('f',64),'discovery-evidence:company/job/second-evidence.bin',
        'application/json',32,'Licensed financial feed attribution','IN','{"retention_days":30}'::jsonb,'{}'::jsonb)
    `,[secondEvidenceId,companyId,secondParentJobId,secondSourceId]);
    const secondExtractionClaim=await pool.query(
      "select * from public.claim_discovery_extraction_job($1,90)",
      ["second-source-extraction-test"]
    );
    assert.equal(secondExtractionClaim.rows.length,1);
    const secondExtractionJob=secondExtractionClaim.rows[0];
    const secondSpan={kind:"json-pointer",locator:"$/annual_revenue",quote:"₹10 crore",quoteHash:"h".repeat(64)};
    const secondRun=await pool.query(
      "select public.complete_discovery_extraction($1,$2,$3::jsonb,$4::jsonb,$5::jsonb) as run_id",
      [
        secondExtractionJob.id,
        secondExtractionJob.lease_owner,
        JSON.stringify({
          extractor_version:"deterministic-v1.0.0",schema_hash:"e".repeat(64),
          source_content_hash:"f".repeat(64),
          source_field_schema_snapshot:{
            legal_name:{type:"string",aliases:["legal_name"],entityKind:"organization"},
            annual_revenue:{type:"currency",aliases:["annual_revenue"],currencyCode:"INR"}
          },
          source_allowed_fields_snapshot:["legal_name","annual_revenue"],
          invalid_fact_count:0,warnings:[]
        }),
        JSON.stringify([{
          mention_key:"organization:acme-source-b",entity_kind:"organization",
          raw_name:"Acme Holdings Pvt Ltd",normalized_name:"Acme Holdings Pvt Ltd",
          source_span:span,confidence:0.99
        }]),
        JSON.stringify([
          {
            mention_key:"organization:acme-source-b",field_name:"legal_name",
            value_type:"string",raw_value:"Acme Holdings Pvt Ltd",
            normalized_value:"Acme Holdings Pvt Ltd",source_span:span,
            confidence:0.99,validation_status:"valid"
          },
          {
            mention_key:"organization:acme-source-b",field_name:"annual_revenue",
            value_type:"currency",raw_value:"₹10 crore",
            normalized_value:{amount:100000000,currency:"INR"},source_span:secondSpan,
            confidence:0.95,validation_status:"valid"
          }
        ])
      ]
    );
    const secondExtractionRunId=secondRun.rows[0].run_id;
    const secondMention=await pool.query(
      "select id from public.discovery_extracted_entities where extraction_run_id=$1 and entity_kind='organization'",
      [secondExtractionRunId]
    );
    assert.equal(secondMention.rows.length,1);
    const secondReviewEvent=await pool.query(
      "insert into public.discovery_entity_review_events(company_id,candidate_id,actor_user_id,decision,canonical_entity_id,reason) values($1,gen_random_uuid(),$2,'linked_existing',$3,'Owner linked independent financial source to existing canonical company') returning id",
      [companyId,actorId,canonical.rows[0].id]
    );
    await pool.query(
      "insert into public.discovery_entity_assignments(company_id,extraction_run_id,extracted_entity_id,canonical_entity_id,source_evidence_id,review_event_id) values($1,$2,$3,$4,$5,$6)",
      [companyId,secondExtractionRunId,secondMention.rows[0].id,canonical.rows[0].id,secondEvidenceId,secondReviewEvent.rows[0].id]
    );
    const secondEnrichmentClaim=await pool.query(
      "select * from public.claim_discovery_enrichment_job($1,90)",
      ["second-source-enrichment-test"]
    );
    assert.equal(secondEnrichmentClaim.rows.length,1);
    const secondRevenueFact=await pool.query(
      "select id,extracted_entity_id,raw_value,normalized_value,source_span,confidence from public.discovery_extracted_facts where extraction_run_id=$1 and field_name='annual_revenue'",
      [secondExtractionRunId]
    );
    assert.equal(secondRevenueFact.rows.length,1);
    const secondEnrichmentPayload=[{
      extracted_fact_id:secondRevenueFact.rows[0].id,
      extracted_entity_id:secondRevenueFact.rows[0].extracted_entity_id,
      canonical_entity_id:canonical.rows[0].id,
      entity_kind:"organization",
      attribute_key:"annual_revenue",attribute_category:"finance",
      source_field_name:"annual_revenue",value_type:"currency",raw_value:"₹10 crore",
      normalized_value:{amount:100000000,currency:"INR"},
      source_unit:null,currency_code:"INR",source_confidence:0.95,
      source_span:secondRevenueFact.rows[0].source_span
    }];
    const secondEnrichmentComplete=await pool.query(
      "select public.complete_discovery_enrichment_job($1,$2,$3::jsonb) as count",
      [secondEnrichmentClaim.rows[0].id,secondEnrichmentClaim.rows[0].lease_owner,JSON.stringify(secondEnrichmentPayload)]
    );
    assert.equal(secondEnrichmentComplete.rows[0].count,1);
    const revenueConflict=await pool.query(
      "select id,candidate_a,candidate_b,status from public.discovery_enrichment_conflicts where company_id=$1 and canonical_entity_id=$2 and attribute_key='annual_revenue'",
      [companyId,canonical.rows[0].id]
    );
    assert.equal(revenueConflict.rows.length,1);
    assert.equal(revenueConflict.rows[0].status,"open");
    const conflictSources=await pool.query(
      "select min(source_published_at) as first_published_at,max(source_published_at) as second_published_at,count(*)::int as count from public.discovery_enrichment_observations where company_id=$1 and canonical_entity_id=$2 and attribute_key='annual_revenue'",
      [companyId,canonical.rows[0].id]
    );
    assert.equal(conflictSources.rows[0].count,2);
    assert.ok(conflictSources.rows[0].second_published_at,"E10 must retain a supplied publication timestamp from the independent source");
    const conflictValues=await pool.query(
      "select count(*)::int as count,count(distinct normalized_value->>'amount')::int as distinct_values from public.discovery_enrichment_observations where company_id=$1 and canonical_entity_id=$2 and attribute_key='annual_revenue'",
      [companyId,canonical.rows[0].id]
    );
    assert.equal(conflictValues.rows[0].count,2);
    assert.equal(conflictValues.rows[0].distinct_values,2);
    const conflictReview=await pool.query(
      "select * from public.record_discovery_enrichment_conflict_review($1,$2,$3,'retained_both',$4)",
      [companyId,actorId,revenueConflict.rows[0].id,"Owner confirms both source observations must remain visible; no single value is selected"]
    );
    assert.equal(conflictReview.rows[0].decision,"retained_both");
    const conflictResolved=await pool.query(
      "select status from public.discovery_enrichment_conflicts where id=$1",
      [revenueConflict.rows[0].id]
    );
    assert.equal(conflictResolved.rows[0].status,"retained_both");

        await pool.query("update public.discovery_source_registry set retention_days=1 where id=$1", [sourceId]);
    const expiredEvidence = await pool.query("select id from public.list_expired_discovery_evidence(50) where id=$1", [evidenceId]);
    assert.equal(expiredEvidence.rows.length, 1, "per-source evidence retention is enforced by PostgreSQL");
    await pool.query(`
      insert into public.discovery_fetch_events(company_id,job_id,source_id,evidence_id,event_type,url,outcome)
      values
        ($1,$2,$3,$4,'response_received','https://registry.example.gov.in/api/v1/entities/1','stored'),
        ($1,$2,$3,$4,'retention_purged','https://registry.example.gov.in/api/v1/entities/1','expired evidence removed')
    `, [companyId, activeJob.id, sourceId, evidenceId]);
    const purgeReceipt = await pool.query(
      "select count(*)::int as count from public.discovery_fetch_events where evidence_id=$1 and event_type='retention_purged'",
      [evidenceId]
    );
    assert.equal(purgeReceipt.rows[0].count,1,"retention sweep terminal event must be accepted by the fetch ledger");
    const purgedLineage = await pool.query(
      "select provenance_event_id,evidence_content_hash,evidence_retained from public.discovery_field_provenance where company_id=$1 and evidence_id=$2 and origin_table='discovery_extracted_facts' and field_name='job_title'",
      [companyId,evidenceId]
    );
    assert.equal(purgedLineage.rows.length,1,"E13 source lineage must survive the evidence purge receipt");
    assert.equal(purgedLineage.rows[0].evidence_retained,false,
      "E13 must mark raw evidence as no longer retained after the terminal purge receipt");
    assert.match(purgedLineage.rows[0].evidence_content_hash,/^[a-f0-9]{64}$/);
    await assert.rejects(
      pool.query("update public.discovery_provenance_events set decision='tampered' where id=$1",
        [purgedLineage.rows[0].provenance_event_id]),
      /append-only/
    );
    await assert.rejects(
      pool.query("update public.discovery_evidence_items set attribution='changed' where id=$1", [evidenceId]),
      /immutable/
    );
    await assert.rejects(
      pool.query("update public.discovery_fetch_events set outcome='rewritten' where evidence_id=$1", [evidenceId]),
      /immutable/
    );
    const bucket = await pool.query("select public,file_size_limit from storage.buckets where id='discovery-evidence'");
    assert.equal(bucket.rows[0].public, false);
    assert.equal(Number(bucket.rows[0].file_size_limit), 5_000_000);

    // E06 canonical identity and owner review receipts must outlive raw E05 evidence retention.
    await pool.query("delete from public.discovery_evidence_items where id=$1", [evidenceId]);
    const lineageAfterRawDelete = await pool.query(
      "select count(*)::int as count from public.discovery_field_provenance where company_id=$1 and evidence_id=$2 and field_name='job_title'",
      [companyId,evidenceId]
    );
    assert.equal(lineageAfterRawDelete.rows[0].count,1,
      "E13 provenance metadata must remain traceable after raw evidence row deletion");
    const durableEntity = await pool.query(
      "select id,legal_name,source_evidence_id from public.discovery_canonical_entities where company_id=$1 and normalized_name='acme holdings'",
      [companyId]
    );
    assert.equal(durableEntity.rows.length,1,"canonical identity must survive source-evidence purge");
    assert.equal(durableEntity.rows[0].source_evidence_id,evidenceId,"historical evidence UUID must remain traceable");
    const durableIdentifier = await pool.query(
      "select count(*)::int as count from public.discovery_entity_identifiers where company_id=$1 and canonical_entity_id=$2",
      [companyId,durableEntity.rows[0].id]
    );
    assert.equal(durableIdentifier.rows[0].count,1,"reviewed registry identifier must survive evidence purge");
    const durableAssignment = await pool.query(
      "select count(*)::int as count,count(distinct extraction_run_id)::int as run_count,count(*) filter(where extraction_run_id=$3)::int as first_source_count,count(*) filter(where extraction_run_id=$4)::int as second_source_count from public.discovery_entity_assignments where company_id=$1 and canonical_entity_id=$2",
      [companyId,durableEntity.rows[0].id,extractionRunId,secondExtractionRunId]
    );
    assert.equal(durableAssignment.rows[0].count,2,"both owner-approved source assignments must survive evidence purge");
    assert.equal(durableAssignment.rows[0].run_count,2,"source assignments must remain separated by extraction run");
    assert.equal(durableAssignment.rows[0].first_source_count,1,"original source assignment must survive");
    assert.equal(durableAssignment.rows[0].second_source_count,1,"independent source assignment must survive");
    const durableReview = await pool.query(
      "select count(*)::int as count from public.discovery_entity_review_events where company_id=$1 and decision='created_new'",
      [companyId]
    );
    assert.equal(durableReview.rows[0].count,1,"owner review receipt must survive candidate and evidence retention cleanup");
    const durableRelationship = await pool.query(
      "select count(*)::int as count from public.discovery_entity_relationships where company_id=$1 and evidence_id=$2 and review_state='owner_accepted'",
      [companyId,evidenceId]
    );
    assert.equal(durableRelationship.rows[0].count,1,"accepted entity relationships must survive evidence purge");
    const durableProfessionalReview = await pool.query(
      "select count(*)::int as count,count(candidate_id)::int as linked_count,min(candidate_snapshot->>'roleTitle') as role_title from public.discovery_professional_role_review_events where company_id=$1 and decision='created_new'",
      [companyId]
    );
    assert.equal(durableProfessionalReview.rows[0].count,1,"E07 professional review receipt must survive evidence purge");
    assert.equal(durableProfessionalReview.rows[0].linked_count,0,"E07 review receipt must detach from the purged candidate");
    assert.equal(durableProfessionalReview.rows[0].role_title,"Chief Financial Officer","E07 review snapshot must retain the reviewed role, without retaining the person's name");
    const durableContactPoint = await pool.query(
      "select count(*)::int as count,min(source_evidence_id::text) as evidence_id,min(masked_value) as masked_value from public.discovery_contact_points where company_id=$1 and status='active'",
      [companyId]
    );
    assert.equal(durableContactPoint.rows[0].count,1,"owner-approved E08 contact point must survive raw evidence purge");
    assert.equal(durableContactPoint.rows[0].evidence_id,evidenceId,"E08 contact point must retain only the historical evidence identifier");
    assert.ok(durableContactPoint.rows[0].masked_value.includes("***"),"E08 contact point must remain masked at rest");
    const durableContactEvents = await pool.query(
      "select count(*)::int as count,bool_or(result='catch_all') as has_catch_all,bool_or(result='bounced') as has_bounce from public.discovery_contact_validation_events where company_id=$1 and contact_point_id=$2",
      [companyId,approvedContact.rows[0].id]
    );
    assert.equal(durableContactEvents.rows[0].count,3,"E08 syntax, catch-all and bounce validation events must survive candidate/evidence purge");
    assert.equal(durableContactEvents.rows[0].has_catch_all,true);
    assert.equal(durableContactEvents.rows[0].has_bounce,true);
    const durablePlaceReview=await pool.query(
      "select count(*)::int as count,count(candidate_id)::int as linked_count,min(candidate_snapshot->>'coordinateState') as coordinate_state from public.discovery_place_resolution_events where company_id=$1 and decision='accepted'",
      [companyId]
    );
    assert.equal(durablePlaceReview.rows[0].count,1,"E09 place review receipt must survive evidence retention");
    assert.equal(durablePlaceReview.rows[0].linked_count,0,"E09 review receipt must detach from the expired source candidate");
    assert.equal(durablePlaceReview.rows[0].coordinate_state,"source_coordinates","E09 review receipt must preserve only the coordinate-state summary");
    const durableEnrichment=await pool.query(
      "select count(*)::int as count,bool_or(attribute_key='annual_revenue' and raw_value='₹12 crore') as has_revenue from public.discovery_enrichment_observations where company_id=$1 and extraction_run_id=$2",
      [companyId,extractionRunId]
    );
    assert.equal(durableEnrichment.rows[0].count,4,"E10 observations must survive raw source evidence purge");
    assert.equal(durableEnrichment.rows[0].has_revenue,true,"E10 must retain the original source-reported revenue value");
    const durableEnrichmentConflict=await pool.query(
      "select count(*)::int as count,min(status) as status from public.discovery_enrichment_conflicts where company_id=$1 and attribute_key='annual_revenue'",
      [companyId]
    );
    assert.equal(durableEnrichmentConflict.rows[0].count,1,"E10 potential value disagreement must survive evidence purge");
    assert.equal(durableEnrichmentConflict.rows[0].status,"retained_both","E10 conflict review must retain both source observations");
    const durableEnrichmentReviews=await pool.query(
      "select count(*)::int as count,bool_or(decision='accepted') as has_observation_review,bool_or(decision='retained_both') as has_conflict_review from public.discovery_enrichment_review_events where company_id=$1",
      [companyId]
    );
    assert.equal(durableEnrichmentReviews.rows[0].count,2,"E10 observation and conflict decisions must remain auditable");
    assert.equal(durableEnrichmentReviews.rows[0].has_observation_review,true);
    assert.equal(durableEnrichmentReviews.rows[0].has_conflict_review,true);

    // E12 queue coalesces all company changes into one leased job.
    const queuedDeduplication=await pool.query(
      "select id,status,rerun_requested from public.discovery_deduplication_jobs where company_id=$1",[companyId]);
    assert.equal(queuedDeduplication.rows.length,1);
    assert.equal(queuedDeduplication.rows[0].status,"queued");
    const dedupClaim=await pool.query("select * from public.claim_discovery_deduplication_job($1,90)",["deduplication-worker-integration"]);
    assert.equal(dedupClaim.rows.length,1,"E12 claim requires the active company worker grant");
    const dedupJob=dedupClaim.rows[0];

    // A record arriving while the pass is running marks one rerun instead of
    // creating a second concurrent company job.
    await pool.query(
      "insert into public.discovery_canonical_entities(company_id,entity_kind,legal_name,normalized_name,jurisdiction,entity_type,status,source_evidence_id,created_by) values($1,'organization','Acme Holdings Ltd','acme holdings','IN','company','active',$2,$3)",
      [companyId,evidenceId,actorId]);
    const generatedDuringPass=await pool.query(
      "select public.complete_discovery_deduplication_job($1,$2) as count",[dedupJob.id,dedupJob.lease_owner]);
    assert.equal(Number(generatedDuringPass.rows[0].count),1);
    const afterFirstPass=await pool.query(
      "select status,rerun_requested from public.discovery_deduplication_jobs where id=$1",[dedupJob.id]);
    assert.equal(afterFirstPass.rows[0].status,"queued");
    assert.equal(afterFirstPass.rows[0].rerun_requested,false);

    const duplicateCandidate=await pool.query(
      "select id,left_record_id,right_record_id,review_state from public.discovery_deduplication_candidates where company_id=$1 and candidate_kind='organization' and match_rule='exact_legal_name'",[companyId]);
    assert.equal(duplicateCandidate.rows.length,1);
    assert.equal(duplicateCandidate.rows[0].review_state,"pending_review");
    const duplicateCandidateLineage=await pool.query(
      "select event_type,event_metadata from public.discovery_field_provenance where company_id=$1 and origin_table='discovery_deduplication_candidates' and origin_record_id=$2",
      [companyId,duplicateCandidate.rows[0].id]
    );
    assert.equal(duplicateCandidateLineage.rows.length,1,"E13 must capture E12 candidate creation");
    assert.equal(duplicateCandidateLineage.rows[0].event_type,"deduplication_candidate_created");

    const secondDedupClaim=await pool.query(
      "select * from public.claim_discovery_deduplication_job($1,90)",["deduplication-worker-integration-two"]);
    assert.equal(secondDedupClaim.rows.length,1);
    const secondDedupComplete=await pool.query(
      "select public.complete_discovery_deduplication_job($1,$2) as count",[secondDedupClaim.rows[0].id,secondDedupClaim.rows[0].lease_owner]);
    assert.equal(Number(secondDedupComplete.rows[0].count),0,"second pass must be idempotent");
    const completedDedupJob=await pool.query(
      "select status from public.discovery_deduplication_jobs where company_id=$1",[companyId]);
    assert.equal(completedDedupJob.rows[0].status,"succeeded");

    const matchResult=await pool.query(
      `insert into public.discovery_match_results(
        company_id,canonical_entity_id,workspace_key,criteria_version,
        criteria_snapshot,candidate_snapshot,score,confidence,eligible,method,created_by
      ) values($1,$2,'startup','integration-v1','{}'::jsonb,'{}'::jsonb,82.5,0.90,true,
        'deterministic_weighted_rules_v1',$3) returning id`,
      [companyId,duplicateCandidate.rows[0].left_record_id,actorId]
    );
    const matchLineage=await pool.query(
      "select event_type,event_metadata from public.discovery_field_provenance where company_id=$1 and origin_table='discovery_match_results' and origin_record_id=$2",
      [companyId,matchResult.rows[0].id]
    );
    assert.equal(matchLineage.rows.length,1,"E13 must capture E11 score provenance");
    assert.equal(matchLineage.rows[0].event_type,"match_score_recorded");
    assert.equal(Number(matchLineage.rows[0].event_metadata.score),82.5);

    const duplicateReview=await pool.query(
      "select * from public.record_discovery_deduplication_review($1,$2,$3,'confirmed_duplicate',$4)",
      [companyId,actorId,duplicateCandidate.rows[0].id,"Integration fixture confirms an exact same-jurisdiction legal-name duplicate."]);
    assert.equal(duplicateReview.rows[0].decision,"confirmed_duplicate");
    const duplicateReviewLineage=await pool.query(
      "select event_type,decision,actor_user_id from public.discovery_field_provenance where company_id=$1 and origin_table='discovery_deduplication_review_events' and origin_record_id=$2",
      [companyId,duplicateReview.rows[0].id]
    );
    assert.equal(duplicateReviewLineage.rows.length,1,"E13 must preserve E12 human review");
    assert.equal(duplicateReviewLineage.rows[0].event_type,"deduplication_reviewed");
    assert.equal(duplicateReviewLineage.rows[0].decision,"confirmed_duplicate");
    assert.equal(duplicateReviewLineage.rows[0].actor_user_id,actorId);
    const duplicateStillActive=await pool.query(
      "select count(*)::int as count from public.discovery_canonical_entities where company_id=$1 and id in ($2,$3) and status='active'",
      [companyId,duplicateCandidate.rows[0].left_record_id,duplicateCandidate.rows[0].right_record_id]);
    assert.equal(duplicateStillActive.rows[0].count,2,"E12 review must not merge either canonical entity");
    const duplicateAudit=await pool.query(
      "select count(*)::int as count from public.discovery_audit_events where company_id=$1 and action='deduplication_review_recorded' and entity_id=$2",
      [companyId,duplicateCandidate.rows[0].id]);
    assert.equal(duplicateAudit.rows[0].count,1);
    await assert.rejects(
      pool.query("update public.discovery_deduplication_review_events set reason='rewritten' where id=$1",[duplicateReview.rows[0].id]),
      /immutable/);
    const graphEdges=await pool.query(
      "select count(*)::int as count from public.discovery_entity_graph_edges where company_id=$1",[companyId]);
    assert.equal(graphEdges.rows[0].count,1,"only the owner-accepted E06 relationship appears in the graph");

    // E14: verified request intake, minimisation-aware erasure and expiry processing.
    const privacyPerson=await pool.query(
      "select id from public.discovery_professional_people where company_id=$1 and normalized_name='asha rao' limit 1",
      [companyId]
    );
    assert.equal(privacyPerson.rows.length,1,"E14 fixture must contain a reviewed professional identity");
    const privacyContact=await pool.query(
      "select id from public.discovery_contact_points where company_id=$1 and status='active' limit 1",
      [companyId]
    );
    assert.equal(privacyContact.rows.length,1,"E14 fixture must contain an approved contact point");

    // Process the independent expiry fixture before erasing the shared source person.
    const retentionPerson=await pool.query(
      "insert into public.discovery_professional_people(company_id,full_name,normalized_name,public_professional_source,purpose,retention_until,source_evidence_id,created_by,status) values($1,'Retention Fixture Person','retention fixture person',true,'integration retention test',$2,$3,$4,'active') returning id",
      [companyId,retentionDate,evidenceId,actorId]
    );
    // Duplicate the already-approved contact into a test-only expired point
    // linked to the retention fixture person. The source candidate is historical.
    const retentionContact=await pool.query(
      `insert into public.discovery_contact_points(
        company_id,contact_type,value_ciphertext,value_nonce,value_auth_tag,value_fingerprint,
        encryption_version,masked_value,canonical_entity_id,professional_person_id,
        source_candidate_id,source_evidence_id,purpose,retention_until,created_by,status
      )
      select company_id,contact_type,value_ciphertext,value_nonce,value_auth_tag,value_fingerprint,
        encryption_version,masked_value,canonical_entity_id,$3,source_candidate_id,source_evidence_id,
        'integration contact retention test',$4,$5,'active'
      from public.discovery_contact_points
      where company_id=$1 and id=$2 returning id`,
      [companyId,privacyContact.rows[0].id,retentionPerson.rows[0].id,retentionDate,actorId]
    );
    assert.equal(retentionContact.rows.length,1,"E14 retention fixture must have a second contact point");
    await pool.query(
      "update public.discovery_professional_people set retention_until=current_date-1 where company_id=$1 and id=$2",
      [companyId,retentionPerson.rows[0].id]
    );
    await pool.query(
      "update public.discovery_contact_points set retention_until=current_date-1 where company_id=$1 and id=$2",
      [companyId,retentionContact.rows[0].id]
    );
    await pool.query(
      "select public.record_discovery_privacy_policy($1,$2,'professional_identity','integration retention test','legitimate_interests','Integration fixture purpose',365,'Test-only retention rule',current_date+90,true)",
      [companyId,actorId]
    );
    await pool.query(
      "select public.record_discovery_privacy_policy($1,$2,'contact_point','integration contact retention test','legitimate_interests','Integration fixture contact purpose',365,'Test-only contact retention rule',current_date+90,true)",
      [companyId,actorId]
    );
    const queuedPrivacyRetention=await pool.query(
      "select public.enqueue_expired_discovery_personal_data($1,$2,20) as count",
      [companyId,actorId]
    );
    assert.equal(Number(queuedPrivacyRetention.rows[0].count),2,"E14 queues both expired professional identity and contact data");
    const processedPrivacyRetention=await pool.query(
      "select public.process_discovery_privacy_retention_queue($1,$2,20) as count",
      [companyId,actorId]
    );
    assert.equal(Number(processedPrivacyRetention.rows[0].count),2,"E14 owner/admin-invoked retention run processes due items");
    const expiredRecords=await pool.query(
      "select (select count(*)::int from public.discovery_professional_people where company_id=$1 and id=$2) as people,(select count(*)::int from public.discovery_contact_points where company_id=$1 and id=$3) as contacts",
      [companyId,retentionPerson.rows[0].id,retentionContact.rows[0].id]
    );
    assert.equal(expiredRecords.rows[0].people,0);
    assert.equal(expiredRecords.rows[0].contacts,0);
    const privacyRetentionReceipts=await pool.query(
      "select count(*)::int as count from public.discovery_privacy_retention_queue where company_id=$1 and status='completed'",
      [companyId]
    );
    assert.equal(privacyRetentionReceipts.rows[0].count,2);

    const privacyRequest=await pool.query(
      "select * from public.create_discovery_privacy_request($1,$2,'erasure','data_subject',$3,clock_timestamp()+interval '30 days')",
      [companyId,actorId,"d".repeat(64)]
    );
    const privacyRequestId=privacyRequest.rows[0].id;
    assert.equal(privacyRequest.rows[0].status,"received");
    const verifiedPrivacyRequest=await pool.query(
      "select * from public.verify_discovery_privacy_request($1,$2,$3,'manual_document_check',true)",
      [companyId,actorId,privacyRequestId]
    );
    assert.equal(verifiedPrivacyRequest.rows[0].status,"verified");
    const contactSubject=await pool.query(
      "select * from public.attach_discovery_privacy_request_subject($1,$2,$3,'discovery_contact_points',$4)",
      [companyId,actorId,privacyRequestId,privacyContact.rows[0].id]
    );
    const personSubject=await pool.query(
      "select * from public.attach_discovery_privacy_request_subject($1,$2,$3,'discovery_professional_people',$4)",
      [companyId,actorId,privacyRequestId,privacyPerson.rows[0].id]
    );
    await assert.rejects(
      pool.query(
        "select * from public.attach_discovery_privacy_request_subject($1,$2,$3,'discovery_contact_points',$4)",
        [companyId,viewerId,privacyRequestId,privacyContact.rows[0].id]
      ),
      /Only a company owner\/admin/
    );
    const erasedContact=await pool.query(
      "select * from public.apply_discovery_privacy_subject_action($1,$2,$3,$4,'erase','verified_request')",
      [companyId,actorId,privacyRequestId,contactSubject.rows[0].id]
    );
    assert.equal(erasedContact.rows[0].resolution_state,"erased");
    const erasedPerson=await pool.query(
      "select * from public.apply_discovery_privacy_subject_action($1,$2,$3,$4,'erase','verified_request')",
      [companyId,actorId,privacyRequestId,personSubject.rows[0].id]
    );
    assert.equal(erasedPerson.rows[0].resolution_state,"erased");
    const completedPrivacyRequest=await pool.query(
      "select * from public.complete_discovery_privacy_request($1,$2,$3,false)",
      [companyId,actorId,privacyRequestId]
    );
    assert.equal(completedPrivacyRequest.rows[0].status,"fulfilled");
    const erasedPersonalRecords=await pool.query(
      "select (select count(*)::int from public.discovery_professional_people where company_id=$1 and id=$2) as people, (select count(*)::int from public.discovery_contact_points where company_id=$1 and id=$3) as contacts",
      [companyId,privacyPerson.rows[0].id,privacyContact.rows[0].id]
    );
    assert.equal(erasedPersonalRecords.rows[0].people,0);
    assert.equal(erasedPersonalRecords.rows[0].contacts,0);
    const retainedRoleHistory=await pool.query(
      "select count(*)::int as count,count(*) filter(where professional_person_id is null)::int as detached from public.discovery_professional_role_assignments where company_id=$1 and role_title='Chief Financial Officer'",
      [companyId]
    );
    assert.equal(retainedRoleHistory.rows[0].count,1,"E14 keeps non-identifying professional role history");
    assert.equal(retainedRoleHistory.rows[0].detached,1,"E14 removes the link to the erased professional identity");
    const retainedPrivacyReceipt=await pool.query(
      "select count(*)::int as count from public.discovery_privacy_events where company_id=$1 and request_id=$2 and event_type='subject_erased'",
      [companyId,privacyRequestId]
    );
    assert.equal(retainedPrivacyReceipt.rows[0].count,2,"E14 writes immutable receipts for both erasure actions");
    const retainedE13ContactLineage=await pool.query(
      "select count(*)::int as count from public.discovery_field_provenance where company_id=$1 and subject_kind='contact_point' and subject_id=$2",
      [companyId,privacyContact.rows[0].id]
    );
    assert.equal(retainedE13ContactLineage.rows[0].count,1,"E13 non-content provenance remains after E14 erasure");
    await assert.rejects(
      pool.query("update public.discovery_privacy_events set reason_code='none' where request_id=$1",[privacyRequestId]),
      /immutable/
    );


    // E15: only owner/admin-accepted eligible matches create company leads.
    const leadMatch=await pool.query(
      `insert into public.discovery_match_results(
        company_id,canonical_entity_id,workspace_key,criteria_version,criteria_snapshot,
        candidate_snapshot,score,confidence,eligible,method,positive_factors,
        negative_factors,unknown_criteria,blockers,created_by
      ) values($1,$2,'startup','E15-integration-v1','{"ticket":{"min":1,"max":10}}'::jsonb,
        '{"legal_name":"E15 Integration Company","jurisdiction":"IN","entity_type":"company"}'::jsonb,
        86.5,0.85,true,'deterministic_weighted_rules_v1',
        '[{"criterion":"type","reason":"Company type aligns."}]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,$3
      ) returning id`,
      [companyId,canonical.rows[0].id,actorId]
    );
    const matchReview=await pool.query(
      "select public.record_discovery_match_review($1,$2,$3,'accepted_for_review','match_confirmed') as result",
      [companyId,actorId,leadMatch.rows[0].id]
    );
    const matchReviewResult=matchReview.rows[0].result;
    assert.equal(matchReviewResult.review.decision,"accepted_for_review");
    assert.ok(matchReviewResult.lead.id,"E15 accepted match creates a lead");
    const leadId=matchReviewResult.lead.id;
    const acceptedMatch=await pool.query(
      "select review_state from public.discovery_match_results where company_id=$1 and id=$2",
      [companyId,leadMatch.rows[0].id]
    );
    assert.equal(acceptedMatch.rows[0].review_state,"accepted_for_review");
    const createdLead=await pool.query(
      "select * from public.discovery_leads where company_id=$1 and id=$2",
      [companyId,leadId]
    );
    assert.equal(createdLead.rows[0].status,"inbox");

    assert.equal(createdLead.rows[0].workspace_key,"startup");

    // E19: source-backed E13 lineage automatically opens a cross-stage verification case.
    const verificationClient=await pool.connect();
    try{
      await verificationClient.query("select set_config('request.jwt.claim.sub',$1,false)",[actorId]);
      const verificationCase=await verificationClient.query(
        "select * from public.discovery_verification_inbox where company_id=$1 and subject_kind='canonical_entity' and subject_id=$2",
        [companyId,canonical.rows[0].id]
      );
      assert.equal(verificationCase.rows.length,1,"E19 must backfill/open a case for an existing canonical-entity provenance subject");
      const e19=verificationCase.rows[0];
      assert.ok(e19.evidence_count>=1);
      assert.ok(e19.supporting_evidence_count>=1);
      assert.ok(e19.confidence_index>=40&&e19.confidence_index<=100);
      assert.ok(e19.independent_source_count>=1);

      await verificationClient.query(
        "insert into public.discovery_provenance_events(company_id,subject_kind,subject_id,event_type,source_id,evidence_content_hash,source_name_snapshot,source_domain_snapshot,origin_table,origin_record_id,actor_user_id,event_metadata) values($1,'canonical_entity',$2,'source_observed',$3,$4,'Example registry initial verification fixture','registry.example.gov.in','discovery_audit_events','99999999-9999-4999-8999-999999999990',$5,'{\"verification_fixture\":true}'::jsonb)",
        [companyId,canonical.rows[0].id,sourceId,"c".repeat(64),actorId]
      );
      const e19Refs=await verificationClient.query(
        "select id,provenance_event_id from public.discovery_verification_evidence where company_id=$1 and case_id=$2 order by occurred_at",
        [companyId,e19.id]
      );
      assert.ok(e19Refs.rows.length>=1);
      await verificationClient.query(
        "select public.record_discovery_verification_evidence_classification($1,$2,$3,'context','This provenance event is contextual history, not independent support.')",
        [companyId,e19.id,e19Refs.rows[0].provenance_event_id]
      );
      const afterClassify=await verificationClient.query(
        "select supporting_evidence_count,confidence_index from public.discovery_verification_inbox where company_id=$1 and id=$2",
        [companyId,e19.id]
      );
      assert.ok(afterClassify.rows[0].supporting_evidence_count>=0);

      await verificationClient.query(
        "select public.record_discovery_verification_review($1,$2,'in_review','Owner begins the evidence review.')",
        [companyId,e19.id]
      );
      await verificationClient.query(
        "select public.record_discovery_verification_review($1,$2,'verified','Source-backed identity evidence was reviewed and cross-checked.')",
        [companyId,e19.id]
      );
      const verifiedCase=await verificationClient.query(
        "select status from public.discovery_verification_cases where company_id=$1 and id=$2",
        [companyId,e19.id]
      );
      assert.equal(verifiedCase.rows[0].status,"verified");

      // New provenance reopens a verified case instead of leaving a stale approval in place.
      await verificationClient.query(
        "insert into public.discovery_provenance_events(company_id,subject_kind,subject_id,event_type,source_id,evidence_content_hash,source_name_snapshot,source_domain_snapshot,origin_table,origin_record_id,actor_user_id,event_metadata) values($1,'canonical_entity',$2,'source_observed',$3,$4,'Example registry second observation','registry.example.gov.in','discovery_audit_events','99999999-9999-4999-8999-999999999991',$5,'{\"verification_fixture\":true}'::jsonb)",
        [companyId,canonical.rows[0].id,sourceId,"d".repeat(64),actorId]
      );
      const reopenedCase=await verificationClient.query(
        "select status from public.discovery_verification_cases where company_id=$1 and id=$2",
        [companyId,e19.id]
      );
      assert.equal(reopenedCase.rows[0].status,"pending_review","new source-backed provenance must reopen a prior verified decision");
      const reopenedReceipt=await verificationClient.query(
        "select count(*)::int as count from public.discovery_verification_events where company_id=$1 and case_id=$2 and event_type='case_reopened_after_new_evidence'",
        [companyId,e19.id]
      );
      assert.equal(reopenedReceipt.rows[0].count,1);

      await verificationClient.query("select set_config('request.jwt.claim.sub',$1,false)",[viewerId]);
      await assert.rejects(
        verificationClient.query(
          "select public.record_discovery_verification_review($1,$2,'rejected','Viewer must not decide a case.')",
          [companyId,e19.id]
        ),
        /Only company owners\/admins can decide verification cases/
      );
    } finally { verificationClient.release(); }

    await assert.rejects(
      pool.query(
        "select public.record_discovery_match_review($1,$2,$3,'accepted_for_review','match_confirmed')",
        [companyId,actorId,leadMatch.rows[0].id]
      ),
      /already reviewed/
    );
    await assert.rejects(
      pool.query(
        "select public.assign_discovery_lead($1,$2,$3,$4,'assignment_change')",
        [companyId,actorId,leadId,"00000000-0000-4000-8000-000000000099"]
      ),
      /assignee must be a member/
    );
    const assignedLead=await pool.query(
      "select * from public.assign_discovery_lead($1,$2,$3,$4,'assignment_change')",
      [companyId,actorId,leadId,viewerId]
    );
    assert.equal(assignedLead.rows[0].assigned_to,viewerId);
    const assignedEvent=await pool.query(
      "select previous_assignee_id,new_assignee_id from public.discovery_lead_events where company_id=$1 and lead_id=$2 and event_type='lead_assigned' order by occurred_at desc limit 1",
      [companyId,leadId]
    );
    assert.equal(assignedEvent.rows[0].previous_assignee_id,null);
    assert.equal(assignedEvent.rows[0].new_assignee_id,viewerId);
    await assert.rejects(
      pool.query(
        "select public.transition_discovery_lead($1,$2,$3,'won','deal_won')",
        [companyId,actorId,leadId]
      ),
      /stage transition is not allowed/
    );
    const reviewingLead=await pool.query(
      "select * from public.transition_discovery_lead($1,$2,$3,'reviewing','stage_progress')",
      [companyId,actorId,leadId]
    );
    assert.equal(reviewingLead.rows[0].status,"reviewing");
    const qualifiedLead=await pool.query(
      "select * from public.transition_discovery_lead($1,$2,$3,'qualified','stage_progress')",
      [companyId,actorId,leadId]
    );
    assert.equal(qualifiedLead.rows[0].status,"qualified");
    const priorityLead=await pool.query(
      "select * from public.set_discovery_lead_priority($1,$2,$3,'high')",
      [companyId,actorId,leadId]
    );
    assert.equal(priorityLead.rows[0].priority,"high");
    const actionDueAt=new Date(Date.now()+7*86400000).toISOString();
    const actionLead=await pool.query(
      "select * from public.set_discovery_lead_next_action($1,$2,$3,'review_evidence',$4)",
      [companyId,actorId,leadId,actionDueAt]
    );
    assert.equal(actionLead.rows[0].next_action_code,"review_evidence");
    assert.ok(actionLead.rows[0].next_action_due_at);
    await pool.query(
      "select public.transition_discovery_lead($1,$2,$3,'due_diligence','stage_progress')",
      [companyId,actorId,leadId]
    );
    await pool.query(
      "select public.transition_discovery_lead($1,$2,$3,'proposal','stage_progress')",
      [companyId,actorId,leadId]
    );
    const wonLead=await pool.query(
      "select * from public.transition_discovery_lead($1,$2,$3,'won','deal_won')",
      [companyId,actorId,leadId]
    );
    assert.equal(wonLead.rows[0].status,"won");
    assert.ok(wonLead.rows[0].closed_at);
    const reopenedLead=await pool.query(
      "select * from public.transition_discovery_lead($1,$2,$3,'reviewing','reopened')",
      [companyId,actorId,leadId]
    );
    assert.equal(reopenedLead.rows[0].status,"reviewing");
    assert.equal(reopenedLead.rows[0].closed_at,null);
    const leadHistory=await pool.query(
      "select count(*)::int as count from public.discovery_lead_events where company_id=$1 and lead_id=$2",
      [companyId,leadId]
    );
    assert.ok(leadHistory.rows[0].count>=7);
    const leadProvenance=await pool.query(
      "select count(*)::int as count from public.discovery_provenance_events where company_id=$1 and subject_kind='lead' and subject_id=$2 and event_type in ('lead_created','lead_assigned','lead_status_changed','lead_priority_changed','lead_next_action_set')",
      [companyId,leadId]
    );
    assert.ok(leadProvenance.rows[0].count>=7,"E15 workflow actions must append E13 provenance");
    await assert.rejects(
      pool.query("update public.discovery_lead_events set reason_code='stage_progress' where lead_id=$1",[leadId]),
      /immutable/
    );
    await assert.rejects(
      pool.query("update public.discovery_lead_match_reviews set reason_code='other_review' where match_result_id=$1",[leadMatch.rows[0].id]),
      /immutable/
    );

    const rejectedMatch=await pool.query(
      `insert into public.discovery_match_results(
        company_id,canonical_entity_id,workspace_key,criteria_version,criteria_snapshot,
        candidate_snapshot,score,confidence,eligible,method,created_by
      ) values($1,$2,'startup','E15-reject-v1','{}'::jsonb,'{"legal_name":"Reject Fixture"}'::jsonb,
        22,0.3,false,'deterministic_weighted_rules_v1',$3) returning id`,
      [companyId,canonical.rows[0].id,actorId]
    );
    await assert.rejects(
      pool.query(
        "select public.record_discovery_match_review($1,$2,$3,'accepted_for_review','match_confirmed')",
        [companyId,actorId,rejectedMatch.rows[0].id]
      ),
      /ineligible matches cannot enter/
    );
    const rejectedReview=await pool.query(
      "select public.record_discovery_match_review($1,$2,$3,'rejected','out_of_scope') as result",
      [companyId,actorId,rejectedMatch.rows[0].id]
    );
    assert.equal(rejectedReview.rows[0].result.review.decision,"rejected");
    assert.equal(rejectedReview.rows[0].result.lead,null);
    const rejectedLeadCount=await pool.query(
      "select count(*)::int as count from public.discovery_leads where company_id=$1 and match_result_id=$2",
      [companyId,rejectedMatch.rows[0].id]
    );
    assert.equal(rejectedLeadCount.rows[0].count,0,"Rejected matches must not create leads");

    const heartbeat = await pool.query("select public.heartbeat_discovery_job($1,$2,90) as ok", [activeJob.id, activeJob.lease_owner]);
    assert.equal(heartbeat.rows[0].ok, true);

    await pool.query("select * from public.set_discovery_company_worker_grant($1,$2,false,$3)", [companyId, actorId, "integration kill-switch test"]);
    await pool.query(
      "insert into public.discovery_canonical_entities(company_id,entity_kind,legal_name,normalized_name,jurisdiction,entity_type,status,source_evidence_id,created_by) values($1,'organization','Worker Grant Disabled Ltd','worker grant disabled','IN','company','active',$2,$3)",
      [companyId,evidenceId,actorId]);
    const dedupNoClaim=await pool.query(
      "select * from public.claim_discovery_deduplication_job($1,90)",["deduplication-worker-disabled"]);
    assert.equal(dedupNoClaim.rows.length,0,"E12 claim must be blocked when the company worker grant is disabled");
    const revokedHeartbeat = await pool.query("select public.heartbeat_discovery_job($1,$2,90) as ok", [activeJob.id, activeJob.lease_owner]);
    assert.equal(revokedHeartbeat.rows[0].ok, false, "revoked company grant must stop active workers");
    await assert.rejects(
      pool.query("select * from public.reserve_discovery_fetch_request($1,$2,$3,$4)", [companyId, sourceId, activeJob.id, activeJob.lease_owner]),
      /lease, profile, source link or worker enablement/
    );
    const noClaim = await pool.query("select * from public.claim_enabled_discovery_job($1,90)", ["worker-test-three"]);
    assert.equal(noClaim.rows.length, 0, "disabled company grant must prevent new claims");
  } finally {
    await pool.end();
  }
});
