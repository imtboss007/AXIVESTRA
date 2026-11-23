const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_TOKEN = /^[a-f0-9]{64}$/;

function normalizeEndpoint(supabaseUrl) {
  let url;
  try { url = new URL(supabaseUrl); }
  catch { throw new Error("A valid Supabase project URL is required."); }

  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("The orchestration worker broker must use HTTPS.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("The Supabase project URL must not contain credentials, query strings or fragments.");
  }
  return new URL("/functions/v1/discovery-orchestration-worker", url).toString();
}

/**
 * Least-privilege E20.4 worker client.
 * The worker process holds only its own temporary scoped token and the
 * Supabase public API key. The service-role key and all credential hashing
 * remain inside the discovery-orchestration-worker Edge Function.
 *
 * This client performs lease operations only; it never starts a polling loop
 * or executes a discovery adapter.
 */
export function createOrchestrationLeaseClient({
  supabaseUrl,
  publicApiKey,
  companyId,
  workerIdentityId,
  workerToken,
  fetchImpl = globalThis.fetch
}) {
  if (!UUID.test(companyId || "") || !UUID.test(workerIdentityId || "")) {
    throw new Error("Valid company and scoped worker identity IDs are required.");
  }
  if (typeof publicApiKey !== "string" || publicApiKey.length < 16 || publicApiKey.length > 512) {
    throw new Error("The Supabase public API key is missing or invalid.");
  }
  if (!HEX_TOKEN.test(workerToken || "")) {
    throw new Error("The one-time scoped worker credential is missing or invalid.");
  }
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");

  const endpoint = normalizeEndpoint(supabaseUrl);
  const leaseTokens = new Map();

  async function invoke(action, payload = {}) {
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          apikey: publicApiKey,
          "x-axivestra-worker-token": workerToken,
          "content-type": "application/json",
          "cache-control": "no-store"
        },
        body: JSON.stringify({ action, companyId, workerIdentityId, ...payload }),
        redirect: "error",
        cache: "no-store"
      });
    } catch {
      throw new Error("The orchestration worker broker could not be reached.");
    }

    let body;
    try { body = await response.json(); }
    catch { throw new Error("The orchestration worker broker returned an invalid response."); }
    if (!response.ok || body?.ok !== true) {
      const message = typeof body?.error === "string" ? body.error : "The lease request was rejected.";
      throw new Error("Orchestration worker " + action + " failed closed: " + message);
    }
    return body;
  }

  return Object.freeze({
    async claim({ leaseSeconds = 120 } = {}) {
      if (!Number.isInteger(leaseSeconds) || leaseSeconds < 15 || leaseSeconds > 300) {
        throw new Error("Lease duration must be between 15 and 300 seconds.");
      }
      const result = await invoke("claim", { leaseSeconds });
      if (result.lease === null) return null;
      const lease = result.lease;
      if (!lease || !UUID.test(lease.leaseId || "") || !UUID.test(lease.executionId || "")
        || !HEX_TOKEN.test(result.leaseToken || "")) {
        throw new Error("The orchestration worker broker returned an incomplete lease receipt.");
      }
      leaseTokens.set(lease.leaseId, result.leaseToken);
      return Object.freeze({ ...lease, leaseToken: result.leaseToken });
    },

    async heartbeat(leaseId, { leaseSeconds = 120 } = {}) {
      const leaseToken = leaseTokens.get(leaseId);
      if (!leaseToken) return false;
      if (!Number.isInteger(leaseSeconds) || leaseSeconds < 15 || leaseSeconds > 300) {
        throw new Error("Lease duration must be between 15 and 300 seconds.");
      }
      const result = await invoke("heartbeat", { leaseId, leaseToken, leaseSeconds });
      return result.renewed === true;
    },

    async release(leaseId, reason) {
      const leaseToken = leaseTokens.get(leaseId);
      if (!leaseToken) return false;
      if (typeof reason !== "string" || reason.trim().length < 10 || reason.length > 1000) {
        throw new Error("A lease release reason of 10–1000 characters is required.");
      }
      const result = await invoke("release", { leaseId, leaseToken, reason: reason.trim() });
      if (result.released === true) leaseTokens.delete(leaseId);
      return result.released === true;
    },

    forgetLease(leaseId) {
      leaseTokens.delete(leaseId);
    },

    activeLeaseCount() {
      return leaseTokens.size;
    }
  });
}
