import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { extractStructuredFacts, EXTRACTOR_VERSION } from "./extractor.mjs";
import { encryptContactValue, keyFromBase64, maskContactValue } from "./contact-validation.mjs";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function protectExtractedContactFacts(facts, keys) {
  const rows = Array.isArray(facts) ? facts : [];
  const hasContacts = rows.some(fact => ["email", "phone"].includes(fact?.value_type));
  if (!hasContacts) return rows;
  if (!keys?.encryptionKey || !keys?.fingerprintKey) {
    throw new Error("E05 cannot persist extracted email/phone facts without the E05 contact encryption and fingerprint keys.");
  }
  return rows.map(fact => {
    if (!["email", "phone"].includes(fact?.value_type)) return fact;
    const raw = typeof fact.raw_value === "string" ? fact.raw_value.normalize("NFKC").trim() : "";
    if (!raw || raw.length > 320) throw new Error("E05 contact fact is empty or exceeds the protected-contact limit.");
    const encrypted = encryptContactValue(raw, keys.encryptionKey, keys.fingerprintKey);
    const masked = maskContactValue(fact.value_type, raw);
    const sourceSpan = fact.source_span && typeof fact.source_span === "object" && !Array.isArray(fact.source_span)
      ? { ...fact.source_span } : {};
    delete sourceSpan.quoteHash;
    sourceSpan.quote = masked;
    sourceSpan.quoteRedacted = true;
    return {
      ...fact,
      raw_value: masked,
      normalized_value: null,
      source_span: sourceSpan,
      raw_value_ciphertext: encrypted.value_ciphertext,
      raw_value_nonce: encrypted.value_nonce,
      raw_value_auth_tag: encrypted.value_auth_tag,
      raw_value_fingerprint: encrypted.value_fingerprint,
      raw_value_encryption_version: encrypted.encryption_version
    };
  });
}

function optionalContactKeys() {
  const encryptionValue = process.env.DISCOVERY_CONTACT_ENCRYPTION_KEY?.trim();
  const fingerprintValue = process.env.DISCOVERY_CONTACT_FINGERPRINT_KEY?.trim();
  if (!encryptionValue && !fingerprintValue) return null;
  if (!encryptionValue || !fingerprintValue) {
    throw new Error("Both E05 contact encryption and fingerprint keys must be configured together.");
  }
  return {
    encryptionKey: keyFromBase64(encryptionValue, "DISCOVERY_CONTACT_ENCRYPTION_KEY"),
    fingerprintKey: keyFromBase64(fingerprintValue, "DISCOVERY_CONTACT_FINGERPRINT_KEY")
  };
}

export function makeExtractionWorkerSlots(workerId, requestedConcurrency = 2) {
  const base = typeof workerId === "string" && workerId.trim()
    ? workerId.trim()
    : "axivestra-extract";
  const parsed = Number(requestedConcurrency);
  const concurrency = Number.isFinite(parsed)
    ? Math.max(1, Math.min(4, Math.floor(parsed)))
    : 2;
  return Array.from({ length: concurrency }, (_, index) => {
    const suffix = "-slot-" + (index + 1);
    return base.slice(0, 160 - suffix.length) + suffix;
  });
}

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

export function evidenceObjectPath(reference) {
  const prefix = "discovery-evidence:";
  if (typeof reference !== "string" || !reference.startsWith(prefix)) {
    throw new Error("Evidence object reference is outside the private discovery evidence bucket.");
  }
  const path = reference.slice(prefix.length);
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}-[a-f0-9]{64}\.bin$/.test(path)) {
    throw new Error("Evidence object path does not match the expected company/job/evidence content-addressed structure.");
  }
  return path;
}

async function executeJob(admin, job, workerId, signal, contactKeys) {
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
  if (evidence.source_id !== job.source_id || evidence.company_id !== job.company_id) throw new Error("Evidence is not linked to the queued source and company.");
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
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (actualHash !== evidence.content_hash) throw new Error("Evidence snapshot SHA-256 does not match the immutable evidence record.");
  throwIfAborted(signal);

  const result = await extractStructuredFacts({
    bytes,
    contentType: evidence.content_type,
    source,
    contentHash: evidence.content_hash,
    htmlParserBackend: process.env.AXIVESTRA_HTML_PARSER_BACKEND === "scrapling" ? "scrapling" : "htmlparser2"
  });
  throwIfAborted(signal);

  const storedFacts = protectExtractedContactFacts(result.facts || [], contactKeys);
  const { data: runId, error: commitError } = await admin.rpc("complete_discovery_extraction", {
    p_job_id: job.id,
    p_worker_id: workerId,
    p_run: {
      extractor_version: EXTRACTOR_VERSION,
      schema_hash: result.schemaHash,
      invalid_fact_count: result.invalidFactCount || 0,
      warnings: result.warnings || [],
      source_content_hash: evidence.content_hash,
      source_field_schema_snapshot: source.field_schema || {},
      source_allowed_fields_snapshot: source.allowed_fields || []
    },
    p_entities: result.entities || [],
    p_facts: storedFacts
  });
  if (commitError) throw new Error("Atomic extraction result commit failed: " + commitError.message);
  return { runId: typeof runId === "string" ? runId : runId?.id, facts: result.facts.length, entities: result.entities.length, warnings: result.warnings };
}

export async function runExtractionWorkerOnce(admin, workerId, contactKeys = optionalContactKeys()) {
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
    const result = await executeJob(admin, job, workerId, controller.signal, contactKeys);
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
  const workerSlots = makeExtractionWorkerSlots(
    workerId, process.env.DISCOVERY_EXTRACTION_CONCURRENCY || 2
  );
  const concurrency = workerSlots.length;
  const pollMs = Math.max(1000, Math.min(30_000, Number(process.env.DISCOVERY_EXTRACTION_POLL_MS || 5000)));
  let stopping = false;
  process.once("SIGINT", () => { stopping = true; });
  process.once("SIGTERM", () => { stopping = true; });
  const htmlParserBackend = process.env.AXIVESTRA_HTML_PARSER_BACKEND === "scrapling" ? "scrapling" : "htmlparser2";
  console.info("AXIVESTRA deterministic extraction worker started with " + concurrency + " bounded slot(s); HTML parser=" + htmlParserBackend + ". It performs no network access and no LLM calls.");
  while (!stopping) {
    const outcomes = await Promise.all(workerSlots.map(async slotId => {
      try {
        return await runExtractionWorkerOnce(admin, slotId);
      } catch (error) {
        console.error("AXIVESTRA extraction worker slot failed closed:", slotId,
          String(error?.message || error));
        return false;
      }
    }));
    if (!outcomes.some(Boolean)) await sleep(pollMs);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runExtractionWorker().catch(error => {
    console.error("AXIVESTRA extraction worker stopped:", error);
    process.exitCode = 1;
  });
}
