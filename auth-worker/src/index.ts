import { betterAuth } from "better-auth";

interface Env {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  OWNER_EMAIL: string;
  APP_ORIGIN: string;
  AUTH_BASE_URL: string;
}

type AuthSession = {
  user: { id: string; email: string; emailVerified?: boolean; name?: string };
  session: { id: string };
};

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
  });

function authFor(env: Env) {
  const socialProviders = env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, prompt: "select_account" as const } }
    : undefined;
  return betterAuth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.AUTH_BASE_URL,
    basePath: "/api/auth",
    trustedOrigins: [env.APP_ORIGIN, env.AUTH_BASE_URL],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      // Device and account approval are separate gates. Email verification delivery
      // must be configured before enabling mandatory verification.
      requireEmailVerification: false
    },
    ...(socialProviders ? { socialProviders } : {}),
    advanced: {
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      useSecureCookies: true
    },
    rateLimit: { enabled: true, window: 60, max: 10 }
  });
}

async function getSession(request: Request, auth: ReturnType<typeof authFor>) {
  return await auth.api.getSession({ headers: request.headers }) as AuthSession | null;
}

function deviceHeader(request: Request) {
  return (request.headers.get("x-axivestra-device") || "").trim();
}

async function hashDeviceId(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function isOwner(session: AuthSession | null, env: Env) {
  return Boolean(session?.user?.email && session.user.email.toLowerCase() === env.OWNER_EMAIL.toLowerCase() && session.user.emailVerified);
}

async function requireOwner(request: Request, auth: ReturnType<typeof authFor>, env: Env) {
  const session = await getSession(request, auth);
  return isOwner(session, env) ? session : null;
}

async function handleAccess(request: Request, env: Env, auth: ReturnType<typeof authFor>) {
  const url = new URL(request.url);
  const session = await getSession(request, auth);

  if (url.pathname === "/api/access/register-device" && request.method === "POST") {
    const body = await request.json().catch(() => null) as { deviceId?: string; label?: string; kind?: string } | null;
    const deviceId = body?.deviceId || deviceHeader(request);
    if (!deviceId || deviceId.length < 40 || deviceId.length > 200) return json({ error: "A valid device identifier is required." }, 400);
    const deviceHash = await hashDeviceId(deviceId);
    const existing = await env.DB.prepare("SELECT id, user_id, status FROM device_access WHERE device_hash = ?").bind(deviceHash).first<{id:string;user_id:string|null;status:string}>();
    if (existing && existing.user_id !== (session?.user.id || null)) {
      return json({ error: "This device is already registered to a different account. Contact the AXIVESTRA owner." }, 409);
    }
    if (existing) {
      await env.DB.prepare("UPDATE device_access SET last_seen_at = datetime('now') WHERE id = ?").bind(existing.id).run();
      return json({ status: existing.status, deviceRecordId: existing.id });
    }
    const id = crypto.randomUUID();
    const kind = ["browser", "desktop", "mobile", "guest"].includes(body?.kind || "") ? body!.kind! : "browser";
    await env.DB.prepare(
      "INSERT INTO device_access (id, device_hash, user_id, email, device_label, device_kind, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')"
    ).bind(id, deviceHash, session?.user.id || null, session?.user.email || null,
      (body?.label || "Unidentified device").slice(0, 100), kind).run();
    await env.DB.prepare(
      "INSERT INTO access_audit (id, actor_email, action, device_record_id, target_email) VALUES (?, ?, 'device_registered', ?, ?)"
    ).bind(crypto.randomUUID(), session?.user.email || "guest", id, session?.user.email || null).run();
    return json({ status: "pending", deviceRecordId: id });
  }

  if (url.pathname === "/api/access/status" && request.method === "GET") {
    const deviceId = deviceHeader(request);
    if (!deviceId) return json({ status: "unregistered" }, 200);
    const hash = await hashDeviceId(deviceId);
    const record = await env.DB.prepare(
      "SELECT status, user_id FROM device_access WHERE device_hash = ?"
    ).bind(hash).first<{status:string;user_id:string|null}>();
    if (!record) return json({ status: "unregistered" });
    if (record.user_id !== (session?.user.id || null)) return json({ status: "account_mismatch" }, 403);
    await env.DB.prepare("UPDATE device_access SET last_seen_at = datetime('now') WHERE device_hash = ?").bind(hash).run();
    return json({ status: record.status, authenticated: Boolean(session), user: session?.user ? { email: session.user.email, name: session.user.name } : null });
  }

  if (url.pathname === "/api/access/check" && request.method === "GET") {
    const deviceId = deviceHeader(request);
    if (!deviceId) return json({ allowed: false, reason: "device_not_registered" }, 403);
    const hash = await hashDeviceId(deviceId);
    const record = await env.DB.prepare("SELECT status, user_id FROM device_access WHERE device_hash = ?").bind(hash)
      .first<{status:string;user_id:string|null}>();
    if (!record || record.status !== "approved" || record.user_id !== (session?.user.id || null)) {
      return json({ allowed: false, reason: record?.status || "device_not_registered" }, 403);
    }
    return json({ allowed: true, user: session?.user ? { id: session.user.id, email: session.user.email } : null, guest: !session });
  }

  if (url.pathname === "/api/owner/devices" && request.method === "GET") {
    const owner = await requireOwner(request, auth, env);
    if (!owner) return json({ error: "Owner approval required." }, 403);
    const result = await env.DB.prepare(
      "SELECT d.id, d.email, d.device_label, d.device_kind, d.status, d.created_at, d.last_seen_at, d.approved_at, u.emailVerified AS email_verified FROM device_access d LEFT JOIN user u ON u.id = d.user_id ORDER BY CASE d.status WHEN 'pending' THEN 0 ELSE 1 END, d.created_at DESC LIMIT 500"
    ).all();
    return json({ devices: result.results || [] });
  }

  const decisionMatch = url.pathname.match(/^\/api\/owner\/devices\/([0-9a-f-]{36})\/(approve|reject|revoke)$/i);
  if (decisionMatch && request.method === "POST") {
    const owner = await requireOwner(request, auth, env);
    if (!owner) return json({ error: "Owner approval required." }, 403);
    const [, id, decision] = decisionMatch;
    const status = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "revoked";
    const current = await env.DB.prepare("SELECT id, email FROM device_access WHERE id = ?").bind(id).first<{id:string;email:string|null}>();
    if (!current) return json({ error: "Device record not found." }, 404);
    await env.DB.prepare(
      "UPDATE device_access SET status = ?, approved_at = CASE WHEN ? = 'approved' THEN datetime('now') ELSE NULL END, approved_by = ?, reviewed_at = datetime('now') WHERE id = ?"
    ).bind(status, status, owner.user.email, id).run();
    const action = status === "approved" ? "device_approved" : status === "rejected" ? "device_rejected" : "device_revoked";
    await env.DB.prepare(
      "INSERT INTO access_audit (id, actor_email, action, device_record_id, target_email) VALUES (?, ?, ?, ?, ?)"
    ).bind(crypto.randomUUID(), owner.user.email, action, id, current.email).run();
    return json({ success: true, id, status });
  }

  if (url.pathname === "/api/owner/audit" && request.method === "GET") {
    const owner = await requireOwner(request, auth, env);
    if (!owner) return json({ error: "Owner approval required." }, 403);
    const result = await env.DB.prepare("SELECT * FROM access_audit ORDER BY created_at DESC LIMIT 500").all();
    return json({ events: result.results || [] });
  }

  return null;
}

function withCors(response: Response, origin: string | null, env: Env) {
  const headers = new Headers(response.headers);
  if (origin && (origin === env.APP_ORIGIN || origin === env.AUTH_BASE_URL)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Axivestra-Device");
    headers.set("Vary", "Origin");
  }
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    if (origin && origin !== env.APP_ORIGIN && origin !== env.AUTH_BASE_URL) {
      return json({ error: "Origin not allowed." }, 403);
    }
    if (request.method === "OPTIONS") {
      if (!origin) return new Response(null, { status: 204 });
      return withCors(new Response(null, { status: 204 }), origin, env);
    }
    const auth = authFor(env);
    if (url.pathname.startsWith("/api/auth/")) {
      return withCors(await auth.handler(request), origin, env);
    }
    const response = await handleAccess(request, env, auth);
    if (response) return withCors(response, origin, env);
    if (url.pathname === "/health") return withCors(json({ ok: true, service: "axivestra-access", timestamp: new Date().toISOString() }), origin, env);
    return withCors(json({ error: "Not found." }, 404), origin, env);
  }
}
