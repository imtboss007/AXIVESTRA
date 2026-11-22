import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { BasicCrawler } from "crawlee";
import { createClient } from "@supabase/supabase-js";
import {
  assertAllowedSourceUrl,
  assertSourceCanBeAttached
} from "../../supabase/functions/_shared/discovery-policy.mjs";
import { assertPurposeAllowed } from "../../supabase/functions/_shared/discovery-execution-policy.mjs";
import {
  assertPublicResolvedAddresses, parseRobotsRules, redactUrl,
  validateCandidateUrls, makeRobotsUrl
} from "./worker-policy.mjs";

const MAX_BODY_BYTES = 5_000_000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;
const USER_AGENT = "AXIVESTRA-DiscoveryBot/1.0";
const CACHE_SECONDS = 6 * 60 * 60;
const ALLOWED_CONTENT_TYPES = new Set([
  "text/html", "text/plain", "application/json", "application/ld+json",
  "application/xml", "text/xml", "application/pdf"
]);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = value => createHash("sha256").update(value).digest("hex");

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("Missing required worker environment variable: " + name);
  return value;
}

function makeAdminClient() {
  return createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { "X-AXIVESTRA-Worker": "discovery-fetch-worker" } }
  });
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new Error("Discovery worker execution was stopped or its lease was lost.");
}

async function resolvePinnedAddress(hostname) {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return assertPublicResolvedAddresses(addresses);
}

