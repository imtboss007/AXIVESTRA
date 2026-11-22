import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSourceRegistration,
  normalizeSourceReview,
  normalizeProfile,
  assertSourceCanBeAttached,
  assertAllowedSourceUrl
} from "../../../supabase/functions/_shared/discovery-policy.mjs";
import { ConnectorRegistry } from "../../../supabase/functions/_shared/discovery-connector-registry.mjs";
import {
  createExecutionSession,
  buildEvidenceProvenance
} from "../../../supabase/functions/_shared/discovery-execution-policy.mjs";

const baseSource = {
  name: "Example company registry",
  canonicalUrl: "https://registry.example.gov.in/api",
  sourceType: "official_api",
  jurisdiction: "IN",
  termsUrl: "https://registry.example.gov.in/terms",
  licenseRef: "Official API terms, reviewed by owner",
  allowedPaths: ["/api/v1/entities"],
  allowedPurposes: ["company identity verification"],
  allowedFields: ["legal_name", "registration_id", "status"],
  attribution: "Source: official company registry",
  legalBasis: "Official public company identity data for business verification."
};

function approvedSource() {
  const pending = normalizeSourceRegistration(baseSource);
  return {
    id: "source-test-1",
    ...pending,
    ...normalizeSourceReview({ status: "approved", legalBasis: baseSource.legalBasis }, {
      ...pending,
      terms_url: baseSource.termsUrl,
      license_ref: baseSource.licenseRef,
      attribution: baseSource.attribution
    }, "reviewer-user-id")
  };
}

function session(source, options = {}) {
  return createExecutionSession(source, {
    jobId: "job-test-1",
    wait: async () => {},
    ...options
  });
}

const purpose = "company identity verification";
const endpoint = "https://registry.example.gov.in/api/v1/entities";

test("source registration normalises exact HTTPS host and always begins pending", () => {
  const source = normalizeSourceRegistration(baseSource);
  assert.equal(source.domain, "registry.example.gov.in");
  assert.equal(source.status, "pending");
  assert.deepEqual(source.allowed_paths, ["/api/v1/entities"]);
});

test("source registration rejects non-HTTPS, wildcard and query-bearing canonical URLs", () => {
  assert.throws(() => normalizeSourceRegistration({ ...baseSource, canonicalUrl: "http://example.gov.in" }), /HTTPS/);
  assert.throws(() => normalizeSourceRegistration({ ...baseSource, canonicalUrl: "https://*.example.gov.in" }), /exact hostname/);
  assert.throws(() => normalizeSourceRegistration({ ...baseSource, canonicalUrl: "https://registry.example.gov.in/api?all=1" }), /query parameters/);
});

test("source registration rejects wildcard and traversal path policies", () => {
  assert.throws(() => normalizeSourceRegistration({ ...baseSource, allowedPaths: ["/api/*"] }), /wildcards/);
  assert.throws(() => normalizeSourceRegistration({ ...baseSource, allowedPaths: ["/api/%2e%2e/private"] }), /traversal/);
});

test("browser rendering is opt-in and only allowed for permitted public websites", () => {
  const pending = normalizeSourceRegistration({ ...baseSource, sourceType: "official_api", renderMode: "browser" });
  assert.equal(pending.render_mode, "http");
  assert.throws(() => normalizeSourceRegistration({ ...baseSource, renderMode: "browser" }), /only for an explicitly permitted public website/);
  const publicPage = normalizeSourceRegistration({
    ...baseSource,
    sourceType: "permitted_public_page",
    canonicalUrl: "https://registry.example.gov.in/public",
    renderMode: "browser"
  });
  assert.equal(publicPage.render_mode, "browser");
});

test("source approval requires a reviewed licence reference and legal basis", () => {
  const pending = normalizeSourceRegistration(baseSource);
  assert.throws(() => normalizeSourceReview({ status: "approved", licenseRef: "unreviewed", legalBasis: "x" }, pending, "reviewer"), /verified licence/);
  assert.throws(() => normalizeSourceReview({ status: "approved", licenseRef: baseSource.licenseRef }, pending, "reviewer"), /Legal basis/);
});

test("only approved source policies can be returned by approval decision", () => {
  const source = approvedSource();
  assert.equal(source.status, "approved");
  assert.equal(source.reviewed_by, "reviewer-user-id");
  assert.ok(source.reviewed_at);
});

test("all sixteen workspace keys are accepted and invalid workspace keys are rejected", () => {
  assert.equal(normalizeProfile({ workspaceKey: "property_sale", discoveryMode: "CUSTOMER", purpose: "Find buyers", enabled: false }).workspace_key, "property_sale");
  assert.throws(() => normalizeProfile({ workspaceKey: "not_a_workspace", discoveryMode: "CUSTOMER", purpose: "Find customers" }), /16 supported workspaces/);
});

