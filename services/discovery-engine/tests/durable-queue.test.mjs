import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../../../supabase/migrations/20261122170000_discovery_durable_queue.sql", import.meta.url), "utf8");

test("durable discovery queue is company-scoped and idempotent", () => {
  assert.match(migration, /create table if not exists public\.discovery_jobs/);
  assert.match(migration, /unique \(company_id, idempotency_key\)/);
  assert.match(migration, /foreign key \(company_id, profile_id\)/);
  assert.match(migration, /foreign key \(company_id, source_id\)/);
});

test("workers claim jobs with row locking and no duplicate concurrent claim", () => {
  assert.match(migration, /for update of j skip locked/i);
  assert.match(migration, /lease_owner = p_worker_id/);
  assert.match(migration, /lease_expires_at/);
});

test("expired jobs recover with capped attempts and bounded backoff", () => {
  assert.match(migration, /WORKER_LEASE_EXPIRED/);
  assert.match(migration, /attempts >= max_attempts/);
  assert.match(migration, /least\(30 \* greatest\(attempts, 1\), 300\)/);
});

test("source request quota is serialized on a per-source row lock", () => {
  assert.match(migration, /discovery_source_quota_windows/);
  assert.match(migration, /for update;/i);
  assert.match(migration, /rate_limit_per_minute/);
  assert.match(migration, /extract\(epoch from \(v_now - v_quota\.window_started_at\)\)/);
});

test("only active leased jobs can reserve source requests or heartbeat", () => {
  assert.match(migration, /status = 'running'/);
  assert.match(migration, /lease_owner = p_worker_id/);
  assert.match(migration, /lease_expires_at > v_now/);
  assert.match(migration, /heartbeat_discovery_job/);
});

test("RPCs are unavailable to browser roles and granted to service role only", () => {
  assert.match(migration, /revoke all on function public\.claim_discovery_job\(text,integer\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.claim_discovery_job\(text,integer\) to service_role/);
  assert.match(migration, /revoke all on public\.discovery_jobs from anon, authenticated/);
});