async function rawHttpsGet(urlValue, signal) {
  const url = new URL(urlValue);
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443") {
    throw new Error("Only standard-port HTTPS requests without embedded credentials are permitted.");
  }
  const pinned = await resolvePinnedAddress(url.hostname);
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const req = httpsRequest({
      protocol: "https:",
      hostname: url.hostname,
      port: 443,
      method: "GET",
      path: url.pathname + url.search,
      servername: url.hostname,
      lookup: (_hostname, _options, callback) => callback(null, pinned.address, pinned.family),
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/json,application/ld+json,application/xml,text/plain,application/pdf;q=0.9,*/*;q=0.1",
        "Accept-Encoding": "identity",
        "Connection": "close"
      },
      signal,
      timeout: REQUEST_TIMEOUT_MS
    }, response => {
      const chunks = [];
      let size = 0;
      response.on("data", chunk => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          req.destroy(new Error("Source response exceeded the 5 MB evidence limit."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({
        status: response.statusCode || 0,
        headers: response.headers,
        body: Buffer.concat(chunks),
        finalUrl: url.toString()
      }));
      response.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("Source request timed out.")));
    req.on("error", reject);
    req.end();
  });
}

async function writeEvent(admin, event) {
  const { error } = await admin.from("discovery_fetch_events").insert(event);
  if (error) throw new Error("Could not write mandatory discovery fetch audit event: " + error.message);
}

async function reserveQuota(admin, job, workerId, url, signal) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    throwIfAborted(signal);
    const { data, error } = await admin.rpc("reserve_discovery_fetch_request", {
      p_company_id: job.company_id,
      p_source_id: job.source_id,
      p_job_id: job.id,
      p_worker_id: workerId
    });
    if (error) throw new Error("Discovery source quota reservation failed closed: " + error.message);
    const result = Array.isArray(data) ? data[0] : data;
    if (result?.allowed) return;
    const retryAfter = Math.min(60, Math.max(1, Number(result?.retry_after_seconds || 1)));
    await writeEvent(admin, {
      company_id: job.company_id, job_id: job.id, source_id: job.source_id,
      event_type: "quota_denied", url: redactUrl(url), outcome: "wait",
      metadata: { retry_after_seconds: retryAfter, attempt: attempt + 1 }
    });
    await sleep(retryAfter * 1000);
  }
  throw new Error("Source quota remained exhausted after the bounded wait budget.");
}

async function controlledGet(admin, job, source, workerId, urlValue, signal, budget, purpose = "page") {
  let current = new URL(urlValue);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    throwIfAborted(signal);
    if (purpose === "robots") {
      const expected = new URL(makeRobotsUrl(source));
      if (current.origin !== expected.origin || current.pathname !== "/robots.txt") {
        throw new Error("Robots redirect left the exact robots.txt endpoint.");
      }
    } else {
      current = assertAllowedSourceUrl(source, current.toString());
    }
    budget.used += 1;
    if (budget.used > budget.max) throw new Error("Discovery job reached the hard outbound-request budget.");
    await reserveQuota(admin, job, workerId, current.toString(), signal);
    const safeUrl = redactUrl(current.toString());
    await writeEvent(admin, {
      company_id: job.company_id, job_id: job.id, source_id: job.source_id,
      event_type: "request_started", url: safeUrl, outcome: "requesting",
      metadata: { method: "GET", purpose, redirect_hop: hop }
    });
    const response = await rawHttpsGet(current.toString(), signal);
    await writeEvent(admin, {
      company_id: job.company_id, job_id: job.id, source_id: job.source_id,
      event_type: "response_received", url: safeUrl, http_status: response.status,
      response_bytes: response.body.length, outcome: "response",
      metadata: { content_type: response.headers["content-type"] || null, redirect_hop: hop }
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.location;
      if (!location || hop === MAX_REDIRECTS) throw new Error("Source redirect is missing or exceeds the three-hop limit.");
      const next = new URL(location, current);
      if (next.protocol !== "https:" || next.username || next.password || next.origin !== current.origin) {
        throw new Error("Cross-origin or non-HTTPS redirects are not permitted.");
      }
      if (purpose === "robots" && next.pathname !== "/robots.txt") throw new Error("Robots redirect changed its endpoint.");
      current = purpose === "robots" ? next : assertAllowedSourceUrl(source, next.toString());
      continue;
    }
    return response;
  }
  throw new Error("Redirect limit exceeded.");
}

function readContentType(headers) {
  return String(headers["content-type"] || "").split(";")[0].trim().toLowerCase();
}

async function loadRobots(admin, job, source, workerId, signal, budget) {
  const robotsUrl = makeRobotsUrl(source);
  const response = await controlledGet(admin, job, source, workerId, robotsUrl, signal, budget, "robots");
  if ([404, 410].includes(response.status)) return parseRobotsRules("");
  if (response.status < 200 || response.status >= 300) {
    await writeEvent(admin, {
      company_id: job.company_id, job_id: job.id, source_id: job.source_id,
      event_type: "robots_blocked", url: robotsUrl, http_status: response.status,
      outcome: "fail_closed_robots_unavailable"
    });
    throw new Error("Robots policy could not be read; fetch worker stopped fail-closed.");
  }
  const type = readContentType(response.headers);
  if (type && !["text/plain", "application/octet-stream"].includes(type)) {
    throw new Error("Robots endpoint did not return a plain-text policy file.");
  }
  return parseRobotsRules(response.body.toString("utf8"));
}

async function getCachedEvidence(admin, job, source, urlValue) {
  const key = sha256(source.id + ":" + urlValue);
  const { data, error } = await admin.from("discovery_fetch_cache")
    .select("evidence_id,content_hash,expires_at")
    .eq("source_id", source.id).eq("cache_key", key)
    .gt("expires_at", new Date().toISOString()).maybeSingle();
  if (error) throw error;
  return data ? { ...data, cacheKey: key } : null;
}

async function storeEvidence(admin, job, source, urlValue, response) {
  const contentType = readContentType(response.headers);
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new Error("Source content type is not in the fetch worker evidence allow-list.");
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error("Source returned non-success HTTP status " + response.status + ".");
  }
  if (response.body.length > MAX_BODY_BYTES) throw new Error("Evidence exceeded the 5 MB limit.");
  const contentHash = sha256(response.body);
  const objectPath = [job.company_id, job.id, randomUUID() + "-" + contentHash + ".bin"].join("/");
  const { error: uploadError } = await admin.storage.from("discovery-evidence")
    .upload(objectPath, response.body, { contentType, upsert: false, cacheControl: "3600" });
  if (uploadError) throw new Error("Private evidence object upload failed: " + uploadError.message);

  const safeHeaders = {};
  for (const key of ["content-type", "content-length", "etag", "last-modified", "date"]) {
    if (response.headers[key]) safeHeaders[key] = String(response.headers[key]).slice(0, 500);
  }
  const { data: evidence, error: insertError } = await admin.from("discovery_evidence_items").insert({
    company_id: job.company_id,
    job_id: job.id,
    source_id: source.id,
    canonical_url: redactUrl(urlValue),
    captured_at: new Date().toISOString(),
    source_published_at: null,
    content_hash: contentHash,
    raw_blob_ref: "discovery-evidence:" + objectPath,
    content_type: contentType,
    byte_length: response.body.length,
    attribution: source.attribution || "",
    jurisdiction: source.jurisdiction || "GLOBAL",
    licence_snapshot: {
      terms_url: source.terms_url || null,
      license_ref: source.license_ref || null,
      legal_basis: source.legal_basis || null,
      allowed_purposes: source.allowed_purposes || [],
      allowed_fields: source.allowed_fields || [],
      retention_days: source.retention_days || null
    },
    response_metadata: { http_status: response.status, headers: safeHeaders, fetched_url: redactUrl(response.finalUrl) }
  }).select("id").single();
  if (insertError) throw new Error("Evidence metadata insert failed: " + insertError.message);

  const cacheKey = sha256(source.id + ":" + urlValue);
  const retentionSeconds = Math.max(60, Number(source.retention_days || 1) * 86400);
  const ttlSeconds = Math.min(CACHE_SECONDS, retentionSeconds);
  const fetchedAt = new Date();
  const expiresAt = new Date(fetchedAt.getTime() + ttlSeconds * 1000);
  const { error: cacheError } = await admin.from("discovery_fetch_cache").upsert({
    company_id: job.company_id,
    source_id: source.id,
    cache_key: cacheKey,
    canonical_url: redactUrl(urlValue),
    evidence_id: evidence.id,
    content_hash: contentHash,
    fetched_at: fetchedAt.toISOString(),
    expires_at: expiresAt.toISOString()
  }, { onConflict: "source_id,cache_key" });
  if (cacheError) throw new Error("Evidence cache metadata insert failed: " + cacheError.message);
  return evidence.id;
}

async function fetchCandidate(admin, job, source, workerId, urlValue, robots, signal, budget) {
  const url = assertAllowedSourceUrl(source, urlValue).toString();
  if (!robots.allows(url)) {
    await writeEvent(admin, {
      company_id: job.company_id, job_id: job.id, source_id: job.source_id,
      event_type: "robots_blocked", url: redactUrl(url), outcome: "blocked_by_robots_txt"
    });
    return { blocked: true };
  }

  const cached = await getCachedEvidence(admin, job, source, url);
  if (cached) {
    await writeEvent(admin, {
      company_id: job.company_id, job_id: job.id, source_id: job.source_id,
      evidence_id: cached.evidence_id, event_type: "cache_hit", url: redactUrl(url),
      outcome: "reused_unexpired_evidence", metadata: { content_hash: cached.content_hash, expires_at: cached.expires_at }
    });
    return { cached: true, evidenceId: cached.evidence_id };
  }

  const response = await controlledGet(admin, job, source, workerId, url, signal, budget, "page");
  const evidenceId = await storeEvidence(admin, job, source, url, response);
  return { cached: false, evidenceId };
}

async function loadJobContext(admin, job) {
  const [{ data: source, error: sourceError }, { data: profile, error: profileError }, { data: link, error: linkError }] = await Promise.all([
    admin.from("discovery_source_registry").select("*").eq("company_id", job.company_id).eq("id", job.source_id).maybeSingle(),
    admin.from("discovery_profiles").select("*").eq("company_id", job.company_id).eq("id", job.profile_id).maybeSingle(),
    admin.from("discovery_profile_sources").select("profile_id").eq("company_id", job.company_id)
      .eq("profile_id", job.profile_id).eq("source_id", job.source_id).maybeSingle()
  ]);
  if (sourceError) throw sourceError;
  if (profileError) throw profileError;
  if (linkError) throw linkError;
  if (!source || !profile || !link) throw new Error("Discovery job source, profile or attachment could not be confirmed.");
  if (source.status !== "approved" || !profile.enabled) throw new Error("Discovery source approval or profile enablement has been revoked.");
  assertSourceCanBeAttached(profile, source);
  const purpose = job.payload?.purpose;
  if (purpose !== profile.purpose) throw new Error("Discovery job purpose no longer matches the approved profile.");
  assertPurposeAllowed(source, purpose);
  if (["manual_research"].includes(source.connector_key)) throw new Error("Manual research sources are not eligible for automated fetching.");
  return { source, profile, purpose };
}

async function runJob(admin, job, workerId, signal) {
  const { source } = await loadJobContext(admin, job);
  const candidateUrls = validateCandidateUrls(source, job.payload?.candidateUrls);
  const budget = { used: 0, max: Math.min(200, (candidateUrls.length + 1) * (MAX_REDIRECTS + 1) * 3) };
  const robots = await loadRobots(admin, job, source, workerId, signal, budget);
  const failures = [];
  const crawler = new BasicCrawler({
    maxConcurrency: Math.min(2, candidateUrls.length),
    minConcurrency: 1,
    maxRequestRetries: 2,
    maxRequestsPerCrawl: candidateUrls.length,
    maxCrawlDepth: 0,
    requestHandlerTimeoutSecs: 45,
    requestHandler: async ({ request }) => {
      try {
        await fetchCandidate(admin, job, source, workerId, request.url, robots, signal, budget);
      } catch (error) {
        throw error;
      }
    },
    failedRequestHandler: async ({ request }, error) => {
      failures.push({ url: redactUrl(request.url), message: String(error?.message || "Fetch failed").slice(0, 1000) });
      await writeEvent(admin, {
        company_id: job.company_id, job_id: job.id, source_id: job.source_id,
        event_type: "request_failed", url: redactUrl(request.url), outcome: "retry_budget_exhausted",
        error_code: "DISCOVERY_FETCH_FAILED", error_message: String(error?.message || "Fetch failed").slice(0, 1000)
      });
    }
  });
  await crawler.run(candidateUrls.map(url => ({ url, uniqueKey: sha256(url) })));
  if (failures.length) {
    const error = new Error("One or more approved candidate URLs failed after bounded retries.");
    error.code = "DISCOVERY_FETCH_PARTIAL_FAILURE";
    error.details = failures;
    throw error;
  }
}

export async function runDiscoveryWorkerOnce(admin, workerId) {
  const { data: claimed, error: claimError } = await admin.rpc("claim_enabled_discovery_job", {
    p_worker_id: workerId,
    p_lease_seconds: 90
  });
  if (claimError) throw new Error("Could not claim discovery queue work: " + claimError.message);
  const job = Array.isArray(claimed) ? claimed[0] : claimed;
  if (!job) return false;

  const controller = new AbortController();
  let heartbeatBusy = false;
  const heartbeatTimer = setInterval(async () => {
    if (heartbeatBusy || controller.signal.aborted) return;
    heartbeatBusy = true;
    try {
      const { data, error } = await admin.rpc("heartbeat_discovery_job", {
        p_job_id: job.id, p_worker_id: workerId, p_lease_seconds: 90
      });
      if (error || data !== true) controller.abort(new Error("Worker lease or company fetch grant is no longer valid."));
    } catch {
      controller.abort(new Error("Worker heartbeat failed; stopping current work."));
    } finally {
      heartbeatBusy = false;
    }
  }, 20_000);

  try {
    await runJob(admin, job, workerId, controller.signal);
    if (controller.signal.aborted) throw new Error("Worker grant was revoked or lease was lost before completion.");
    const { data, error } = await admin.rpc("finish_discovery_job", {
      p_job_id: job.id, p_worker_id: workerId, p_succeeded: true,
      p_error_code: null, p_error_message: null
    });
    if (error || data !== true) throw new Error("Discovery job completion could not be confirmed against its live lease.");
  } catch (error) {
    const code = String(error?.code || "DISCOVERY_FETCH_WORKER_FAILED").slice(0, 100);
    const message = String(error?.message || "Discovery fetch worker failed.").slice(0, 1000);
    await admin.rpc("finish_discovery_job", {
      p_job_id: job.id, p_worker_id: workerId, p_succeeded: false,
      p_error_code: code, p_error_message: message
    });
  } finally {
    clearInterval(heartbeatTimer);
  }
  return true;
}

export async function runDiscoveryWorker() {
  if (process.env.DISCOVERY_WORKER_ENABLED !== "true") {
    console.info("AXIVESTRA discovery worker disabled: DISCOVERY_WORKER_ENABLED is not true.");
    return;
  }
  const admin = makeAdminClient();
  const workerId = process.env.AXIVESTRA_DISCOVERY_WORKER_ID || ("axivestra-worker-" + randomUUID());
  const pollMs = Math.max(1000, Math.min(30_000, Number(process.env.DISCOVERY_WORKER_POLL_MS || 5000)));
  let stopping = false;
  process.once("SIGINT", () => { stopping = true; });
  process.once("SIGTERM", () => { stopping = true; });
  console.info("AXIVESTRA governed discovery worker started. Company grants remain disabled until explicitly enabled by an owner/admin.");
  while (!stopping) {
    try {
      const didWork = await runDiscoveryWorkerOnce(admin, workerId);
      if (!didWork) await sleep(pollMs);
    } catch (error) {
      console.error("AXIVESTRA discovery worker poll failed closed:", String(error?.message || error));
      await sleep(pollMs);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runDiscoveryWorker().catch(error => {
    console.error("AXIVESTRA discovery worker stopped:", error);
    process.exitCode = 1;
  });
}
