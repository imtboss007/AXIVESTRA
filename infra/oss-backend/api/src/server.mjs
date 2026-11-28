import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createRemoteJWKSet } from "jose";
import pg from "pg";
import { pathToFileURL } from "node:url";
import { createRequireAuth } from "./auth.mjs";
import { withAuthenticatedRls } from "./db.mjs";

const { Pool } = pg;

export function createApp({ pool, requireAuth }) {
  const app = new Hono();

  app.get("/healthz", async context => {
    try {
      await pool.query("SELECT 1");
      return context.json({ ok: true, database: "connected" });
    } catch {
      return context.json({ ok: false, database: "unavailable" }, 503);
    }
  });

  app.use("/v1/*", requireAuth);

  app.get("/v1/session", context => {
    const identity = context.get("identity");
    return context.json({
      userId: identity.sub,
      email: typeof identity.email === "string" ? identity.email : null,
      issuer: identity.iss,
      audience: identity.aud,
      databaseRole: identity.role
    });
  });

  app.get("/v1/companies", async context => {
    try {
      const identity = context.get("identity");
      const companies = await withAuthenticatedRls(pool, identity, async client => {
        const result = await client.query(
          "SELECT c.id, c.name, m.role " +
          "FROM public.company_memberships AS m " +
          "JOIN public.companies AS c ON c.id = m.company_id " +
          "WHERE m.user_id = auth.uid() ORDER BY c.name"
        );
        return result.rows;
      });
      return context.json({ companies });
    } catch {
      return context.json({ error: "Could not load the authenticated company workspace." }, 500);
    }
  });

  app.notFound(context => context.json({ error: "Route not found." }, 404));
  app.onError((_error, context) => context.json({ error: "The AXIVESTRA API request failed." }, 500));
  return app;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const issuer = process.env.OIDC_ISSUER || "http://localhost:8180/realms/axivestra";
  const jwksUrl = process.env.OIDC_JWKS_URL || "http://keycloak:8080/realms/axivestra/protocol/openid-connect/certs";
  const audience = process.env.OIDC_AUDIENCE || "axivestra-api";
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || "postgres://axivestra_api:local-api-password-change-me@db:5432/axivestra",
    max: Number(process.env.DB_POOL_MAX || 10),
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000
  });
  const jwks = createRemoteJWKSet(new URL(jwksUrl));
  const requireAuth = createRequireAuth({ jwks, issuer, audience });
  const app = createApp({ pool, requireAuth });
  const port = Number(process.env.PORT || 3000);

  serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
  process.stdout.write("AXIVESTRA open-source prototype API listening on " + port + ".\n");

  const shutdown = async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
