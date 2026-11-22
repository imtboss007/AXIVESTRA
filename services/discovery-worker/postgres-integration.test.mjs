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
      create table if not exists public.company_memberships(
        company_id uuid not null references public.companies(id),
        user_id uuid not null references auth.users(id),
        role text not null,
        primary key(company_id,user_id)
      );
      create or replace function public.is_company_member(p_company_id uuid)
      returns boolean language sql stable as $ select true $;
    `);

    const sourceMigration = await readFile(new URL("../../supabase/migrations/20261122150000_discovery_source_governance.sql", import.meta.url), "utf8");
    const queueMigration = await readFile(new URL("../../supabase/migrations/20261122170000_discovery_durable_queue.sql", import.meta.url), "utf8");
    const fetchMigration = await readFile(new URL("../../supabase/migrations/20261122180000_discovery_fetch_evidence.sql", import.meta.url), "utf8");
    await pool.query(sourceMigration);
    await pool.query(queueMigration);
    await pool.query(fetchMigration);

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
        terms_url,license_ref,allowed_purposes,allowed_fields,allowed_paths,access_method,
        rate_limit_per_minute,max_pages_per_job,retention_days,attribution,legal_basis,
        status,reviewed_by,reviewed_at,created_by,updated_by
      ) values (
        $1,$2,'Example registry','https://registry.example.gov.in/api','registry.example.gov.in',
        'official_api','official_api','IN','https://registry.example.gov.in/terms','Reviewed terms',
        array['company identity verification'],array['legal_name'],array['/api/v1/entities'],
        'official_api',1,10,30,'Source attribution','Approved public company registry use',
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
    const profileSnapshot = await pool.query("select updated_at from public.discovery_profiles where id=$1", [profileId]);
    const sourceSnapshot = await pool.query("select updated_at from public.discovery_source_registry where id=$1", [sourceId]);
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
    await pool.query(`
      insert into public.discovery_evidence_items(
        id,company_id,job_id,source_id,canonical_url,captured_at,content_hash,raw_blob_ref,
        content_type,byte_length,attribution,jurisdiction,licence_snapshot,response_metadata
      ) values($1,$2,$3,$4,'https://registry.example.gov.in/api/v1/entities/1',now()-interval '2 days',
        repeat('a',64),'discovery-evidence:company/job/evidence.bin',
        'application/json',12,'Example registry','IN','{}'::jsonb,'{}'::jsonb)
    `, [evidenceId, companyId, activeJob.id, sourceId]);
    await pool.query("update public.discovery_source_registry set retention_days=1 where id=$1", [sourceId]);
    const expiredEvidence = await pool.query("select id from public.list_expired_discovery_evidence(50) where id=$1", [evidenceId]);
    assert.equal(expiredEvidence.rows.length, 1, "per-source evidence retention is enforced by PostgreSQL");
    await pool.query(`
      insert into public.discovery_fetch_events(company_id,job_id,source_id,evidence_id,event_type,url,outcome)
      values($1,$2,$3,$4,'response_received','https://registry.example.gov.in/api/v1/entities/1','stored')
    `, [companyId, activeJob.id, sourceId, evidenceId]);
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

    const heartbeat = await pool.query("select public.heartbeat_discovery_job($1,$2,90) as ok", [activeJob.id, activeJob.lease_owner]);
    assert.equal(heartbeat.rows[0].ok, true);

    await pool.query("select * from public.set_discovery_company_worker_grant($1,$2,false,$3)", [companyId, actorId, "integration kill-switch test"]);
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
