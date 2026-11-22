import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { extractStructuredFacts, EXTRACTOR_VERSION } from "./extractor.mjs";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("Missing required extraction worker environment variable: " + name);
  return value;
}

function createAdmin() {
  return createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { "X-AXIVESTRA-Worker": "discovery-extraction-worker" } }
  });
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new Error("Extraction worker lease was lost or execution was stopped.");
}

function evidenceObjectPath(reference) {
  const prefix = "discovery-evidence:";
  if (typeof reference !== "string" || !reference.startsWith(prefix)) {
    throw new Error("Evidence object reference is outside the private discovery evidence bucket.");
  }
  const path = reference.slice(prefix.length);
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}-[a-f0-9]{64}\.bin$/.test(path)) {
    throw new Error("Evidence object path does not match the expected company/job/content-hash structure.");
  }
  return path;
}

async function loadContext(admin, job) {
  const [{ data: evidence, error: evidenceError }, { data: source, error: sourceError }, { data: discoveryJob, error: jobError }] = await Promise.all([
    admin.from("discovery_evidence_items").select("*")
      .eq("company_id", job.company_id).eq("id", job.evidence_id).maybeSingle(),
    admin.from("discovery_source_registry").select("*")
      .eq("company_id", job.company_id).eq("id", job.source_id).maybeSingle(),
    admin.from("discovery_jobs").select("id,profile_id,source_id,status,payload")
      .eq("company_id", job.company_id).eq("id", job.evidence_id ? (job.discovery_job_id || "") : "").maybeSingle()
  ]);
  if (evidenceError) throw evidenceError;
  if (sourceError) throw sourceError;
  if (jobError) throw jobError;
  if (!evidence || !source) throw new Error("Extraction evidence or registered source could not be confirmed.");
  if (source.status !== "approved") throw new Error("Extraction stopped because source approval is no longer active.");
  if (evidence.job_id !== job.discovery_job_id) throw new Error("Evidence is not linked to the queued discovery job.");
  return { evidence, source, discoveryJob };
}

async function executeJob(admin, job, workerId, signal) {
  throwIfAborted(signal);
  const [{ data: evidence, error: evidenceError }, { data: source, error: sourceError }] = await Promise.all([
    admin.from("discovery_evidence_items").select("*")
      .eq("company_id", job.company_id).eq("id", job.evidence_id).maybeSingle(),
    admin.from("discovery_source_registry").select("*")
      .eq("company_id", job.company_id).eq("id", job.source_id).maybeSingle()
  ]);
  if (evidenceError) throw evidenceError;
  if (sourceError) throw sourceError;
  if (!evidence || !source) throw new Error("Extraction evidence or source is missing.");
  if (source.status !== "approved") throw new Error("Extraction source is no longer approved.");
  if (evidence.job_id !== job.discovery_job_id) throw new Error("Evidence is not linked to the expected discovery job.");
  if (!Array.isArray(source.allowed_fields) || source.allowed_fields.length === 0) {
    throw new Error("Source has no approved extraction fields. No output will be produced.");
  }

  const objectPath = evidenceObjectPath(evidence.raw_blob_ref);
  const { data: download, error: downloadError } = await admin.storage
    .from("discovery-evidence").download(objectPath);
  if (downloadError || !download) throw new Error("Private evidence snapshot could not be downloaded: " + (downloadError?.message || "unknown error"));
  const bytes = Buffer.from(await download.arrayBuffer());
  if (bytes.length !== Number(evidence.byte_length) || bytes.length > 5_000_000) {
    throw new Error("Private evidence snapshot length does not match immutable evidence metadata.");
  }
  throwIfAborted(signal);

  const result = await extractStructuredFacts({
    bytes,
    contentType: evidence.content_type,
    source,
    contentHash: evidence.content_hash
  });
  throwIfAborted(signal);

  const { data: runId, error: commitError } = await admin.rpc("complete_discovery_extraction", {
    p_job_id: job.id,
    p_worker_id: workerId,
    p_run: {
      extractor_version: EXTRACTOR_VERSION,
      schema_hash: result.schemaHash,
      invalid_fact_count: result.invalidFactCount || 0,
      warnings: result.warnings || [],
      source_content_hash: evidence.content_hash
    },
    p_entities: result.entities || [],
    p_facts: result.facts || []
  });
  if (commitError) throw new Error("Atomic extraction result commit failed: " + commitError.message);
  return { runId: typeof runId === "string" ? runId : runId?.id, facts: result.facts.length, entities: result.entities.length, warnings: result.warnings };
}