test("profile is disabled unless explicitly enabled and has an approved source attached", () => {
  assert.equal(normalizeProfile({ workspaceKey: "startup", discoveryMode: "LENDER", purpose: "Find venture debt providers" }).enabled, false);
  assert.throws(() => normalizeProfile({ workspaceKey: "startup", discoveryMode: "LENDER", purpose: "Find venture debt providers", enabled: true }, 0), /Attach at least one approved source/);
  assert.equal(normalizeProfile({ workspaceKey: "startup", discoveryMode: "LENDER", purpose: "Find venture debt providers", enabled: true }, 1).enabled, true);
});

test("personal-loan customer discovery cannot be enabled or attached to internet sources", () => {
  assert.throws(() => normalizeProfile({ workspaceKey: "personal_loan", discoveryMode: "CUSTOMER", purpose: "Find borrowers", enabled: true }, 2), /cannot scrape or harvest individuals/);
  assert.throws(() => assertSourceCanBeAttached({ workspace_key: "personal_loan", discovery_mode: "CUSTOMER" }, approvedSource()), /cannot use external person-discovery/);
});

test("source path policy enforces exact host and path boundaries", () => {
  const source = approvedSource();
  assert.equal(assertAllowedSourceUrl(source, endpoint + "/123").hostname, "registry.example.gov.in");
  assert.throws(() => assertAllowedSourceUrl(source, "https://sub.registry.example.gov.in/api/v1/entities"), /exact approved source origin/);
  assert.throws(() => assertAllowedSourceUrl(source, "https://registry.example.gov.in:9443/api/v1/entities"), /exact approved source origin/);
  assert.throws(() => assertAllowedSourceUrl(source, "https://registry.example.gov.in/private"), /approved source path list/);
  assert.throws(() => assertAllowedSourceUrl(source, "http://registry.example.gov.in/api/v1/entities"), /HTTPS/);
});

test("connector registry refuses unapproved sources and missing adapters", async () => {
  const registry = new ConnectorRegistry();
  const pending = { ...approvedSource(), status: "pending" };
  await assert.rejects(() => registry.search(pending, { text: "company", limit: 5 }, {
    purpose, executionSession: session(approvedSource())
  }), /Only an approved source/);
  await assert.rejects(() => registry.search(approvedSource(), { text: "company", limit: 5 }, {
    purpose, executionSession: session(approvedSource())
  }), /No implementation is installed/);
});

test("connector registry rejects unbounded search limits", async () => {
  const registry = new ConnectorRegistry();
  const source = approvedSource();
  registry.register({
    key: "official_api",
    async search() { return []; },
    async fetchEvidence() { return {}; }
  });
  await assert.rejects(() => registry.search(source, { text: "company", limit: 51, endpointUrl: endpoint }, {
    purpose, executionSession: session(source)
  }), /outside the approved job bounds/);
});

test("connector evidence fetch validates host and path before adapter execution", async () => {
  const registry = new ConnectorRegistry();
  let called = false;
  registry.register({
    key: "official_api",
    async search() { return []; },
    async fetchEvidence({ candidate, context }) {
      called = true;
      assert.ok(context.signal instanceof AbortSignal);
      assert.equal(context.jobId, "job-test-1");
      return candidate.url;
    }
  });
  const source = approvedSource();
  const jobSession = session(source);
  await assert.rejects(() => registry.fetchEvidence(source, { url: "https://elsewhere.example.org/api/v1/entities" }, {
    purpose, executionSession: jobSession
  }), /exact approved source origin/);
  assert.equal(called, false);
  assert.equal(await registry.fetchEvidence(source, { url: endpoint + "/42" }, {
    purpose, executionSession: jobSession
  }), endpoint + "/42");
  assert.equal(called, true);
});

test("manual research connector accepts explicit user-supplied evidence only", async () => {
  const registry = new ConnectorRegistry();
  let received = false;
  registry.register({
    key: "manual_research",
    async recordManual({ evidence }) { received = true; return evidence; }
  });
  const source = {
    ...approvedSource(),
    connector_key: "manual_research",
    source_type: "manual_research"
  };
  const evidence = { sourceUrl: "https://registry.example.gov.in/public-record", note: "User reviewed source" };
  assert.deepEqual(await registry.recordManual(source, evidence, { purpose }), evidence);
  assert.equal(received, true);
  await assert.rejects(() => registry.recordManual(source, "not-an-object", { purpose }), /must be an object/);
});

test("source attachment enforces exact approved purpose and field allow-lists", () => {
  const profile = {
    workspace_key: "startup",
    discovery_mode: "LENDER",
    purpose,
    criteria: { requiredFields: ["legal_name", "registration_id"] }
  };
  assert.equal(assertSourceCanBeAttached(profile, approvedSource()), true);
  assert.throws(() => assertSourceCanBeAttached({ ...profile, purpose: "lead generation" }, approvedSource()), /exact purpose/);
  assert.throws(() => assertSourceCanBeAttached({ ...profile, criteria: { requiredFields: ["private_credit_score"] } }, approvedSource()), /field allow-list/);
});

