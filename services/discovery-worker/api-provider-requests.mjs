const DATA_GOV_IN_HOST = "api.data.gov.in";
const DATA_GOV_IN_API_KEY_ENV = "DATA_GOV_IN_API_KEY";
const MAX_DATA_GOV_PAGE_SIZE = 10_000;
const MAX_DATA_GOV_OFFSET = 1_000_000;
const DATA_GOV_RESOURCE_ID = /^[A-Za-z0-9_-]{8,128}$/;
const SECRET_QUERY_KEYS = new Set(["api-key", "api_key", "apikey", "access_token", "token"]);

function readSingleParameter(url, name) {
  const values = url.searchParams.getAll(name);
  if (values.length > 1) throw new Error("Provider request contains a repeated " + name + " parameter.");
  return values[0] ?? null;
}

function readBoundedInteger(value, fallback, minimum, maximum, label) {
  if (value === null || value === "") return fallback;
  if (!/^\\d+$/.test(String(value))) throw new Error(label + " must be a whole number.");
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(label + " is outside the approved request bounds.");
  }
  return number;
}

/**
 * Adds credentials only to the exact, owner-approved data.gov.in resource API.
 * The source URL supplied by the company never contains the API key. The key
 * is read from the fetch-worker process environment and is never returned to
 * the browser or written to AXIVESTRA evidence/audit records.
 */
export function prepareProviderRequestUrl(urlValue, { source, env = process.env } = {}) {
  let url;
  try { url = new URL(urlValue); }
  catch { throw new Error("Provider request URL is invalid."); }

  if (url.protocol !== "https:" || url.username || url.password || url.hash ||
      (url.port && url.port !== "443")) {
    throw new Error("Provider requests require standard-port HTTPS without credentials or fragments.");
  }

  const hostname = url.hostname.toLowerCase();
  const suppliedSecretParameters = [...url.searchParams.keys()]
    .filter(key => SECRET_QUERY_KEYS.has(key.toLowerCase()));

  if (hostname !== DATA_GOV_IN_HOST) {
    if (suppliedSecretParameters.length) {
      throw new Error("Provider credentials must not be supplied in candidate URLs.");
    }
    return url.toString();
  }

  if (source?.status !== "approved" || source?.source_type !== "official_api" ||
      source?.connector_key !== "official_api" || String(source?.domain || "").toLowerCase() !== DATA_GOV_IN_HOST) {
    throw new Error("data.gov.in access requires an approved official_api source registered for the exact API host.");
  }

  const match = url.pathname.match(/^\\/resource\\/([^/]+)$/);
  if (!match || !DATA_GOV_RESOURCE_ID.test(match[1])) {
    throw new Error("data.gov.in requests must target one exact registered resource ID.");
  }

  if (suppliedSecretParameters.length) {
    throw new Error("Do not place a data.gov.in API key in a candidate URL; the worker injects it server-side.");
  }

  const allowedParameters = new Set(["format", "limit", "offset"]);
  for (const key of url.searchParams.keys()) {
    if (!allowedParameters.has(key.toLowerCase())) {
      throw new Error("data.gov.in request contains a query parameter outside the approved format/limit/offset set.");
    }
  }

  const format = readSingleParameter(url, "format");
  if (format && format.toLowerCase() !== "json") {
    throw new Error("The initial data.gov.in connector accepts JSON responses only.");
  }
  const limit = readBoundedInteger(
    readSingleParameter(url, "limit"), 1000, 1, MAX_DATA_GOV_PAGE_SIZE, "data.gov.in page limit"
  );
  const offset = readBoundedInteger(
    readSingleParameter(url, "offset"), 0, 0, MAX_DATA_GOV_OFFSET, "data.gov.in offset"
  );

  const apiKey = typeof env?.[DATA_GOV_IN_API_KEY_ENV] === "string"
    ? env[DATA_GOV_IN_API_KEY_ENV].trim()
    : "";
  if (!apiKey || apiKey.length > 512 || /\\s/.test(apiKey)) {
    throw new Error("The fetch worker is missing a valid server-side DATA_GOV_IN_API_KEY secret.");
  }

  url.search = "";
  url.searchParams.set("api-key", apiKey);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  return url.toString();
}

export const DATA_GOV_IN_REQUEST_POLICY = Object.freeze({
  hostname: DATA_GOV_IN_HOST,
  apiKeyEnvironmentVariable: DATA_GOV_IN_API_KEY_ENV,
  maxPageSize: MAX_DATA_GOV_PAGE_SIZE,
  maxOffset: MAX_DATA_GOV_OFFSET,
  allowedQueryParameters: Object.freeze(["format", "limit", "offset"]),
  credentialPlacement: "server-side-only-query-parameter",
  defaultFormat: "json",
  defaultLimit: 1000,
  defaultOffset: 0
});
