import { createClient } from "npm:@supabase/supabase-js@2";

type JsonObject = Record<string, unknown>;
const encoder = new TextEncoder();

function jsonResponse(status: number, body: JsonObject) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function configuredPublicKeys(): Set<string> {
  const keys = new Set<string>();
  const legacy = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (legacy) keys.add(legacy);
  try {
    const configured = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
    if (configured && typeof configured === "object" && !Array.isArray(configured)) {
      for (const value of Object.values(configured)) {
        if (typeof value === "string" && value.length >= 16) keys.add(value);
      }
    }
  } catch {
    // An invalid optional publishable-key map does not bypass the legacy key check.
  }
  return keys;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Worker-token broker for the narrow E20.4 lease API.
 *
 * Supabase JWT verification is disabled for this one function; every request
 * must instead present the one-time, random, company/stage-scoped worker token.
 * The only service-role credential stays in this Edge Function environment.
 * No logs include the worker token, its hash, lease token or lease-token hash.
 */
Deno.serve(async request => {
  if (request.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "Use POST for the orchestration worker lease API." });
  }
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) {
    return jsonResponse(415, { ok: false, error: "The worker lease API accepts JSON requests only." });
  }

  const rawWorkerToken = request.headers.get("x-axivestra-worker-token") || "";
  if (!isHash(rawWorkerToken)) {
    return jsonResponse(401, { ok: false, error: "A valid scoped worker credential is required." });
  }

  const gatewayApiKey = request.headers.get("apikey") || "";
  if (!gatewayApiKey || !configuredPublicKeys().has(gatewayApiKey)) {
    return jsonResponse(401, { ok: false, error: "The Supabase public API key is missing or invalid." });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    || defaultKeyFromJson("SUPABASE_SECRET_KEYS");
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse(503, { ok: false, error: "The server-side worker broker is not configured." });
  }

  const contentLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > 16_000) {
    return jsonResponse(413, { ok: false, error: "The worker request is too large." });
  }

  let body: JsonObject;
  try {
    const rawBody = await request.text();
    if (rawBody.length > 16_000) return jsonResponse(413, { ok: false, error: "The worker request is too large." });
    const parsed = JSON.parse(rawBody);
    if (!isObject(parsed)) return jsonResponse(400, { ok: false, error: "The worker request must be a JSON object." });
    body = parsed;
  } catch {
    return jsonResponse(400, { ok: false, error: "The worker request must contain valid JSON." });
  }

  const companyId = body.companyId;
  const workerIdentityId = body.workerIdentityId;
  const action = body.action;
  if (!isUuid(companyId) || !isUuid(workerIdentityId)) {
    return jsonResponse(400, { ok: false, error: "Valid company and worker identity IDs are required." });
  }
  if (action !== "claim" && action !== "heartbeat" && action !== "release") {
    return jsonResponse(400, { ok: false, error: "Choose claim, heartbeat or release." });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
  });
  const workerCredentialHash = await sha256(rawWorkerToken);

  try {
    if (action === "claim") {
      const leaseSeconds = Number(body.leaseSeconds ?? 120);
      if (!Number.isInteger(leaseSeconds) || leaseSeconds < 15 || leaseSeconds > 300) {
        return jsonResponse(400, { ok: false, error: "Lease duration must be between 15 and 300 seconds." });
      }
      const leaseToken = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
      const { data, error } = await admin.rpc("claim_discovery_orchestration_lease", {
        p_company_id: companyId,
        p_worker_identity_id: workerIdentityId,
        p_worker_credential_hash: workerCredentialHash,
        p_lease_token_hash: await sha256(leaseToken),
        p_lease_seconds: leaseSeconds
      });
      if (error) throw error;
      const lease = Array.isArray(data) ? data[0] : data;
      if (!lease) return jsonResponse(200, { ok: true, lease: null, message: "No orchestration work is currently claimable." });
      if (!isUuid(lease.lease_id) || !isUuid(lease.execution_id)) {
        return jsonResponse(500, { ok: false, error: "The lease broker returned an incomplete receipt." });
      }
      return jsonResponse(200, {
        ok: true,
        lease: {
          leaseId: lease.lease_id,
          executionId: lease.execution_id,
          runId: lease.run_id,
          stepId: lease.step_id,
          stageKey: lease.stage_key,
          adapterKey: lease.adapter_key,
          workerIdentity: lease.worker_identity,
          leasedAt: lease.leased_at,
          expiresAt: lease.expires_at
        },
        leaseToken
      });
    }

    const leaseId = body.leaseId;
    const leaseToken = body.leaseToken;
    if (!isUuid(leaseId) || !isHash(leaseToken)) {
      return jsonResponse(400, { ok: false, error: "A valid lease ID and one-time lease token are required." });
    }
    const leaseTokenHash = await sha256(leaseToken);

    if (action === "heartbeat") {
      const leaseSeconds = Number(body.leaseSeconds ?? 120);
      if (!Number.isInteger(leaseSeconds) || leaseSeconds < 15 || leaseSeconds > 300) {
        return jsonResponse(400, { ok: false, error: "Lease duration must be between 15 and 300 seconds." });
      }
      const { data, error } = await admin.rpc("heartbeat_discovery_orchestration_lease", {
        p_company_id: companyId,
        p_lease_id: leaseId,
        p_worker_identity_id: workerIdentityId,
        p_worker_credential_hash: workerCredentialHash,
        p_lease_token_hash: leaseTokenHash,
        p_lease_seconds: leaseSeconds
      });
      if (error) throw error;
      return jsonResponse(200, { ok: true, renewed: data === true });
    }

    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length < 10 || reason.length > 1000) {
      return jsonResponse(400, { ok: false, error: "A release reason of 10–1000 characters is required." });
    }
    const { data, error } = await admin.rpc("release_discovery_orchestration_lease", {
      p_company_id: companyId,
      p_lease_id: leaseId,
      p_worker_identity_id: workerIdentityId,
      p_worker_credential_hash: workerCredentialHash,
      p_lease_token_hash: leaseTokenHash,
      p_reason: reason
    });
    if (error) throw error;
    return jsonResponse(200, { ok: true, released: data === true });
  } catch {
    // Never include database details, input, authorization headers, hashes or tokens in logs/responses.
    console.error("discovery-orchestration-worker: lease operation failed");
    return jsonResponse(409, {
      ok: false,
      error: "The worker identity, company grant, dispatch gate or lease is no longer valid."
    });
  }
});