test("connector search endpoint is checked against exact approved host and paths", async () => {
  const registry = new ConnectorRegistry();
  let seenEndpoint = "";
  registry.register({
    key: "official_api",
    async search({ endpointUrl }) { seenEndpoint = endpointUrl; return []; },
    async fetchEvidence() { return {}; }
  });
  const source = approvedSource();
  const jobSession = session(source);
  await assert.rejects(() => registry.search(source, {
    text: "company", limit: 10, endpointUrl: "https://registry.example.gov.in/private"
  }, { purpose, executionSession: jobSession }), /approved source path list/);
  await registry.search(source, {
    text: "company", limit: 10, endpointUrl: endpoint + "/search"
  }, { purpose, executionSession: jobSession });
  assert.equal(seenEndpoint, endpoint + "/search");
});

test("a paused or rejected source is not eligible for source use", async () => {
  const approved = approvedSource();
  const paused = { ...approved, ...normalizeSourceReview({ status: "paused", reason: "policy review" }, approved, "reviewer") };
  const rejected = { ...approved, ...normalizeSourceReview({ status: "rejected", reason: "terms do not permit reuse" }, approved, "reviewer") };
  const registry = new ConnectorRegistry();
  registry.register({
    key: "official_api",
    async search() { return []; },
    async fetchEvidence() { return {}; }
  });
  await assert.rejects(() => registry.search(paused, { text: "company", limit: 5 }, {
    purpose, executionSession: session(approved)
  }), /Only an approved source/);
  await assert.rejects(() => registry.search(rejected, { text: "company", limit: 5 }, {
    purpose, executionSession: session(approved)
  }), /Only an approved source/);
});

test("a job cannot fetch more evidence pages than the source page budget", async () => {
  const registry = new ConnectorRegistry();
  let calls = 0;
  registry.register({
    key: "official_api",
    async search() { return []; },
    async fetchEvidence() { calls += 1; return { ok: true }; }
  });
  const source = { ...approvedSource(), max_pages_per_job: 1 };
  const jobSession = session(source);
  await registry.fetchEvidence(source, { url: endpoint + "/1" }, { purpose, executionSession: jobSession });
  await assert.rejects(() => registry.fetchEvidence(source, { url: endpoint + "/2" }, {
    purpose, executionSession: jobSession
  }), /maximum pages per job/);
  assert.equal(calls, 1);
  assert.equal(jobSession.snapshot().pageCount, 1);
});

test("each connector call is spaced at the source's declared per-minute rate", async () => {
  const source = approvedSource();
  let clock = 1000;
  const delays = [];
  const jobSession = createExecutionSession(source, {
    jobId: "rate-test",
    now: () => clock,
    wait: async milliseconds => { delays.push(milliseconds); clock += milliseconds; }
  });
  await jobSession.run("search", async () => "one");
  await jobSession.run("search", async () => "two");
  assert.ok(delays.some(delay => delay >= 1000));
});

test("connector timeout aborts the adapter signal and rejects the operation", async () => {
  const source = approvedSource();
  const jobSession = createExecutionSession(source, { jobId: "timeout-test", timeoutMs: 5, wait: async () => {} });
  await assert.rejects(() => jobSession.run("search", ({ signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("adapter aborted")), { once: true });
  })), /adapter aborted|configured timeout/);
});

test("only explicitly retryable transient errors use the configured retry budget", async () => {
  const source = approvedSource();
  const jobSession = createExecutionSession(source, { jobId: "retry-test", maxRetries: 1, wait: async () => {} });
  let calls = 0;
  const result = await jobSession.run("search", async () => {
    calls += 1;
    if (calls === 1) {
      const error = new Error("temporary network failure");
      error.retryable = true;
      throw error;
    }
    return "recovered";
  });
  assert.equal(result, "recovered");
  assert.equal(calls, 2);
  assert.equal(jobSession.snapshot().requestCount, 2);
});

test("evidence provenance records the reviewed source and rejects fields outside its allow-list", () => {
  const source = approvedSource();
  const provenance = buildEvidenceProvenance(source, {
    jobId: "job-provenance",
    purpose,
    url: endpoint + "/42",
    fields: ["legal_name", "registration_id"],
    retrievedAt: "2026-11-22T10:00:00.000Z"
  });
  assert.equal(provenance.source_id, source.id);
  assert.equal(provenance.purpose, purpose);
  assert.deepEqual(provenance.observed_fields, ["legal_name", "registration_id"]);
  assert.equal(provenance.license_ref, baseSource.licenseRef);
  assert.throws(() => buildEvidenceProvenance(source, {
    jobId: "job-provenance", purpose, url: endpoint + "/42", fields: ["personal_mobile"]
  }), /field allow-list/);
  assert.throws(() => buildEvidenceProvenance(source, {
    jobId: "job-provenance", purpose: "unapproved purpose", url: endpoint + "/42"
  }), /purpose allow-list/);
});

test("connector search refuses adapter results above the requested result limit", async () => {
  const registry = new ConnectorRegistry();
  registry.register({
    key: "official_api",
    async search() { return Array.from({ length: 3 }, (_, index) => index); },
    async fetchEvidence() { return {}; }
  });
  const source = approvedSource();
  await assert.rejects(() => registry.search(source, { text: "company", limit: 2, endpointUrl: endpoint }, {
    purpose, executionSession: session(source)
  }), /more results than the approved search limit/);
});
