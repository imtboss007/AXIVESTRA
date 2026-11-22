import { createClient } from "@supabase/supabase-js";

const MAX_BATCH_SIZE = 100;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("Missing required retention environment variable: " + name);
  return value;
}

export function evidenceObjectPath(reference) {
  const prefix = "discovery-evidence:";
  if (typeof reference !== "string" || !reference.startsWith(prefix)) {
    throw new Error("Evidence object reference is outside the private discovery evidence bucket.");
  }
  const path = reference.slice(prefix.length);
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}-[a-f0-9]{64}\.bin$/.test(path)) {
    throw new Error("Evidence object path does not match company/job/object content-addressed layout.");
  }
  return path;
}

export async function runRetentionSweepOnce(admin, limit = MAX_BATCH_SIZE) {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH_SIZE) {
    throw new Error("Evidence retention sweep batch must be between 1 and 100.");
  }

  const { data: expired, error: listError } = await admin.rpc("list_expired_discovery_evidence", {
    p_limit: limit
  });
  if (listError) throw new Error("Could not list expired evidence: " + listError.message);

  let removed = 0;
  let failed = 0;
  const failures = [];

  for (const item of expired || []) {
    try {
      const path = evidenceObjectPath(item.raw_blob_ref);
      if (!item.company_id || !item.job_id || !item.source_id || !item.id ||
          !item.content_hash || !item.canonical_url) {
        throw new Error("Expired evidence retention row is missing its company/source provenance.");
      }

      // The object is deleted first. If a later database operation fails, a
      // subsequent sweep may safely retry the same private object removal.
      const { error: storageError } = await admin.storage.from("discovery-evidence").remove([path]);
      if (storageError) throw new Error("Private evidence object removal failed: " + storageError.message);

      const { error: receiptError } = await admin.from("discovery_fetch_events").insert({
        company_id: item.company_id,
        job_id: item.job_id,
        source_id: item.source_id,
        evidence_id: item.id,
        event_type: "retention_purged",
        url: item.canonical_url,
        occurred_at: new Date().toISOString(),
        outcome: "retention_expired_private_object_deleted",
        metadata: {
          raw_blob_ref: item.raw_blob_ref,
          content_hash: item.content_hash,
          captured_at: item.captured_at,
          retention_days: item.retention_days
        }
      });
      if (receiptError && receiptError.code !== "23505") {
        throw new Error("Retention purge receipt could not be written: " + receiptError.message);
      }

      const { data: deleted, error: deleteError } = await admin.from("discovery_evidence_items")
        .delete().eq("company_id", item.company_id).eq("id", item.id)
        .select("id").maybeSingle();
      if (deleteError) throw new Error("Expired evidence metadata deletion failed: " + deleteError.message);
      if (deleted) removed += 1;
    } catch (error) {
      failed += 1;
      failures.push({
        evidenceId: item?.id || null,
        message: String(error?.message || "Evidence retention failed.").slice(0, 500)
      });
    }
  }

  return { examined: (expired || []).length, removed, failed, failures };
}

function createAdminClient() {
  return createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { "X-AXIVESTRA-Worker": "discovery-retention-sweeper" } }
  });
}

export async function runRetentionSweep() {
  if (process.env.DISCOVERY_RETENTION_SWEEP_ENABLED !== "true") {
    console.info("AXIVESTRA evidence retention sweep disabled: DISCOVERY_RETENTION_SWEEP_ENABLED is not true.");
    return { examined: 0, removed: 0, failed: 0, failures: [] };
  }
  const admin = createAdminClient();
  const result = await runRetentionSweepOnce(admin, MAX_BATCH_SIZE);
  console.info("AXIVESTRA private evidence retention sweep:", JSON.stringify(result));
  return result;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  runRetentionSweep().then(result => {
    if (result.failed > 0) process.exitCode = 1;
  }).catch(error => {
    console.error("AXIVESTRA evidence retention sweep stopped:", error);
    process.exitCode = 1;
  });
}
