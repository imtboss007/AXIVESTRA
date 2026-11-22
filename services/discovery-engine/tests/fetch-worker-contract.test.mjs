import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const worker = await readFile(new URL("../../discovery-worker/worker.mjs", import.meta.url), "utf8");
const migration = await readFile(new URL("../../../supabase/migrations/20261122180000_discovery_fetch_evidence.sql", import.meta.url), "utf8");
const control = await readFile(new URL("../../../supabase/functions/discovery-control/index.ts", import.meta.url), "utf8");

test("E04 uses one Crawlee TypeScript service with bounded concurrency and retries", () => {
  assert.match(worker, /import \{ BasicCrawler \} from "crawlee"/);
  assert.match(worker, /maxConcurrency: Math\.min\(2, candidateUrls\.length\)/);
  assert.match(worker, /maxRequestRetries: 2/);
  assert.match(worker, /maxRequestsPerCrawl: candidateUrls\.length/);
  assert.match(worker, /maxCrawlDepth: 0/);
});

test("shared source quota is reserved before each outbound HTTPS request", () => {
  const controlled = worker.slice(worker.indexOf("async function controlledGet"), worker.indexOf("function readContentType"));
  assert.ok(controlled.indexOf("reserveQuota(") < controlled.indexOf("rawHttpsGet("));
  assert.match(controlled, /budget\.used > budget\.max/);
});

test("redirects are bounded, same-origin and revalidated through source URL policy", () => {
  assert.match(worker, /MAX_REDIRECTS = 3/);
  assert.match(worker, /next\.origin !== current\.origin/);
  assert.match(worker, /assertAllowedSourceUrl\(source, next\.toString\(\)\)/);
});

test("worker never runs unless both process environment and company grant permit it", () => {
  assert.match(worker, /DISCOVERY_WORKER_ENABLED !== "true"/);
  assert.match(migration, /wc\.enabled = true and wc\.expires_at > v_now/);
  assert.match(migration, /grant execute on function public\.claim_enabled_discovery_job\(text,integer\) to service_role/);
});

test("evidence storage is private, size-bounded and company-scoped", () => {
  assert.match(migration, /'discovery-evidence',[\s\S]*?false,[\s\S]*?5000000/);
  assert.match(migration, /create table if not exists public\.discovery_evidence_items/);
  assert.match(migration, /create table if not exists public\.discovery_fetch_events/);
  assert.match(migration, /create table if not exists public\.discovery_fetch_cache/);
  assert.match(migration, /revoke all on public\.discovery_evidence_items from anon, authenticated/);
});

test("enqueue transaction writes one audit receipt atomically", () => {
  assert.match(migration, /create or replace function public\.enqueue_discovery_job/);
  assert.match(migration, /insert into public\.discovery_audit_events/);
  assert.match(control, /admin\.rpc\("enqueue_discovery_job"/);
  assert.doesNotMatch(control, /admin\.from\("discovery_jobs"\)\.insert/);
});

test("idempotency compares the complete enqueue payload to prevent accidental reuse", () => {
  assert.match(control, /existing\.payload\?\.purpose === purpose/);
  assert.match(control, /existing\.payload\?\.criteria \|\| \{\}/);
  assert.match(control, /existing\.payload\?\.candidateUrls \|\| \[\]/);
});

test("enqueue is available to company members but only allow-listed bounded candidate URLs are accepted", () => {
  assert.match(control, /if \(!canManage && action !== "jobs\.enqueue"\)/);
  assert.match(control, /candidateInput\.length > Number\(source\.max_pages_per_job/);
  assert.match(control, /assertAllowedSourceUrl\(source, value\)/);
  assert.match(control, /candidateUrls/);
});

test("Playwright rendering remains source-scoped and routes every network request through policy gates", () => {
  assert.match(worker, /source\.render_mode !== "browser"/);
  assert.match(worker, /await context\.route\("\*\*\/\*\*"/);
  assert.match(worker, /request\.method\(\) !== "GET"/);
  assert.match(worker, /request\.isNavigationRequest\(\) && requestUrl !== url/);
  assert.match(worker, /assertAllowedSourceUrl\(source, requestUrl\)/);
  assert.match(worker, /robots\.allows\(target\.toString\(\)\)/);
  assert.match(worker, /controlledGet\(admin, job, source, workerId, target\.toString\(\)/);
  assert.match(worker, /socket\.close\(\)/);
  assert.match(worker, /Object\.defineProperty\(window, key/);
  assert.match(worker, /RTCPeerConnection/);
  assert.match(worker, /request\.frame\(\)\.page\(\) !== page/);
  assert.match(worker, /evidenceKind: "rendered_dom"/);
});

test("company fetch grant expires automatically and can be revoked", () => {
  assert.match(control, /Date\.now\(\) \+ 60 \* 60 \* 1000/);
  assert.match(control, /action === "workers\.control"/);
  assert.match(migration, /expires_at timestamptz not null default \(now\(\) \+ interval '1 hour'\)/);
  assert.match(migration, /heartbeat_discovery_job/);
});