export async function runExtractionWorkerOnce(admin, workerId) {
  const { data: claimed, error: claimError } = await admin.rpc("claim_discovery_extraction_job", {
    p_worker_id: workerId,
    p_lease_seconds: 90
  });
  if (claimError) throw new Error("Could not claim extraction queue work: " + claimError.message);
  const job = Array.isArray(claimed) ? claimed[0] : claimed;
  if (!job) return false;

  const controller = new AbortController();
  let heartbeatBusy = false;
  const heartbeatTimer = setInterval(async () => {
    if (heartbeatBusy || controller.signal.aborted) return;
    heartbeatBusy = true;
    try {
      const { data, error } = await admin.rpc("heartbeat_discovery_extraction_job", {
        p_job_id: job.id, p_worker_id: workerId, p_lease_seconds: 90
      });
      if (error || data !== true) controller.abort(new Error("Extraction lease or source approval is no longer valid."));
    } catch {
      controller.abort(new Error("Extraction worker heartbeat failed; stopping this job."));
    } finally {
      heartbeatBusy = false;
    }
  }, 20_000);

  try {
    const result = await executeJob(admin, job, workerId, controller.signal);
    if (controller.signal.aborted) throw new Error("Extraction worker lease was lost before completion.");
    console.info("AXIVESTRA extraction completed:", JSON.stringify({
      jobId: job.id, runId: result.runId, entities: result.entities, facts: result.facts,
      warnings: result.warnings.length
    }));
  } catch (error) {
    const message = String(error?.message || "Extraction worker failed.").slice(0, 1000);
    const code = String(error?.code || "DETERMINISTIC_EXTRACTION_FAILED").slice(0, 100);
    const { error: failError } = await admin.rpc("fail_discovery_extraction_job", {
      p_job_id: job.id, p_worker_id: workerId, p_error_code: code, p_error_message: message
    });
    if (failError) console.error("Could not record extraction failure against live lease:", failError.message);
  } finally {
    clearInterval(heartbeatTimer);
  }
  return true;
}

export async function runExtractionWorker() {
  if (process.env.DISCOVERY_EXTRACTION_WORKER_ENABLED !== "true") {
    console.info("AXIVESTRA extraction worker disabled: DISCOVERY_EXTRACTION_WORKER_ENABLED is not true.");
    return;
  }
  const admin = createAdmin();
  const workerId = process.env.AXIVESTRA_EXTRACTION_WORKER_ID || ("axivestra-extract-" + randomUUID());
  const pollMs = Math.max(1000, Math.min(30_000, Number(process.env.DISCOVERY_EXTRACTION_POLL_MS || 5000)));
  let stopping = false;
  process.once("SIGINT", () => { stopping = true; });
  process.once("SIGTERM", () => { stopping = true; });
  console.info("AXIVESTRA deterministic extraction worker started. It performs no network access and no LLM calls.");
  while (!stopping) {
    try {
      const didWork = await runExtractionWorkerOnce(admin, workerId);
      if (!didWork) await sleep(pollMs);
    } catch (error) {
      console.error("AXIVESTRA extraction worker poll failed closed:", String(error?.message || error));
      await sleep(pollMs);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runExtractionWorker().catch(error => {
    console.error("AXIVESTRA extraction worker stopped:", error);
    process.exitCode = 1;
  });
}
