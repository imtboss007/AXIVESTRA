import { createHash, randomBytes } from "node:crypto";

export function hashWorkerCredential(value) {
  if (typeof value !== "string" || value.length < 32 || value.length > 256) {
    throw new Error("Orchestration worker credential is missing or invalid.");
  }
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hashLeaseToken(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Narrow service-role client for E20 orchestration lease RPCs.
 * This helper does not execute adapter code or start a worker loop.
 * Raw credentials and per-lease tokens remain in process memory only.
 */
export function createOrchestrationLeaseClient({
  admin,
  companyId,
  workerIdentityId,
  workerToken
}) {
  if (!admin || typeof admin.rpc !== "function") {
    throw new Error("A server-side Supabase service client is required.");
  }
  if (typeof companyId !== "string" || !companyId || typeof workerIdentityId !== "string" || !workerIdentityId) {
    throw new Error("Company and scoped worker identity IDs are required.");
  }

  const workerCredentialHash = hashWorkerCredential(workerToken);
  const leaseTokens = new Map();

  async function rpc(name, args, description) {
    const { data, error } = await admin.rpc(name, args);
    if (error) throw new Error(description + ": " + String(error.message || "request failed"));
    return data;
  }

  return Object.freeze({
    async claim({ leaseSeconds = 120 } = {}) {
      const leaseToken = randomBytes(32).toString("hex");
      const data = await rpc("claim_discovery_orchestration_lease", {
        p_company_id: companyId,
        p_worker_identity_id: workerIdentityId,
        p_worker_credential_hash: workerCredentialHash,
        p_lease_token_hash: hashLeaseToken(leaseToken),
        p_lease_seconds: leaseSeconds
      }, "Orchestration lease claim failed closed");
      const lease = Array.isArray(data) ? data[0] : data;
      if (!lease) return null;
      if (!lease.lease_id || !lease.execution_id) {
        throw new Error("Orchestration claim returned an incomplete lease receipt.");
      }
      leaseTokens.set(lease.lease_id, leaseToken);
      return Object.freeze({ ...lease, leaseToken });
    },

    async heartbeat(leaseId, { leaseSeconds = 120 } = {}) {
      const leaseToken = leaseTokens.get(leaseId);
      if (!leaseToken) return false;
      const data = await rpc("heartbeat_discovery_orchestration_lease", {
        p_company_id: companyId,
        p_lease_id: leaseId,
        p_worker_identity_id: workerIdentityId,
        p_worker_credential_hash: workerCredentialHash,
        p_lease_token_hash: hashLeaseToken(leaseToken),
        p_lease_seconds: leaseSeconds
      }, "Orchestration lease heartbeat failed closed");
      return data === true;
    },

    async release(leaseId, reason) {
      const leaseToken = leaseTokens.get(leaseId);
      if (!leaseToken) return false;
      if (typeof reason !== "string" || reason.trim().length < 10 || reason.length > 1000) {
        throw new Error("A lease release reason of 10–1000 characters is required.");
      }
      const data = await rpc("release_discovery_orchestration_lease", {
        p_company_id: companyId,
        p_lease_id: leaseId,
        p_worker_identity_id: workerIdentityId,
        p_worker_credential_hash: workerCredentialHash,
        p_lease_token_hash: hashLeaseToken(leaseToken),
        p_reason: reason.trim()
      }, "Orchestration lease release failed closed");
      if (data === true) leaseTokens.delete(leaseId);
      return data === true;
    },

    forgetLease(leaseId) {
      leaseTokens.delete(leaseId);
    },

    activeLeaseCount() {
      return leaseTokens.size;
    }
  });
}
