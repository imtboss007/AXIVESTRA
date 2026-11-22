import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  buildContactCandidate, keyFromBase64
} from "./contact-validation.mjs";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("Missing E08 worker environment variable: " + name);
  return value;
}

function createAdmin() {
  return createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { "X-AXIVESTRA-Worker": "discovery-contact-validation-worker" } }
  });
}

export async function loadContactValidationInputs(admin, job, keys) {
  const [runResult, evidenceResult, sourceResult, factsResult, entitiesResult] = await Promise.all([
    admin.from("discovery_extraction_runs")
      .select("id,evidence_id,source_id,status,source_content_hash")
      .eq("company_id", job.company_id).eq("id", job.extraction_run_id).maybeSingle(),
    admin.from("discovery_evidence_items")
      .select("id,content_hash")
      .eq("company_id", job.company_id).eq("id", job.evidence_id).maybeSingle(),
    admin.from("discovery_source_registry")
      .select("id,status,allowed_fields,field_schema")
      .eq("company_id", job.company_id).eq("id", job.source_id).maybeSingle(),
    admin.from("discovery_extracted_facts")
      .select("id,extracted_entity_id,field_name,value_type,raw_value,validation_status,source_span,confidence")
      .eq("company_id", job.company_id).eq("extraction_run_id", job.extraction_run_id)
      .in("value_type", ["email", "phone"]),
    admin.from("discovery_extracted_entities")
      .select("id,entity_kind")
      .eq("company_id", job.company_id).eq("extraction_run_id", job.extraction_run_id)
  ]);
  for (const result of [runResult,evidenceResult,sourceResult,factsResult,entitiesResult]) {
    if (result.error) throw new Error("E08 input query failed: " + result.error.message);
  }

  const run = runResult.data;
  const evidence = evidenceResult.data;
  const source = sourceResult.data;
  if (!run || !evidence || !source || run.evidence_id !== evidence.id ||
      run.source_id !== job.source_id || run.source_content_hash !== evidence.content_hash ||
      run.status !== "completed" && run.status !== "completed_with_warnings") {
    throw new Error("E08 extraction run does not match immutable source evidence.");
  }
  if (source.status !== "approved" ||
      JSON.stringify(source.field_schema || {}) !== JSON.stringify(job.field_schema_snapshot || {}) ||
      JSON.stringify(source.allowed_fields || []) !== JSON.stringify(job.allowed_fields_snapshot || [])) {
    throw new Error("E08 source approval or exact contact-field schema changed; refusing contact processing.");
  }

  const entities = new Map((entitiesResult.data || []).map(entity => [entity.id, entity]));
  const candidates = [];
  for (const fact of factsResult.data || []) {
    const entity = entities.get(fact.extracted_entity_id);
    if (!entity) continue;
    const candidate = buildContactCandidate({
      fact,
      entity,
      fieldSchema: job.field_schema_snapshot || {},
      allowedFields: job.allowed_fields_snapshot || [],
      evidenceId: evidence.id,
      encryptionKey: keys.encryptionKey,
      fingerprintKey: keys.fingerprintKey
    });
    if (candidate) candidates.push(candidate);
    if (candidates.length > 500) throw new Error("E08 contact candidate count exceeds the approved batch limit.");
  }
  return { candidates };
}

export async function runContactValidationWorkerOnce(admin, workerId, keys) {
  const { data: claimed, error: claimError } = await admin.rpc("claim_discovery_contact_validation_job", {
    p_worker_id: workerId, p_lease_seconds: 90
  });
  if (claimError) throw new Error("Could not claim E08 work: " + claimError.message);
  const job = Array.isArray(claimed) ? claimed[0] : claimed;
  if (!job) return false;

  let heartbeatBusy = false;
  let leaseLost = false;
  const heartbeatTimer = setInterval(async () => {
    if (heartbeatBusy || leaseLost) return;
    heartbeatBusy = true;
    try {
      const { data, error } = await admin.rpc("heartbeat_discovery_contact_validation_job", {
        p_job_id: job.id, p_worker_id: workerId, p_lease_seconds: 90
      });
      if (error || data !== true) leaseLost = true;
    } catch {
      leaseLost = true;
    } finally {
      heartbeatBusy = false;
    }
  }, 20_000);

  try {
    const input = await loadContactValidationInputs(admin, job, keys);
    if (leaseLost) throw new Error("E08 lease or source approval was revoked.");
    const { data, error } = await admin.rpc("complete_discovery_contact_validation_job", {
      p_job_id: job.id, p_worker_id: workerId, p_candidates: input.candidates
    });
    if (error) throw new Error("E08 candidate commit failed: " + error.message);
    if (leaseLost) throw new Error("E08 lease was lost before completion.");
    console.info("AXIVESTRA E08 contact candidates recorded:", JSON.stringify({
      jobId: job.id, candidates: input.candidates.length, committedCandidates: data
    }));
  } catch (error) {
    const { error: failError } = await admin.rpc("fail_discovery_contact_validation_job", {
      p_job_id: job.id,
      p_worker_id: workerId,
      p_error_code: String(error?.code || "CONTACT_VALIDATION_FAILED").slice(0,100),
      p_error_message: String(error?.message || "E08 contact validation failed.").slice(0,1000)
    });
    if (failError) console.error("Could not record E08 failure:", failError.message);
  } finally {
    clearInterval(heartbeatTimer);
  }
  return true;
}

export async function runContactValidationWorker() {
  if (process.env.DISCOVERY_CONTACT_VALIDATION_WORKER_ENABLED !== "true") {
    console.info("AXIVESTRA E08 contact-validation worker disabled by default.");
    return;
  }
  const keys = {
    encryptionKey: keyFromBase64(requiredEnv("DISCOVERY_CONTACT_ENCRYPTION_KEY"), "DISCOVERY_CONTACT_ENCRYPTION_KEY"),
    fingerprintKey: keyFromBase64(requiredEnv("DISCOVERY_CONTACT_FINGERPRINT_KEY"), "DISCOVERY_CONTACT_FINGERPRINT_KEY")
  };
  const admin = createAdmin();
  const workerId = process.env.AXIVESTRA_CONTACT_VALIDATION_WORKER_ID ||
    ("axivestra-contact-validation-" + randomUUID());
  const pollMs = Math.max(1000, Math.min(30_000,
    Number(process.env.DISCOVERY_CONTACT_VALIDATION_POLL_MS || 5000)));
  let stopping = false;
  process.once("SIGINT", () => { stopping = true; });
  process.once("SIGTERM", () => { stopping = true; });
  console.info("AXIVESTRA E08 deterministic contact validator started; no external validator or network call is enabled.");
  while (!stopping) {
    try {
      const didWork = await runContactValidationWorkerOnce(admin, workerId, keys);
      if (!didWork) await sleep(pollMs);
    } catch (error) {
      console.error("AXIVESTRA E08 worker failed closed:", String(error?.message || error));
      await sleep(pollMs);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runContactValidationWorker().catch(error => {
    console.error("AXIVESTRA E08 worker stopped:", String(error?.message || error));
    process.exitCode = 1;
  });
}
