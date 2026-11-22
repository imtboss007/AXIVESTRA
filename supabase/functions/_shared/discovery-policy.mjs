/**
 * AXIVESTRA discovery policy primitives.
 * Pure functions only: no network access, credentials, database writes or crawling.
 */

export const SOURCE_TYPES = Object.freeze([
  "official_api",
  "licensed_api",
  "open_dataset",
  "permitted_public_page",
  "manual_research"
]);

export const SOURCE_STATUSES = Object.freeze(["pending", "approved", "paused", "rejected"]);
export const DISCOVERY_MODES = Object.freeze(["LENDER", "CUSTOMER"]);

export const WORKSPACES = Object.freeze([
  "property_sale",
  "property_loans",
  "jv_jda_jd",
  "sr_rate_settlement",
  "agricultural_land",
  "commercial_land",
  "startup",
  "equity",
  "unsecured_company_loan",
  "personal_loan",
  "housing_loan",
  "house_purchase",
  "litigation",
  "fund_portfolio_management",
  "investor_relations",
  "compliance_kyc"
]);

const UNKNOWN_LICENCE_VALUES = new Set(["", "unknown", "unreviewed", "not checked", "pending review"]);

function requiredText(value, label, maxLength = 500) {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result || result.length > maxLength) {
    throw new Error(label + " is required and must be no longer than " + maxLength + " characters.");
  }
  return result;
}

function httpsUrl(value, label, { allowPath = true } = {}) {
  let url;
  try {
    url = new URL(requiredText(value, label, 2048));
  } catch (error) {
    if (error instanceof TypeError) throw new Error(label + " must be a valid HTTPS URL.");
    throw error;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || (url.port && url.port !== "443")) {
    throw new Error(label + " must use standard-port HTTPS and cannot contain credentials or a fragment.");
  }
  if (url.hostname === "localhost" || url.hostname.endsWith(".local") || url.hostname.includes("*")) {
    throw new Error(label + " must identify a public, exact hostname.");
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname) || url.hostname.includes(":")) {
    throw new Error(label + " must use a registered hostname, not an IP address.");
  }
  if (!allowPath && url.pathname !== "/") {
    throw new Error(label + " must be an origin URL.");
  }
  return url;
}

function stringList(value, label, { min = 1, max = 40, itemMax = 128 } = {}) {
  if (!Array.isArray(value)) throw new Error(label + " must be a list.");
  const list = [...new Set(value.map(item => requiredText(item, label + " item", itemMax)))];
  if (list.length < min || list.length > max) {
    throw new Error(label + " must contain between " + min + " and " + max + " unique entries.");
  }
  return list;
}

function pathList(value) {
  const paths = stringList(value, "Allowed paths", { min: 1, max: 30, itemMax: 300 });
  return paths.map(path => {
    let decoded;
    try { decoded = decodeURIComponent(path); } catch { throw new Error("Allowed paths must use valid URL encoding."); }
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("*") || decoded.split("/").includes("..") || /[\\\s]/.test(path)) {
      throw new Error("Each allowed path must be an exact path prefix beginning with / and cannot contain wildcards, spaces or traversal.");
    }
    return path.replace(/\/+$/, "") || "/";
  });
}

