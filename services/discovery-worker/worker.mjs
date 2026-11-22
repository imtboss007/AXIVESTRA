import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { BasicCrawler } from "crawlee";
import { chromium } from "playwright";
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

async function storeEvidence(admin, job, source, urlValue, response, options = {}) {
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
    evidence_kind: options.evidenceKind || "raw_response",
    parent_evidence_id: options.parentEvidenceId || null,
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
    response_metadata: { http_status: response.status, headers: safeHeaders, fetched_url: redactUrl(response.finalUrl), ...(options.responseMetadata || {}) }
  }).select("id").single();
  if (insertError) throw new Error("Evidence metadata insert failed: " + insertError.message);

  if (options.cache === false || options.evidenceKind === "rendered_dom") return evidence.id;

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
    const { data: item, error } = await admin.from("discovery_evidence_items")
      .select("raw_blob_ref,content_type").eq("id", cached.evidence_id).maybeSingle();
    if (error || !item?.raw_blob_ref) throw new Error("Cached evidence metadata is unavailable.");
    const objectPath = String(item.raw_blob_ref).replace(/^discovery-evidence:/, "");
    const { data: blob, error: downloadError } = await admin.storage.from("discovery-evidence").download(objectPath);
    if (downloadError || !blob) throw new Error("Cached raw evidence object could not be loaded.");
    return {
      cached: true, evidenceId: cached.evidence_id,
      response: { status: 200, headers: { "content-type": item.content_type }, body: Buffer.from(await blob.arrayBuffer()), finalUrl: url }
    };
  }

  const response = await controlledGet(admin, job, source, workerId, url, signal, budget, "page");
  const evidenceId = await storeEvidence(admin, job, source, url, response);
  return { cached: false, evidenceId, response };
}


