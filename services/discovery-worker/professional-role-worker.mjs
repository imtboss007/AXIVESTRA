import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { buildProfessionalRoleCandidates } from "./professional-roles.mjs";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("Missing E07 worker environment variable: " + name);
  return value;
}
function createAdmin() {
  return createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { "X-AXIVESTRA-Worker": "discovery-professional-role-worker" } }
  });
}

async function loadInputs(admin, job) {
  const [runResult, evidenceResult, entitiesResult, factsResult, assignmentResult, canonicalResult] = await Promise.all([
    admin.from("discovery_extraction_runs").select("id,evidence_id,source_id,status,source_content_hash")
      .eq("company_id", job.company_id).eq("id", job.extraction_run_id).maybeSingle(),
    admin.from("discovery_evidence_items").select("id,jurisdiction,content_hash")
      .eq("company_id", job.company_id).eq("id", job.evidence_id).maybeSingle(),
    admin.from("discovery_extracted_entities").select("id,entity_kind,raw_name,normalized_name,source_span,confidence")
      .eq("company_id", job.company_id).eq("extraction_run_id", job.extraction_run_id)
      .in("entity_kind", ["person","organization"]),
    admin.from("discovery_extracted_facts").select("id,extracted_entity_id,field_name,raw_value,normalized_value,validation_status,source_span,confidence")
      .eq("company_id", job.company_id).eq("extraction_run_id", job.extraction_run_id),
    admin.from("discovery_entity_assignments").select("extracted_entity_id,canonical_entity_id")
      .eq("company_id", job.company_id).eq("extraction_run_id", job.extraction_run_id),
    admin.from("discovery_canonical_entities").select("id,entity_kind,status,jurisdiction,legal_name,normalized_name")
      .eq("company_id", job.company_id).eq("entity_kind", "organization").eq("status", "active")
      .limit(5000)
  ]);
  for (const result of [runResult,evidenceResult,entitiesResult,factsResult,assignmentResult,canonicalResult]) {
    if (result.error) throw new Error("E07 input query failed: " + result.error.message);
  }
  const run = runResult.data, evidence = evidenceResult.data;
  if (!run || !evidence || run.evidence_id !== evidence.id ||
      run.source_content_hash !== evidence.content_hash || run.source_id !== job.source_id) {
    throw new Error("E07 extraction run does not match immutable evidence.");
  }
  const candidates = buildProfessionalRoleCandidates({
    extractedEntities: entitiesResult.data || [],
    extractedFacts: factsResult.data || [],
    assignments: assignmentResult.data || [],
    canonicalEntities: canonicalResult.data || [],
    evidenceId: evidence.id,
    jurisdiction: evidence.jurisdiction
  });
  return { candidates };
}

export async function runProfessionalRoleWorkerOnce(admin, workerId) {
  const { data: claimed, error: claimError } = await admin.rpc("claim_discovery_professional_role_job", {
    p_worker_id: workerId, p_lease_seconds: 90
  });
  if (claimError) throw new Error("Could not claim E07 work: " + claimError.message);
  const job = Array.isArray(claimed) ? claimed[0] : claimed;
  if (!job) return false;

  let heartbeatBusy = false;
  let leaseLost = false;
  const heartbeatTimer = setInterval(async () => {
    if (heartbeatBusy || leaseLost) return;
    heartbeatBusy = true;
    try {
      const { data, error } = await admin.rpc("heartbeat_discovery_professional_role_job", {
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
    const input = await loadInputs(admin, job);
    if (leaseLost) throw new Error("E07 lease or source approval was revoked.");
    const { data, error } = await admin.rpc("complete_discovery_professional_role_job", {
      p_job_id: job.id, p_worker_id: workerId, p_candidates: input.candidates
    });
    if (error) throw new Error("E07 candidate commit failed: " + error.message);
    if (leaseLost) throw new Error("E07 lease was lost before completion.");
    console.info("AXIVESTRA E07 role candidates recorded:", JSON.stringify({
      jobId: job.id, candidates: input.candidates.length, committedCandidates: data
    }));
  } catch (error) {
    const { error: failError } = await admin.rpc("fail_discovery_professional_role_job", {
      p_job_id: job.id, p_worker_id: workerId,
      p_error_code: String(error?.code || "PROFESSIONAL_ROLE_FAILED").slice(0,100),
      p_error_message: String(error?.message || "E07 role extraction failed.").slice(0,1000)
    });
    if (failError) console.error("Could not record E07 failure:", failError.message);
  } finally {
    clearInterval(heartbeatTimer);
  }
  return true;
}

export async function runProfessionalRoleWorker() {
  if (process.env.DISCOVERY_PROFESSIONAL_ROLE_WORKER_ENABLED !== "true") {
    console.info("AXIVESTRA E07 professional-role worker disabled by default.");
    return;
  }
  const admin = createAdmin();
  const workerId = process.env.AXIVESTRA_PROFESSIONAL_ROLE_WORKER_ID ||
    ("axivestra-professional-role-" + randomUUID());
  const pollMs = Math.max(1000, Math.min(30_000,
    Number(process.env.DISCOVERY_PROFESSIONAL_ROLE_POLL_MS || 5000)));
  let stopping = false;
  process.once("SIGINT", () => { stopping = true; });
  process.once("SIGTERM", () => { stopping = true; });
  console.info("AXIVESTRA E07 deterministic professional-role worker started; no external network calls.");
  while (!stopping) {
    try {
      const didWork = await runProfessionalRoleWorkerOnce(admin, workerId);
      if (!didWork) await sleep(pollMs);
    } catch (error) {
      console.error("AXIVESTRA E07 worker failed closed:", String(error?.message || error));
      await sleep(pollMs);
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runProfessionalRoleWorker().catch(error => {
    console.error("AXIVESTRA E07 worker stopped:", error);
    process.exitCode = 1;
  });
}