export function normalizeSourceRegistration(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("A source registration object is required.");
  const sourceType = requiredText(input.sourceType, "Source type", 48);
  if (!SOURCE_TYPES.includes(sourceType)) throw new Error("Choose a supported source type.");
  const canonical = httpsUrl(input.canonicalUrl, "Canonical URL");
  if (canonical.search) throw new Error("Canonical URL cannot contain query parameters.");
  const termsUrl = input.termsUrl ? httpsUrl(input.termsUrl, "Terms URL").toString() : null;
  if (sourceType !== "manual_research" && !termsUrl) {
    // Pending records may be registered before terms review, but they remain non-fetchable.
    // A reviewer must add a terms URL before approval.
  }
  const accessMethod = sourceType;
  const jurisdiction = requiredText(input.jurisdiction || "GLOBAL", "Jurisdiction", 80).toUpperCase();
  const rateLimitPerMinute = Number(input.rateLimitPerMinute ?? 6);
  const maxPagesPerJob = Number(input.maxPagesPerJob ?? 20);
  const retentionDays = Number(input.retentionDays ?? 90);
  if (!Number.isInteger(rateLimitPerMinute) || rateLimitPerMinute < 1 || rateLimitPerMinute > 60) throw new Error("Rate limit must be an integer from 1 to 60 requests per minute.");
  if (!Number.isInteger(maxPagesPerJob) || maxPagesPerJob < 1 || maxPagesPerJob > 100) throw new Error("Maximum pages per job must be an integer from 1 to 100.");
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) throw new Error("Retention must be an integer from 1 to 3650 days.");
  const allowedPaths = pathList(input.allowedPaths);
  const allowedPurposes = stringList(input.allowedPurposes, "Allowed purposes");
  const allowedFields = stringList(input.allowedFields, "Allowed fields");
  return {
    name: requiredText(input.name, "Source name", 160),
    canonical_url: canonical.toString().replace(/\/$/, ""),
    domain: canonical.hostname.toLowerCase(),
    source_type: sourceType,
    connector_key: sourceType,
    jurisdiction,
    terms_url: termsUrl,
    license_ref: requiredText(input.licenseRef || "unreviewed", "Licence reference", 500),
    allowed_purposes: allowedPurposes,
    allowed_fields: allowedFields,
    allowed_paths: allowedPaths,
    access_method: accessMethod,
    rate_limit_per_minute: rateLimitPerMinute,
    max_pages_per_job: maxPagesPerJob,
    retention_days: retentionDays,
    attribution: typeof input.attribution === "string" ? input.attribution.trim().slice(0, 500) : "",
    legal_basis: "",
    policy_notes: typeof input.policyNotes === "string" ? input.policyNotes.trim().slice(0, 2000) : "",
    status: "pending"
  };
}

export function normalizeSourceReview(input, existing, reviewerId) {
  if (!input || typeof input !== "object" || !existing) throw new Error("A source and review decision are required.");
  const status = requiredText(input.status, "Review status", 20);
  if (!["approved", "paused", "rejected"].includes(status)) throw new Error("Review status must be approved, paused or rejected.");
  const update = { status, reviewed_by: reviewerId, reviewed_at: new Date().toISOString() };
  if (status !== "approved") {
    update.policy_notes = (typeof input.reason === "string" ? input.reason.trim() : "").slice(0, 2000);
    return update;
  }

  const termsUrlValue = input.termsUrl || existing.terms_url;
  const licenseRefValue = input.licenseRef || existing.license_ref;
  const termsUrl = existing.source_type === "manual_research" && !termsUrlValue
    ? null
    : httpsUrl(termsUrlValue, "Terms URL").toString();
  const licenseRef = requiredText(licenseRefValue, "Licence reference", 500);
  if (UNKNOWN_LICENCE_VALUES.has(licenseRef.toLowerCase())) throw new Error("A verified licence or terms reference is required before approval.");
  const allowedPaths = pathList(input.allowedPaths ?? existing.allowed_paths);
  const allowedPurposes = stringList(input.allowedPurposes ?? existing.allowed_purposes, "Allowed purposes");
  const allowedFields = stringList(input.allowedFields ?? existing.allowed_fields, "Allowed fields");
  const legalBasis = requiredText(input.legalBasis, "Legal basis / permitted-use rationale", 1000);
  const attribution = requiredText(input.attribution || existing.attribution, "Attribution instruction", 500);
  const rateLimitPerMinute = Number(input.rateLimitPerMinute ?? existing.rate_limit_per_minute);
  const maxPagesPerJob = Number(input.maxPagesPerJob ?? existing.max_pages_per_job);
  const retentionDays = Number(input.retentionDays ?? existing.retention_days);
  if (!Number.isInteger(rateLimitPerMinute) || rateLimitPerMinute < 1 || rateLimitPerMinute > 60) throw new Error("Rate limit must be an integer from 1 to 60.");
  if (!Number.isInteger(maxPagesPerJob) || maxPagesPerJob < 1 || maxPagesPerJob > 100) throw new Error("Maximum pages per job must be an integer from 1 to 100.");
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) throw new Error("Retention must be an integer from 1 to 3650 days.");
  update.terms_url = termsUrl;
  update.license_ref = licenseRef;
  update.allowed_paths = allowedPaths;
  update.allowed_purposes = allowedPurposes;
  update.allowed_fields = allowedFields;
  update.legal_basis = legalBasis;
  update.attribution = attribution;
  update.rate_limit_per_minute = rateLimitPerMinute;
  update.max_pages_per_job = maxPagesPerJob;
  update.retention_days = retentionDays;
  return update;
}

