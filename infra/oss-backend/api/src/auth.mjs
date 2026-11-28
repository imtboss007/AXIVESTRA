import { jwtVerify } from "jose";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createRequireAuth({ jwks, issuer, audience, verifyToken = jwtVerify }) {
  if (!jwks || !issuer || !audience) throw new Error("OIDC verification configuration is required.");

  return async (context, next) => {
    const authorization = context.req.header("Authorization") || "";
    const match = authorization.match(/^Bearer\s+(\S+)$/i);
    if (!match) return context.json({ error: "A valid bearer access token is required." }, 401);

    try {
      const { payload } = await verifyToken(match[1], jwks, {
        issuer,
        audience,
        algorithms: ["RS256"]
      });
      if (typeof payload.sub !== "string" || !UUID_PATTERN.test(payload.sub)) {
        return context.json({ error: "The access token subject is not a valid AXIVESTRA user ID." }, 401);
      }
      if (payload.role !== "authenticated") {
        return context.json({ error: "The access token does not contain the AXIVESTRA database role." }, 403);
      }
      context.set("identity", payload);
      await next();
    } catch (error) {
      const reason = error && typeof error === "object" && "code" in error
        ? String(error.code)
        : error instanceof Error ? error.name : "verification_failed";
      console.error("OIDC token verification rejected a request: " + reason);
      return context.json({ error: "The access token is invalid, expired or intended for another service." }, 401);
    }
  };
}