async function renderCandidateWithPlaywright(admin, job, source, workerId, url, rawResponse, parentEvidenceId, robots, signal, budget) {
  if (source.render_mode !== "browser" || source.source_type !== "permitted_public_page") {
    throw new Error("Browser rendering is not approved for this source.");
  }
  throwIfAborted(signal);
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined,
    args: ["--disable-dev-shm-usage"]
  });
  let context;
  try {
    context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: false, permissions: [] });
    context.setDefaultTimeout(10_000);
    const page = await context.newPage();
    await context.addInitScript(() => {
      const blocked = class {
        constructor() { throw new Error("This browser capability is disabled in the AXIVESTRA fetch sandbox."); }
      };
      for (const key of ["WebSocket", "EventSource", "WebTransport", "RTCPeerConnection", "webkitRTCPeerConnection"]) {
        try { Object.defineProperty(window, key, { value: blocked, configurable: false, writable: false }); } catch { /* immutable browser property */ }
      }
      try { Object.defineProperty(navigator, "sendBeacon", { value: () => false, configurable: false }); } catch { /* immutable browser property */ }
    });
    page.on("websocket", socket => { try { socket.close(); } catch { /* closed by browser */ } });
    context.on("page", popup => { if (popup !== page) void popup.close(); });
    let initialResponseUsed = false;

    await context.route("**/*", async route => {
      const request = route.request();
      const requestUrl = request.url();
      const parsed = new URL(requestUrl);
      if (["data:", "blob:", "about:"].includes(parsed.protocol)) {
        await route.continue();
        return;
      }
      if (parsed.protocol !== "https:" || request.method() !== "GET") {
        await route.abort("blockedbyclient");
        return;
      }
      if (request.frame().page() !== page || (request.isNavigationRequest() && requestUrl !== url)) {
        await route.abort("blockedbyclient");
        return;
      }
      if (requestUrl === url && !initialResponseUsed) {
        initialResponseUsed = true;
        await route.fulfill({
          status: rawResponse.status,
          headers: {
            "content-type": rawResponse.headers["content-type"] || "text/html",
            ...(rawResponse.headers["content-security-policy"] ? { "content-security-policy": String(rawResponse.headers["content-security-policy"]) } : {})
          },
          body: rawResponse.body
        });
        return;
      }
      let target;
      try { target = assertAllowedSourceUrl(source, requestUrl); }
      catch {
        await writeEvent(admin, {
          company_id: job.company_id, job_id: job.id, source_id: source.id,
          event_type: "policy_rejected", url: redactUrl(requestUrl), outcome: "browser_subresource_outside_source_allowlist"
        });
        await route.abort("blockedbyclient");
        return;
      }
      if (!robots.allows(target.toString())) {
        await writeEvent(admin, {
          company_id: job.company_id, job_id: job.id, source_id: source.id,
          event_type: "robots_blocked", url: redactUrl(target.toString()), outcome: "browser_subresource_disallowed"
        });
        await route.abort("blockedbyclient");
        return;
      }
      try {
        const response = await controlledGet(admin, job, source, workerId, target.toString(), signal, budget, "browser_subresource");
        await route.fulfill({
          status: response.status,
          headers: {
            "content-type": response.headers["content-type"] || "application/octet-stream",
            ...(response.headers["content-security-policy"] ? { "content-security-policy": String(response.headers["content-security-policy"]) } : {})
          },
          body: response.body
        });
      } catch {
        await route.abort("failed");
      }
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
    await page.waitForTimeout(1500);
    throwIfAborted(signal);
    const renderedHtml = Buffer.from(await page.content(), "utf8");
    if (renderedHtml.length > MAX_BODY_BYTES) throw new Error("Rendered DOM exceeded the 5 MB evidence limit.");
    const renderedId = await storeEvidence(admin, job, source, url, {
      status: 200,
      headers: { "content-type": "text/html" },
      body: renderedHtml,
      finalUrl: url
    }, {
      evidenceKind: "rendered_dom",
      parentEvidenceId,
      cache: false,
      responseMetadata: { render_mode: "playwright", source_evidence_id: parentEvidenceId, resource_budget_used: budget.used }
    });
    await writeEvent(admin, {
      company_id: job.company_id, job_id: job.id, source_id: source.id,
      evidence_id: renderedId, event_type: "response_received", url: redactUrl(url),
      outcome: "rendered_dom_snapshot_stored", response_bytes: renderedHtml.length,
      metadata: { render_mode: "playwright", source_evidence_id: parentEvidenceId }
    });
    return renderedId;
  } finally {
    if (context) await context.close();
    await browser.close();
  }
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
        const fetched = await fetchCandidate(admin, job, source, workerId, request.url, robots, signal, budget);
        if (!fetched.blocked && source.render_mode === "browser") {
          if (!fetched.response || !fetched.evidenceId) throw new Error("A raw evidence snapshot is required before browser rendering.");
          await renderCandidateWithPlaywright(
            admin, job, source, workerId, request.url, fetched.response,
            fetched.evidenceId, robots, signal, budget
          );
        }
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

export async function runRetentionSweep(admin) {
  const { data, error } = await admin.from("discovery_evidence_items")
    .select("id,raw_blob_ref,captured_at,source:discovery_source_registry!inner(retention_days)")
    .order("captured_at", { ascending: true })
    .limit(100);
  if (error) throw new Error("Evidence retention query failed: " + error.message);
  let deleted = 0;
  for (const item of data || []) {
    const source = Array.isArray(item.source) ? item.source[0] : item.source;
    const retentionDays = Math.max(1, Number(source?.retention_days || 90));
    const ageMs = Date.now() - Date.parse(item.captured_at);
    if (!Number.isFinite(ageMs) || ageMs < retentionDays * 86_400_000) continue;
    const separator = String(item.raw_blob_ref || "").indexOf(":");
    if (separator < 1) continue;
    const bucket = item.raw_blob_ref.slice(0, separator);
    const objectPath = item.raw_blob_ref.slice(separator + 1);
    const { error: removeError } = await admin.storage.from(bucket).remove([objectPath]);
    if (removeError) {
      console.error("Discovery evidence retention could not delete private object:", removeError.message);
      continue;
    }
    const { error: deleteError } = await admin.from("discovery_evidence_items").delete().eq("id", item.id);
    if (deleteError) {
      console.error("Discovery evidence retention metadata delete failed:", deleteError.message);
      continue;
    }
    deleted += 1;
  }
  const { error: cacheError } = await admin.from("discovery_fetch_cache")
    .delete().lt("expires_at", new Date().toISOString());
  if (cacheError) throw new Error("Expired fetch-cache cleanup failed: " + cacheError.message);
  return deleted;
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
  let lastRetentionSweep = 0;
  process.once("SIGINT", () => { stopping = true; });
  process.once("SIGTERM", () => { stopping = true; });
  console.info("AXIVESTRA governed discovery worker started. Company grants remain disabled until explicitly enabled by an owner/admin.");
  while (!stopping) {
    try {
      if (Date.now() - lastRetentionSweep >= 15 * 60 * 1000) {
        const purged = await runRetentionSweep(admin);
        lastRetentionSweep = Date.now();
        if (purged) console.info("AXIVESTRA discovery retention removed " + purged + " expired evidence objects.");
      }
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
