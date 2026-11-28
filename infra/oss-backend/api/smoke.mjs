import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";

const env = process.env;
const keycloak = env.KEYCLOAK_INTERNAL_URL || "http://keycloak:8080";
const api = env.API_INTERNAL_URL || "http://api:3000";
const postgrest = env.POSTGREST_INTERNAL_URL || "http://postgrest:3000";
const issuer = env.OIDC_ISSUER || "http://localhost:8180/realms/axivestra";
const s3Endpoint = new URL(env.S3_ENDPOINT || "http://seaweedfs:8333");
const s3AccessKey = env.S3_ACCESS_KEY || "axivestra-local-s3-user";
const s3SecretKey = env.S3_SECRET_KEY || "axivestra-local-s3-secret-change-me";

const tenants = [
  {
    username: "lender.demo",
    password: "LenderDemoOnly!2026",
    expectedCompany: "AXIVESTRA Lender Demo Company",
    expectedRecord: "LENDER-DEMO-ONLY",
    foreignCompanyId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
  },
  {
    username: "customer.demo",
    password: "CustomerDemoOnly!2026",
    expectedCompany: "AXIVESTRA Customer Demo Company",
    expectedRecord: "CUSTOMER-DEMO-ONLY",
    foreignCompanyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  }
];

async function waitFor(url, label) {
  const deadline = Date.now() + 120_000;
  let last = "not reached";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(4_000) });
      if (response.ok) return;
      last = "HTTP " + response.status;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise(resolve => setTimeout(resolve, 2_000));
  }
  throw new Error(label + " did not become ready: " + last);
}

async function getToken(username, password) {
  const body = new URLSearchParams({
    grant_type: "password",
    client_id: "axivestra-test",
    username,
    password,
    scope: "openid profile email"
  });
  const response = await fetch(keycloak + "/realms/axivestra/protocol/openid-connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const data = await response.json();
  if (!response.ok || typeof data.access_token !== "string") {
    throw new Error("Keycloak demo login failed for " + username + ": " + JSON.stringify(data));
  }
  return data.access_token;
}

async function authorizedJson(url, token) {
  const response = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
function hmac(key, value) {
  return createHmac("sha256", key).update(value).digest();
}
function signS3(method, path, body = Buffer.alloc(0)) {
  const date = new Date();
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const host = s3Endpoint.host;
  const payloadHash = sha256(body);
  const canonicalHeaders =
    "host:" + host + "\n" +
    "x-amz-content-sha256:" + payloadHash + "\n" +
    "x-amz-date:" + amzDate + "\n";
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    method,
    path,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join("\n");
  const scope = dateStamp + "/us-east-1/s3/aws4_request";
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256(canonicalRequest)
  ].join("\n");
  const dateKey = hmac("AWS4" + s3SecretKey, dateStamp);
  const regionKey = hmac(dateKey, "us-east-1");
  const serviceKey = hmac(regionKey, "s3");
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  return {
    "Authorization": "AWS4-HMAC-SHA256 Credential=" + s3AccessKey + "/" + scope +
      ", SignedHeaders=" + signedHeaders + ", Signature=" + signature,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash
  };
}

async function s3Request(method, path, body) {
  const bytes = body === undefined ? Buffer.alloc(0) : Buffer.from(body);
  const response = await fetch(new URL(path, s3Endpoint), {
    method,
    headers: signS3(method, path, bytes),
    body: method === "GET" || method === "HEAD" ? undefined : bytes
  });
  return response;
}

async function assertStorageRoundTrip() {
  const bucket = "axivestra-oss-smoke";
  const objectPath = "/" + bucket + "/prototype-check.txt";
  const create = await s3Request("PUT", "/" + bucket);
  if (![200, 409].includes(create.status)) {
    throw new Error("SeaweedFS bucket creation failed: HTTP " + create.status + " " + await create.text());
  }
  const content = "AXIVESTRA local synthetic storage test only.";
  const put = await s3Request("PUT", objectPath, content);
  assert.equal(put.status, 200, "S3-compatible object upload must succeed");
  const get = await s3Request("GET", objectPath);
  assert.equal(get.status, 200, "S3-compatible object read must succeed");
  assert.equal(await get.text(), content);
  await s3Request("DELETE", objectPath);
  await s3Request("DELETE", "/" + bucket);
  process.stdout.write("PASS SeaweedFS S3-compatible put/get/delete round trip.\n");
}

await waitFor(api + "/healthz", "Hono API");
await waitFor(postgrest + "/", "PostgREST API");
await waitFor(keycloak + "/realms/axivestra/.well-known/openid-configuration", "Keycloak realm");

for (const tenant of tenants) {
  const token = await getToken(tenant.username, tenant.password);

  const session = await authorizedJson(api + "/v1/session", token);
  assert.equal(session.status, 200, "Hono session endpoint must accept the Keycloak token");
  assert.equal(session.data.databaseRole, "authenticated");

  const companyResponse = await authorizedJson(api + "/v1/companies", token);
  assert.equal(companyResponse.status, 200);
  assert.equal(companyResponse.data.companies.length, 1);
  assert.equal(companyResponse.data.companies[0].name, tenant.expectedCompany);

  const restCompanies = await authorizedJson(
    postgrest + "/companies?select=id,name",
    token
  );
  assert.equal(restCompanies.status, 200, "PostgREST must verify the Keycloak JWT");
  assert.equal(restCompanies.data.length, 1);
  assert.equal(restCompanies.data[0].name, tenant.expectedCompany);

  const restRecords = await authorizedJson(
    postgrest + "/oss_backend_probe_records?select=record_key",
    token
  );
  assert.equal(restRecords.status, 200);
  assert.equal(restRecords.data.length, 1);
  assert.equal(restRecords.data[0].record_key, tenant.expectedRecord);

  const foreignRead = await authorizedJson(
    postgrest + "/companies?select=id,name&id=eq." + tenant.foreignCompanyId,
    token
  );
  assert.equal(foreignRead.status, 200);
  assert.deepEqual(foreignRead.data, [], "RLS must hide the other company's row");

  process.stdout.write("PASS " + tenant.username + " can access only its own company through Hono and PostgREST.\n");
}

const unauthenticated = await fetch(api + "/v1/session");
assert.equal(unauthenticated.status, 401, "Hono API must reject missing bearer tokens");

await assertStorageRoundTrip();
process.stdout.write("PASS unauthenticated API access is rejected.\n");
process.stdout.write("AXIVESTRA open-source backend smoke suite passed.\n");
