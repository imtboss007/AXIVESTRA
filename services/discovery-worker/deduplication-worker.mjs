import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("Missing required E12 worker environment variable: " + name);
  return value;
}
function createAdmin() {
  return createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { "X-AXIVESTRA-Worker": "discovery-deduplication-worker" } }
  });
}

export async function runDeduplicationWorkerOnce(admin, workerId) {
  const { data: claimed, error: claimError } = await admin.rpc("claim_discovery_deduplication_job", {
    p_worker_id: workerId, p_lease_seconds: 90
  });
  if (claimError) throw new Error("Could not claim E12 work: " + claimError.message);
  const job = Array.isArray(claimed) ? claimed[0] : claimed;
  if (!job) return false;

  let heartbeatBusy = false, leaseLost = false;
  const heartbeatTimer = setInterval(async () => {
    if (heartbeatBusy || leaseLost) return;
    heartbeatBusy = true;
    try {
      const { data, error } = await admin.rpc("heartbeat_discovery_deduplication_job", {
        p_job_id: job.id, p_worker_id: workerId, p_lease_seconds: 90
      });
      if (error || data !== true) leaseLost = true;
    } catch { leaseLost = true; }
    finally { heartbeatBusy = false; }
  }, 20_000);

  try {
    if (leaseLost) throw new Error("E12 lease or company worker grant was revoked.");
    const { data, error } = await admin.rpc("complete_discovery_deduplication_job", {
      p_job_id: job.id, p_worker_id: workerId
    });
    if (error) throw new Error("E12 candidate generation failed: " + error.message);
    if (leaseLost) throw new Error("E12 lease was lost before completion.");
    console.info("AXIVESTRA E12 duplicate candidates generated:", JSON.stringify({
      jobId: job.id, companyId: job.company_id, candidatesInserted: data
    }));
  } catch (error) {
    const { error: failError } = await admin.rpc("fail_discovery_deduplication_job", {
      p_job_id: job.id, p_worker_id: workerId,
      p_error_code: String(error?.code || "DEDUPLICATION_FAILED").slice(0, 100),
      p_error_message: String(error?.message || "E12 deduplication failed.").slice(0, 1000)
    });
    if (failError) console.error("Could not record E12 failure against its lease:", failError.message);
  } finally { clearInterval(heartbeatTimer); }
  return true;
}

export async function runDeduplicationWorker() {
  if (process.env.DISCOVERY_DEDUPLICATION_WORKER_ENABLED !== "true") {
    console.info("AXIVESTRA E12 deduplication worker disabled by default.");
    return;
  }
  const admin = createAdmin();
  const workerId = process.env.AXIVESTRA_DEDUPLICATION_WORKER_ID || ("axivestra-dedup-" + randomUUID());
  const pollMs = Math.max(1000, Math.min(30_000, Number(process.env.DISCOVERY_DEDUPLICATION_POLL_MS || 5000)));
  let stopping = false;
  process.once("SIGINT", () => { stopping = true; });
  process.once("SIGTERM", () => { stopping = true; });
  console.info("AXIVESTRA E12 deterministic deduplication worker started. It performs no network calls.");
  while (!stopping) {
    try {
      const didWork = await runDeduplicationWorkerOnce(admin, workerId);
      if (!didWork) await sleep(pollMs);
    } catch (error) {
      console.error("AXIVESTRA E12 worker failed closed:", String(error?.message || error));
      await sleep(pollMs);
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runDeduplicationWorker().catch(error => {
    console.error("AXIVESTRA E12 worker stopped:", String(error?.message || error));
    process.exitCode = 1;
  });
}
