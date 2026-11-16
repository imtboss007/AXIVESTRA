// Same-origin proxy for AXIVESTRA's dedicated D1 authentication Worker.
// This keeps Better Auth session cookies on axivestra.pages.dev rather than
// relying on third-party cookies from workers.dev.
export const onRequest = async (context: { request: Request; env: { AUTH_WORKER_URL?: string }; next: () => Promise<Response> }) => {
  const path = new URL(context.request.url).pathname;
  const managed = path.startsWith("/api/auth/") || path === "/api/auth" ||
    path.startsWith("/api/access/") || path.startsWith("/api/owner/");
  if (!managed) return context.next();
  const workerUrl = context.env.AUTH_WORKER_URL;
  if (!workerUrl) return new Response(JSON.stringify({ error: "AXIVESTRA authentication service is not configured." }), {
    status: 503, headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
  const incoming = new URL(context.request.url);
  const target = new URL(incoming.pathname + incoming.search, workerUrl);
  const forwarded = new Request(target.toString(), context.request);
  return fetch(forwarded);
};
