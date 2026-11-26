import { assertAllowedSourceUrl } from "./discovery-policy.mjs";

const OPERATIONS = new Set(["search", "fetch_evidence"]);

function positiveInteger(value, label, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(label + " must be an integer from " + min + " to " + max + ".");
  }
  return number;
}

function requiredText(value, label, maxLength = 128) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > maxLength) throw new Error(label + " is required.");
  return text;
}

export function assertPurposeAllowed(source, purpose) {
  if (!source || source.status !== "approved") throw new Error("Only an approved source can be used.");
  const value = requiredText(purpose, "An approved discovery purpose");
  const allowed = Array.isArray(source.allowed_purposes) ? source.allowed_purposes : [];
  if (!allowed.includes(value)) {
    throw new Error("The requested purpose is not in this source's approved purpose allow-list.");
  }
  return value;
}

/**
 * Per-job execution limits for a connector adapter.
 *
 * This session bounds one job: it spaces calls according to the source's
 * declared request rate, limits evidence-page fetches, caps total connector
 * calls, propagates AbortSignals, and only retries explicitly retryable errors.
 * Cross-job / cross-worker rate limiting still requires an atomic server-side
 * quota lease in the deployed queue; this in-memory session is not that lease.
 */
export function createExecutionSession(source, options = {}) {
  if (!source || source.status !== "approved") throw new Error("Only an approved source can start an execution session.");
  const sourceKey = requiredText(source.id || source.canonical_url, "Source identity");
  const jobId = requiredText(options.jobId, "Discovery job ID");
  const requestsPerMinute = positiveInteger(source.rate_limit_per_minute, "Source request limit", 1, 60);
  const pageBudget = positiveInteger(source.max_pages_per_job, "Source page budget", 1, 100);
  const timeoutMs = positiveInteger(options.timeoutMs ?? 15000, "Connector timeout", 1, 30000);
  const maxRetries = positiveInteger(options.maxRetries ?? 0, "Retry budget", 0, 2);
  const minimumIntervalMs = Math.ceil(60000 / requestsPerMinute);
  const maximumCalls = pageBudget + 5;
  const now = typeof options.now === "function" ? options.now : Date.now;
  const wait = typeof options.wait === "function"
    ? options.wait
    : milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

  let requestCount = 0;
  let pageCount = 0;
  let lastRequestAt = null;

  async function run(operation, task) {
    if (!OPERATIONS.has(operation)) throw new Error("Connector operation is not supported by this execution session.");
    if (typeof task !== "function") throw new Error("A connector task callback is required.");
    if (operation === "fetch_evidence") {
      if (pageCount >= pageBudget) throw new Error("This discovery job has reached the source's maximum pages per job.");
      pageCount += 1;
    }

    let retries = 0;
    while (true) {
      if (requestCount >= maximumCalls) throw new Error("This discovery job has reached its maximum connector-call budget.");
      if (lastRequestAt !== null) {
        const elapsed = now() - lastRequestAt;
        const delay = Math.max(0, minimumIntervalMs - elapsed);
        if (delay > 0) await wait(delay);
      }

      lastRequestAt = now();
      requestCount += 1;
      const controller = new AbortController();
      let timer;
      try {
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            const error = new Error("The connector request exceeded the configured timeout.");
            error.code = "DISCOVERY_CONNECTOR_TIMEOUT";
            reject(error);
          }, timeoutMs);
        });
        return await Promise.race([
          Promise.resolve().then(() => task({
            signal: controller.signal,
            attempt: retries + 1,
            jobId
          })),
          timeout
        ]);
      } catch (error) {
        if (error && error.retryable === true && retries < maxRetries) {
          retries += 1;
          await wait(Math.min(250 * (2 ** retries), 2000));
          continue;
        }
        throw error;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }
  }

  return Object.freeze({
    sourceKey,
    jobId,
    run,
    snapshot() {
      return Object.freeze({
        sourceKey,
        jobId,
        requestCount,
        pageCount,
        pageBudget,
        maximumCalls,
        minimumIntervalMs,
        timeoutMs,
        maxRetries
      });
    }
  });
}

export function assertExecutionSession(session, source) {
  if (!session || typeof session.run !== "function" || typeof session.snapshot !== "function") {
    throw new Error("A bounded discovery execution session is required for connector calls.");
  }
  const sourceKey = String(source?.id || source?.canonical_url || "");
  if (!sourceKey || session.sourceKey !== sourceKey) {
    throw new Error("The execution session does not belong to this approved source.");
  }
  return session;
}

/** Build auditable source metadata; the evidence payload itself is stored separately. */
export function buildEvidenceProvenance(source, input = {}) {
  if (!source || source.status !== "approved") throw new Error("Evidence provenance requires an approved source.");
  const purpose = assertPurposeAllowed(source, input.purpose);
  const target = assertAllowedSourceUrl(source, input.url);
  const allowed = new Set((Array.isArray(source.allowed_fields) ? source.allowed_fields : []).map(field => String(field).toLowerCase()));
  const fields = Array.isArray(input.fields) ? [...new Set(input.fields.map(field => requiredText(field, "Observed field", 128)))] : [];
  if (fields.some(field => !allowed.has(field.toLowerCase()))) {
    throw new Error("Observed evidence contains a field outside the approved field allow-list.");
  }
  const retrievedAt = input.retrievedAt || new Date().toISOString();
  if (!Number.isFinite(Date.parse(retrievedAt))) throw new Error("Evidence retrieval time must be a valid timestamp.");
  return Object.freeze({
    job_id: requiredText(input.jobId, "Discovery job ID"),
    source_id: source.id || null,
    source_type: source.source_type,
    connector_key: source.connector_key,
    source_url: target.toString(),
    retrieved_at: new Date(retrievedAt).toISOString(),
    purpose,
    observed_fields: fields,
    terms_url: source.terms_url || null,
    license_ref: source.license_ref || null,
    legal_basis: source.legal_basis || null,
    attribution: source.attribution || ""
  });
}
