import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { buildEntityResolutionCandidates } from "./entity-resolution.mjs";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("Missing required entity-resolution worker environment variable: " + name);
  return value;
}

function createAdmin() {
  return createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { "X-AXIVESTRA-Worker": "discovery-entity-resolution-worker" } }
  });
}

async function loadInputs(admin, job) {
  const [runResult, evidenceResult, entitiesResult, factsResult, canonicalResult] = await Promise.all([
    admin.from("discovery_extraction_runs").select("id,evidence_id,source_id,status,source_content_hash")
      .eq("company_id", job.company_id).eq("id", job.extraction_run_id).maybeSingle(),
    admin.from("discovery_evidence_items").select("id,jurisdiction,content_hash")
      .eq("company_id", job.company_id).eq("id", job.evidence_id).maybeSingle(),
    admin.from("discovery_extracted_entities").select("id,entity_kind,raw_name,normalized_name")
      .eq("company_id", job.company_id).eq("extraction_run_id", job.extraction_run_id)
      .eq("entity_kind", "organization"),
    admin.from("discovery_extracted_facts").select("id,extracted_entity_id,field_name,raw_value,normalized_value,validation_status,source_span")
      .eq("company_id", job.company_id).eq("extraction_run_id", job.extraction_run_id),
    admin.from("discovery_canonical_entities").select("id,entity_kind,status,jurisdiction,legal_name,normalized_name")
      .eq("company_id", job.company_id).eq("entity_kind", "organization").eq("status", "active")
      .limit(5000)
  ]);
  for (const result of [runResult,evidenceResult,entitiesResult,factsResult,canonicalResult]) {
    if (result.error) throw new Error("Entity-resolution input query failed: " + result.error.message);
  }
  const run = runResult.data, evidence = evidenceResult.data;
  if (!run || !evidence || run.evidence_id !== evidence.id ||
    run.source_content_hash !== evidence.content_hash || run.source_id !== job.source_id) {
    throw new Error("E06 extraction run does not match its immutable evidence snapshot.");
  }

  const canonicalEntities = canonicalResult.data || [];
  const canonicalIds = canonicalEntities.map(entity => entity.id);
  let identifiers = [], aliases = [];
  if (canonicalIds.length) {
    const [identifierResult, aliasResult] = await Promise.all([
      admin.from("discovery_entity_identifiers")
        .select("canonical_entity_id,scheme,jurisdiction,normalized_value")
        .eq("company_id", job.company_id).in("canonical_entity_id", canonicalIds)
        .eq("review_state", "owner_accepted"),
      admin.from("discovery_entity_aliases")
        .select("canonical_entity_id,alias,normalized_alias")
        .eq("company_id", job.company_id).in("canonical_entity_id", canonicalIds)
        .eq("review_state", "owner_accepted")
    ]);
    if (identifierResult.error) throw new Error("Entity identifiers could not be loaded: " + identifierResult.error.message);
    if (aliasResult.error) throw new Error("Entity aliases could not be loaded: " + aliasResult.error.message);
    identifiers = identifierResult.data || [];
    aliases = aliasResult.data || [];
  }

  const existingEntities = canonicalEntities.map(entity => ({
    ...entity,
    identifiers: identifiers.filter(item => item.canonical_entity_id === entity.id),
    aliases: aliases.filter(item => item.canonical_entity_id === entity.id)
  }));
  return {
    candidates: buildEntityResolutionCandidates({
      extractedEntities: entitiesResult.data || [],
      extractedFacts: factsResult.data || [],
      existingEntities,
      jurisdiction: evidence.jurisdiction
    })
  };
}

export async function runEntityResolutionWorkerOnce(admin, workerId) {
  const { data: claimed, error: claimError } = await admin.rpc("claim_discovery_entity_resolution_job", {
    p_worker_id: workerId,
    p_lease_seconds: 90
  });
  if (claimError) throw new Error("Could not claim E06 work: " + claimError.message);
  const job = Array.isArray(claimed) ? claimed[0] : claimed;
  if (!job) return false;

  const controller = new AbortController();
  let heartbeatBusy = false;
  const heartbeatTimer = setInterval(async () => {
    if (heartbeatBusy || controller.signal.aborted) return;
    heartbeatBusy = true;
    try {
      const { data, error } = await admin.rpc("heartbeat_discovery_entity_resolution_job", {
        p_job_id: job.id, p_worker_id: workerId, p_lease_seconds: 90
      });
      if (error || data !== true) controller.abort(new Error("E06 lease, source approval or profile attachment was revoked."));
    } catch {
      controller.abort(new Error("E06 worker heartbeat failed; stopping the current job."));
    } finally {
      heartbeatBusy = false;
    }
  }, 20_000);

  try {
    const input = await loadInputs(admin, job);
    if (controller.signal.aborted) throw new Error("E06 worker lease was lost before completion.");
    const { data, error } = await admin.rpc("complete_discovery_entity_resolution", {
      p_job_id: job.id,
      p_worker_id: workerId,
      p_candidates: input.candidates
    });
    if (error) throw new Error("E06 result commit failed: " + error.message);
    if (controller.signal.aborted) throw new Error("E06 worker lease was lost before completion.");
    console.info("AXIVESTRA E06 resolution completed:", JSON.stringify({
      jobId: job.id, candidates: input.candidates.length, committedCandidates: data
    }));
  } catch (error) {
    const { error: failError } = await admin.rpc("fail_discovery_entity_resolution_job", {
      p_job_id: job.id,
      p_worker_id: workerId,
      p_error_code: String(error?.code || "ENTITY_RESOLUTION_FAILED").slice(0,100),
      p_error_message: String(error?.message || "E06 resolution failed.").slice(0,1000)
    });
    if (failError) console.error("Could not record E06 failure against its lease:", failError.message);
  } finally {
    clearInterval(heartbeatTimer);
  }
  return true;
}

export async function runEntityResolutionWorker() {
  if (process.env.DISCOVERY_ENTITY_RESOLUTION_WORKER_ENABLED !== "true") {
    console.info("AXIVESTRA E06 entity-resolution worker disabled by default.");
    return;
  }
  const admin = createAdmin();
  const workerId = process.env.AXIVESTRA_ENTITY_RESOLUTION_WORKER_ID ||
    ("axivestra-entity-" + randomUUID());
  const pollMs = Math.max(1000, Math.min(30_000,
    Number(process.env.DISCOVERY_ENTITY_RESOLUTION_POLL_MS || 5000)));
  let stopping = false;
  process.once("SIGINT", () => { stopping = true; });
  process.once("SIGTERM", () => { stopping = true; });
  console.info("AXIVESTRA E06 deterministic entity-resolution worker started. It performs no network calls.");
  while (!stopping) {
    try {
      const didWork = await runEntityResolutionWorkerOnce(admin, workerId);
      if (!didWork) await sleep(pollMs);
    } catch (error) {
      console.error("AXIVESTRA E06 worker failed closed:", String(error?.message || error));
      await sleep(pollMs);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runEntityResolutionWorker().catch(error => {
    console.error("AXIVESTRA E06 worker stopped:", error);
    process.exitCode = 1;
  });
}
