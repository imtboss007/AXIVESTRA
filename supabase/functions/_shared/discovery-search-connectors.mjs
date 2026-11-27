const MAX_QUERY_CHARS = 500;
const MAX_RESULTS = 10;
const MAX_TITLE = 300;
const MAX_SNIPPET = 800;

function cleanText(value, limit) {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit)
    : "";
}

function isPublicSearchHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") ||
      host.endsWith(".home") || host.includes(":")) return false;
  const blockedSocialDomains = ["linkedin.com", "facebook.com", "instagram.com", "twitter.com", "x.com", "tiktok.com"];
  if (blockedSocialDomains.some(domain => host === domain || host.endsWith("." + domain))) return false;
  // IP literals are intentionally excluded; source approval is based on HTTPS hostnames.
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false;
  return true;
}

function redactSnippet(value) {
  return cleanText(value, MAX_SNIPPET)
    .replace(/[A-Z0-9.!#$%&'*+/=?^_\x60{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email redacted]")
    .replace(/(?:\+?\d[\d .()\-]{7,}\d)/g, "[phone redacted]");
}

function normalizeUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.search || !isPublicSearchHost(url.hostname)) return null;
  url.hash = "";
  return url;
}

export function buildSearxngQueries(criteria, filters = {}) {
  if (!criteria || typeof criteria !== "object" || Array.isArray(criteria)) {
    throw new Error("A workspace-specific discovery profile is required.");
  }
  if (criteria.disabledByPolicy === true) {
    throw new Error("This workspace/mode is disabled by discovery policy.");
  }
  const targetClasses = Array.isArray(criteria.targetClasses)
    ? criteria.targetClasses.filter(value => typeof value === "string").slice(0, 16)
    : [];
  if (!targetClasses.length) throw new Error("The workspace profile has no configured discovery target classes.");

  const cleanFilters = {
    location: cleanText(filters.location, 120),
    sector: cleanText(filters.sector, 100),
    product: cleanText(filters.product, 100),
    stage: cleanText(filters.stage, 80),
    instrument: cleanText(filters.instrument, 80),
    searchTerms: cleanText(filters.searchTerms, 500)
  };
  const sensitiveInput = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const phoneInput = /(?:\+?\d[\d .()\-]{7,}\d)/;
  if (Object.values(cleanFilters).some(value => sensitiveInput.test(value) || phoneInput.test(value))) {
    throw new Error("Search filters must not contain personal email addresses or phone numbers.");
  }
  if (targetClasses.some(value => sensitiveInput.test(value) || phoneInput.test(value))) {
    throw new Error("Workspace search target classes must not contain personal contact details.");
  }
  const suffix = Object.values(cleanFilters).filter(Boolean).join(" ");
  const queries = [];
  for (const target of targetClasses.slice(0, 4)) {
    const term = cleanText(target.replaceAll("_", " "), 120);
    if (!term) continue;
    const suffixBudget = Math.max(0, MAX_QUERY_CHARS - term.length - (suffix ? 1 : 0));
    const boundedSuffix = suffix.slice(0, suffixBudget).trimEnd();
    const query = [term, boundedSuffix].filter(Boolean).join(" ");
    if (query && query.length <= MAX_QUERY_CHARS && !queries.includes(query)) queries.push(query);
  }
  if (!queries.length) throw new Error("The workspace did not produce a usable public search query.");
  return queries.slice(0, 4);
}

export function normalizeSearxngResults(results, limit = MAX_RESULTS, fetchedAt = new Date().toISOString()) {
  if (!Array.isArray(results)) return [];
  const boundedLimit = Number.isInteger(limit) ? Math.max(1, Math.min(MAX_RESULTS, limit)) : MAX_RESULTS;
  const seen = new Set();
  const normalized = [];
  for (const result of results) {
    if (!result || typeof result !== "object") continue;
    const url = normalizeUrl(result.url);
    if (!url || seen.has(url.toString())) continue;
    const title = cleanText(result.title, MAX_TITLE);
    if (!title) continue;
    seen.add(url.toString());
    normalized.push({
      title,
      url: url.toString(),
      domain: url.hostname.toLowerCase(),
      snippet: redactSnippet(result.content || result.snippet),
      engine: cleanText(result.engine, 80) || "metasearch",
      publishedAt: cleanText(result.publishedDate || result.published_at, 80) || null,
      fetchedAt,
      status: "unverified_candidate",
      verified: false,
      evidenceId: null
    });
    if (normalized.length >= boundedLimit) break;
  }
  return normalized;
}

export async function searchSearxng({
  baseUrl,
  query,
  limit = MAX_RESULTS,
  language = "en",
  safesearch = 2,
  bearerToken = "",
  fetcher = fetch
}) {
  if (typeof baseUrl !== "string" || !baseUrl.trim()) {
    throw new Error("A self-hosted SearXNG endpoint has not been configured.");
  }
  const endpoint = new URL(baseUrl);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password ||
      endpoint.search || endpoint.hash || !isPublicSearchHost(endpoint.hostname)) {
    throw new Error("SearXNG must use a configured HTTPS service endpoint without embedded credentials.");
  }
  const text = cleanText(query, MAX_QUERY_CHARS);
  if (!text) throw new Error("A public discovery query is required.");
  const params = new URLSearchParams({
    q: text,
    format: "json",
    language: cleanText(language, 12) || "en",
    safesearch: String([0, 1, 2].includes(safesearch) ? safesearch : 2),
    pageno: "1"
  });
  const url = new URL("/search", endpoint);
  url.search = params.toString();
  const headers = { Accept: "application/json" };
  if (bearerToken) headers.Authorization = "Bearer " + bearerToken;
  const response = await fetcher(url.toString(), {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(12_000),
    redirect: "error"
  });
  if (!response.ok) {
    throw new Error("The self-hosted search provider returned HTTP " + response.status + ".");
  }
  const payload = await response.json();
  if (!payload || !Array.isArray(payload.results)) {
    throw new Error("The search provider did not return JSON results. Enable the JSON output format in its own settings.");
  }
  return normalizeSearxngResults(payload.results, limit);
}