export function normalizeProfile(input, sourceCount = 0) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("A discovery profile object is required.");
  const workspaceKey = requiredText(input.workspaceKey, "Workspace", 80);
  if (!WORKSPACES.includes(workspaceKey)) throw new Error("Choose one of AXIVESTRA's 16 supported workspaces.");
  const discoveryMode = requiredText(input.discoveryMode, "Discovery mode", 16).toUpperCase();
  if (!DISCOVERY_MODES.includes(discoveryMode)) throw new Error("Discovery mode must be LENDER or CUSTOMER.");
  const enabled = input.enabled === true;
  if (workspaceKey === "personal_loan" && discoveryMode === "CUSTOMER" && enabled) {
    throw new Error("Personal Loan customer discovery cannot scrape or harvest individuals. Use user-entered, referred, inbound or explicitly consented intake instead.");
  }
  if (enabled && sourceCount < 1) throw new Error("Attach at least one approved source before enabling this profile.");
  const criteria = input.criteria && typeof input.criteria === "object" && !Array.isArray(input.criteria) ? input.criteria : {};
  if (JSON.stringify(criteria).length > 12000) throw new Error("Profile criteria are too large.");
  return {
    workspace_key: workspaceKey,
    discovery_mode: discoveryMode,
    jurisdiction: requiredText(input.jurisdiction || "IN", "Jurisdiction", 80).toUpperCase(),
    purpose: requiredText(input.purpose, "Purpose", 500),
    enabled,
    criteria
  };
}

export function assertSourceCanBeAttached(profile, source) {
  if (!profile || !source) throw new Error("The profile and source are required.");
  if (source.status !== "approved") throw new Error("Only approved sources can be attached to a discovery profile.");
  if (profile.workspace_key === "personal_loan" && profile.discovery_mode === "CUSTOMER") {
    throw new Error("Personal Loan customer profiles cannot use external person-discovery sources.");
  }
  const allowedPurposes = Array.isArray(source.allowed_purposes) ? source.allowed_purposes : [];
  if (!allowedPurposes.includes(profile.purpose)) {
    throw new Error("The source's approved purposes do not include this workspace profile's exact purpose.");
  }
  const requestedFields = Array.isArray(profile.criteria?.requiredFields) ? profile.criteria.requiredFields : [];
  const allowedFields = new Set((Array.isArray(source.allowed_fields) ? source.allowed_fields : []).map(field => String(field).toLowerCase()));
  if (requestedFields.some(field => !allowedFields.has(String(field).toLowerCase()))) {
    throw new Error("The profile requests fields that are not in the source's approved field allow-list.");
  }
  return true;
}

export function assertAllowedSourceUrl(source, targetUrl) {
  if (!source || source.status !== "approved") throw new Error("Source is not approved for use.");
  const target = httpsUrl(targetUrl, "Target URL");
  const approvedCanonical = httpsUrl(source.canonical_url, "Registered canonical URL");
  if (target.origin !== approvedCanonical.origin ||
      target.hostname.toLowerCase() !== String(source.domain || "").toLowerCase()) {
    throw new Error("Target origin is outside the exact approved source origin.");
  }
  const paths = pathList(source.allowed_paths || []);
  const pathAllowed = paths.some(prefix =>
    prefix === "/" || target.pathname === prefix || target.pathname.startsWith(prefix + "/")
  );
  if (!pathAllowed) throw new Error("Target path is outside the approved source path list.");
  return target;
}
