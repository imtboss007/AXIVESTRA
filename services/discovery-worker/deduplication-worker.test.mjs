import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runDeduplicationWorkerOnce } from "./deduplication-worker.mjs";

const worker = await readFile(new URL("./deduplication-worker.mjs", import.meta.url), "utf8");
const migration = await readFile(new URL("../../supabase/migrations/20261122270000_discovery_deduplication_queue.sql", import.meta.url), "utf8");

test("E12 worker is opt-in, server-side only and performs no network calls", () => {
  assert.match(worker, /DISCOVERY_DEDUPLICATION_WORKER_ENABLED !== "true"/);
  assert.match(worker, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(worker, /no network calls/i);
  assert.doesNotMatch(worker, /fetch\\s*\\(/);
  assert.doesNotMatch(worker, /axios|got\\(|https?\\.request/);
});

test("E12 worker claims and completes through leased database RPCs", async () => {
  const calls = [];
  const admin = { async rpc(name, args) {
    calls.push({ name, args });
    if (name === "claim_discovery_deduplication_job") return { data: [{ id: "job-1", company_id: "company-1" }], error: null };
    if (name === "complete_discovery_deduplication_job") return { data: 2, error: null };
    return { data: true, error: null };
  }};
  assert.equal(await runDeduplicationWorkerOnce(admin, "dedup-worker-test"), true);
  assert.deepEqual(calls.map(x => x.name), ["claim_discovery_deduplication_job","complete_discovery_deduplication_job"]);
  assert.equal(calls[0].args.p_worker_id, "dedup-worker-test");
  assert.equal(calls[1].args.p_job_id, "job-1");
});

test("E12 worker is idle when no company job is claimable", async () => {
  const calls = [];
  const admin = { async rpc(name) { calls.push(name); return { data: [], error: null }; }};
  assert.equal(await runDeduplicationWorkerOnce(admin, "dedup-worker-test"), false);
  assert.deepEqual(calls, ["claim_discovery_deduplication_job"]);
});

test("E12 worker records a bounded failure when completion is rejected", async () => {
  const calls = [];
  const admin = { async rpc(name, args) {
    calls.push({ name, args });
    if (name === "claim_discovery_deduplication_job") return { data: [{ id: "job-2", company_id: "company-2" }], error: null };
    if (name === "complete_discovery_deduplication_job") return { data: null, error: { message: "company worker grant expired" } };
    return { data: true, error: null };
  }};
  assert.equal(await runDeduplicationWorkerOnce(admin, "dedup-worker-test"), true);
  assert.deepEqual(calls.map(x => x.name), ["claim_discovery_deduplication_job","complete_discovery_deduplication_job","fail_discovery_deduplication_job"]);
  assert.equal(calls[2].args.p_job_id, "job-2");
  assert.match(calls[2].args.p_error_message, /company worker grant expired/);
});

test("E12 queue coalesces company updates and rechecks the existing worker kill switch", () => {
  assert.match(migration, /unique \\(company_id\\)/);
  assert.match(migration, /rerun_requested/);
  assert.match(migration, /for update of j skip locked/);
  assert.match(migration, /discovery_company_worker_controls/);
  assert.match(migration, /enqueue_discovery_deduplication_from_record/);
  assert.match(migration, /after insert or update/);
});
