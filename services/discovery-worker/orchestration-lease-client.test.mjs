import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createOrchestrationLeaseClient } from "./orchestration-lease-client.mjs";

const workerToken = randomBytes(32).toString("hex");
const publicApiKey = "sb_publishable_axivestra_test_public_key";
const common = {
  supabaseUrl: "https://axivestra-test.supabase.co",
  publicApiKey,
  companyId: "11111111-1111-4111-8111-111111111111",
  workerIdentityId: "22222222-2222-4222-8222-222222222222",
  workerToken
};
const ok = body => ({ ok: true, status: 200, json: async () => body });
const fail = (status, error) => ({ ok: false, status, json: async () => ({ ok: false, error }) });

test("E20.4 worker client calls the narrow broker and never calls the service role", async () => {
  const calls = [];
  const leaseToken = randomBytes(32).toString("hex");
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, init, body });
    if (body.action === "claim") {
      return ok({
        ok: true,
        lease: {
          leaseId: "33333333-3333-4333-8333-333333333333",
          executionId: "44444444-4444-4444-8444-444444444444",
          runId: "55555555-5555-4555-8555-555555555555",
          stepId: "66666666-6666-4666-8666-666666666666",
          stageKey: "e05_extraction",
          adapterKey: "e05-test-v1",
          workerIdentity: "test-worker",
          leasedAt: "2026-11-23T12:00:00Z",
          expiresAt: "2026-11-23T12:02:00Z"
        },
        leaseToken
      });
    }
    if (body.action === "heartbeat") return ok({ ok: true, renewed: true });
    if (body.action === "release") return ok({ ok: true, released: true });
    return fail(400, "Unsupported action.");
  };
  const client = createOrchestrationLeaseClient({ ...common, fetchImpl });
  const lease = await client.claim({ leaseSeconds: 90 });

  assert.equal(lease.leaseId, "33333333-3333-4333-8333-333333333333");
  assert.equal(Object.hasOwn(lease, "leaseToken"), false, "raw lease token stays inside the client memory map");
  assert.equal(client.activeLeaseCount(), 1);
  assert.equal(calls[0].url, "https://axivestra-test.supabase.co/functions/v1/discovery-orchestration-worker");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.headers.apikey, publicApiKey);
  assert.equal(calls[0].init.headers["x-axivestra-worker-token"], workerToken);
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.deepEqual(
    Object.keys(calls[0].init.headers).sort(),
    ["apikey","cache-control","content-type","x-axivestra-worker-token"].sort(),
    "worker requests carry only the public API key and its own scoped token (plus transport headers)"
  );
  assert.equal(JSON.stringify(calls[0].body).includes(workerToken), false, "scoped token must not be duplicated into the request body");
  assert.equal(JSON.stringify(calls[0].body).includes(publicApiKey), false, "public key must remain in the apikey header");
  assert.equal(JSON.stringify(calls[0].init.headers).toLowerCase().includes("service_role"), false, "service-role credentials must never enter the worker process");
  assert.deepEqual(calls[0].body, {
    action: "claim", companyId: common.companyId,
    workerIdentityId: common.workerIdentityId, leaseSeconds: 90
  });

  assert.equal(await client.heartbeat(lease.leaseId, { leaseSeconds: 60 }), true);
  assert.equal(calls[1].body.leaseToken, leaseToken);
  assert.equal(calls[1].body.leaseSeconds, 60);
  assert.equal(calls[1].body.p_lease_token_hash, undefined);
  assert.equal(calls[1].body.p_worker_credential_hash, undefined);

  assert.equal(await client.release(lease.leaseId, "Worker finished its lease handoff safely."), true);
  assert.equal(calls[2].body.leaseToken, leaseToken);
  assert.equal(calls[2].body.reason, "Worker finished its lease handoff safely.");
  assert.equal(client.activeLeaseCount(), 0);
});

test("E20.4 returns no work when the server-side dispatch gate returns an empty claim", async () => {
  const client = createOrchestrationLeaseClient({
    ...common,
    fetchImpl: async (_url, init) => {
      assert.equal(JSON.parse(init.body).action, "claim");
      return ok({ ok: true, lease: null });
    }
  });
  assert.equal(await client.claim(), null);
  assert.equal(client.activeLeaseCount(), 0);
});

test("E20.4 fails closed on broker errors and rejects insecure or incomplete configuration", async () => {
  assert.throws(() => createOrchestrationLeaseClient({
    ...common, supabaseUrl: "http://example.com", fetchImpl: async () => ok({})
  }), /must use HTTPS/);
  assert.throws(() => createOrchestrationLeaseClient({
    ...common, workerToken: "short", fetchImpl: async () => ok({})
  }), /scoped worker credential is missing or invalid/);
  assert.throws(() => createOrchestrationLeaseClient({
    ...common, publicApiKey: "", fetchImpl: async () => ok({})
  }), /public API key is missing or invalid/);

  const denied = createOrchestrationLeaseClient({
    ...common,
    fetchImpl: async () => fail(401, "A valid scoped worker credential is required.")
  });
  await assert.rejects(denied.claim(), /claim failed closed: A valid scoped worker credential is required/);

  const expired = createOrchestrationLeaseClient({
    ...common,
    fetchImpl: async () => fail(409, "The worker grant expired.")
  });
  await assert.rejects(expired.claim(), /claim failed closed: The worker grant expired\./);
});

test("E20.4 discards its local lease token after a valid broker release receipt even when already released", async () => {
  let actionCount = 0;
  const client = createOrchestrationLeaseClient({
    ...common,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      actionCount += 1;
      if (body.action === "claim") {
        return ok({
          ok: true,
          lease: {
            leaseId: "77777777-7777-4777-8777-777777777777",
            executionId: "88888888-8888-4888-8888-888888888888"
          },
          leaseToken: randomBytes(32).toString("hex")
        });
      }
      return ok({ ok: true, released: false });
    }
  });
  const lease = await client.claim();
  assert.equal(client.activeLeaseCount(), 1);
  assert.equal(await client.release(lease.leaseId, "Lease was already released by the control plane."), false);
  assert.equal(client.activeLeaseCount(), 0);
  assert.equal(actionCount, 2);
});

test("E20.4 cannot renew or release a lease after the client has forgotten its token", async () => {
  const calls = [];
  const client = createOrchestrationLeaseClient({
    ...common,
    fetchImpl: async (_url, init) => {
      calls.push(JSON.parse(init.body));
      return ok({ ok: true, renewed: true, released: true });
    }
  });
  client.forgetLease("33333333-3333-4333-8333-333333333333");
  assert.equal(await client.heartbeat("33333333-3333-4333-8333-333333333333"), false);
  assert.equal(await client.release("33333333-3333-4333-8333-333333333333", "No in-memory token remains for this lease."), false);
  assert.deepEqual(calls, []);
});

test("E20.4 does not preserve a token when the broker response is incomplete", async () => {
  const client = createOrchestrationLeaseClient({
    ...common,
    fetchImpl: async () => ok({ ok: true, lease: { leaseId: "not-a-uuid" }, leaseToken: randomBytes(32).toString("hex") })
  });
  await assert.rejects(client.claim(), /incomplete lease receipt/);
  assert.equal(client.activeLeaseCount(), 0);
});
