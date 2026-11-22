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
      returns boolean language sql stable as $$ select true $$;
    `);

    const sourceMigration = await readFile(new URL("../../supabase/migrations/20261122150000_discovery_source_governance.sql", import.meta.url), "utf8");
    const queueMigration = await readFile(new URL("../../supabase/migrations/20261122170000_discovery_durable_queue.sql", import.meta.url), "utf8");
    const fetchMigration = await readFile(new URL("../../supabase/migrations/20261122180000_discovery_fetch_evidence.sql", import.meta.url), "utf8");
    const extractionMigration = await readFile(new URL("../../supabase/migrations/20261122190000_discovery_extraction.sql", import.meta.url), "utf8");
    const entityIntelligenceMigration = await readFile(new URL("../../supabase/migrations/20261122200000_discovery_entity_intelligence.sql", import.meta.url), "utf8");
    const professionalRolesMigration = await readFile(new URL("../../supabase/migrations/20261122210000_discovery_professional_roles.sql", import.meta.url), "utf8");
    const contactValidationMigration = await readFile(new URL("../../supabase/migrations/20261122220000_discovery_contact_validation.sql", import.meta.url), "utf8");
    await pool.query(sourceMigration);
    await pool.query(queueMigration);
    await pool.query(fetchMigration);
    await pool.query(extractionMigration);
    await pool.query(entityIntelligenceMigration);
    await pool.query(professionalRolesMigration);
    await pool.query(contactValidationMigration);

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
        array['company identity verification'],array['legal_name','registration_id','status','work_email','work_phone'],
        '{"legal_name":{"type":"string","aliases":["legal_name"],"required":true,"entityKind":"organization"},"registration_id":{"type":"identifier","aliases":["registration_id"]},"status":{"type":"string","aliases":["status"]},"work_email":{"type":"email","aliases":["work_email"]},"work_phone":{"type":"phone","aliases":["work_phone"]}}'::jsonb,
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
            work_phone: { type: "phone", aliases: ["work_phone"] }
          },
          source_allowed_fields_snapshot: ["legal_name","registration_id","status","work_email","work_phone"],
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
    assert.equal(extractedFact.rows.length, 4);
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
    await pool.query(
      "insert into public.discovery_extracted_facts(company_id,extraction_run_id,evidence_id,extracted_entity_id,field_name,value_type,raw_value,normalized_value,source_span,confidence,validation_status) values ($1,$2,$3,$4,'job_title','string','Chief Financial Officer',to_jsonb('Chief Financial Officer'::text),'{\"kind\":\"html-text\",\"start\":30,\"end\":53}'::jsonb,0.94,'valid'),($1,$2,$3,$4,'employer_entity_id','identifier',$5,to_jsonb($5::text),'{\"kind\":\"json-pointer\",\"locator\":\"$/officers/0/company\"}'::jsonb,0.91,'valid')",
      [companyId,extractionRunId,evidenceId,personMentionId,extractedEntity.rows[0].id]
    );
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
              work_phone: { type: "phone", aliases: ["work_phone"] }
            },
            source_allowed_fields_snapshot: ["legal_name","registration_id","status","work_email","work_phone"],
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
      "select count(*)::int as count from public.discovery_entity_assignments where company_id=$1 and canonical_entity_id=$2",
      [companyId,durableEntity.rows[0].id]
    );
    assert.equal(durableAssignment.rows[0].count,1,"owner-approved assignment must survive evidence purge");
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
