import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { createRequireAuth } from "../src/auth.mjs";
import { withAuthenticatedRls } from "../src/db.mjs";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const claims = { sub: USER_ID, role: "authenticated", iss: "http://issuer.test", aud: "axivestra-api" };

test("protected Hono routes reject missing bearer tokens", async () => {
  const app = new Hono();
  app.use("/v1/*", createRequireAuth({
    jwks: {},
    issuer: claims.iss,
    audience: claims.aud,
    verifyToken: async () => ({ payload: claims })
  }));
  app.get("/v1/session", context => context.json({ ok: true }));
  const response = await app.request("/v1/session");
  assert.equal(response.status, 401);
});

test("protected Hono routes reject tokens that do not verify", async () => {
  const app = new Hono();
  app.use("/v1/*", createRequireAuth({
    jwks: {},
    issuer: claims.iss,
    audience: claims.aud,
    verifyToken: async () => { throw new Error("signature verification failed"); }
  }));
  app.get("/v1/session", context => context.json({ ok: true }));
  const response = await app.request("/v1/session", {
    headers: { Authorization: "Bearer invalid-token" }
  });
  assert.equal(response.status, 401);
});

test("authenticated RLS helper sets role and claims inside one transaction", async () => {
  const calls = [];
  const client = {
    query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; },
    release: () => calls.push({ sql: "RELEASE" })
  };
  const pool = { connect: async () => client };
  const result = await withAuthenticatedRls(pool, claims, async () => {
    calls.push({ sql: "APPLICATION QUERY" });
    return ["scoped"];
  });
  assert.deepEqual(result, ["scoped"]);
  assert.equal(calls[0].sql, "BEGIN");
  assert.equal(calls[1].sql, "SET LOCAL ROLE authenticated");
  assert.match(calls[2].sql, /set_config\('request\.jwt\.claims'/);
  assert.deepEqual(JSON.parse(calls[2].params[0]), claims);
  assert.equal(calls[4].sql, "COMMIT");
  assert.equal(calls.at(-1).sql, "RELEASE");
});

test("RLS helper rolls back if an application query fails", async () => {
  const calls = [];
  const client = {
    query: async sql => {
      calls.push(sql);
      if (sql === "APPLICATION QUERY") throw new Error("test failure");
      return { rows: [] };
    },
    release: () => calls.push("RELEASE")
  };
  const pool = { connect: async () => client };
  await assert.rejects(
    withAuthenticatedRls(pool, claims, async () => client.query("APPLICATION QUERY")),
    /test failure/
  );
  assert.ok(calls.includes("ROLLBACK"));
  assert.ok(!calls.includes("COMMIT"));
});

test("RLS helper refuses tokens without the authenticated database role", async () => {
  const pool = { connect: async () => { throw new Error("must not connect"); } };
  await assert.rejects(
    withAuthenticatedRls(pool, { ...claims, role: "service_role" }, async () => null),
    /verified authenticated identity/
  );
});
