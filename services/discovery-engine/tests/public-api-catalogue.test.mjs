import test from "node:test";
import assert from "node:assert/strict";
import {
  PUBLIC_API_CATALOGUE_SOURCE,
  PUBLIC_API_CANDIDATES,
  findPublicApiCandidates
} from "../../../src/lib/public-api-catalog.mjs";

test("public-apis upstream is recorded with MIT source-code attribution and a pinned README snapshot", () => {
  assert.equal(PUBLIC_API_CATALOGUE_SOURCE.repositoryUrl, "https://github.com/public-apis/public-apis");
  assert.equal(PUBLIC_API_CATALOGUE_SOURCE.license, "MIT");
  assert.match(PUBLIC_API_CATALOGUE_SOURCE.upstreamReadmeBlobSha, /^[a-f0-9]{40}$/);
  assert.equal(PUBLIC_API_CATALOGUE_SOURCE.snapshotDate, "2026-11-25");
  assert.match(PUBLIC_API_CATALOGUE_SOURCE.useBoundary, /No API is enabled/);
});

test("the India API candidate catalogue is non-empty, HTTPS-only and has independent review status", () => {
  assert.ok(PUBLIC_API_CANDIDATES.length >= 8);
  assert.equal(new Set(PUBLIC_API_CANDIDATES.map(item => item.id)).size, PUBLIC_API_CANDIDATES.length);
  for (const item of PUBLIC_API_CANDIDATES) {
    assert.match(item.providerUrl, /^https:\/\//, item.id);
    assert.match(item.docsUrl, /^https:\/\//, item.id);
    assert.ok(item.modeFit.length, item.id);
    assert.ok(item.workspaceFit.length, item.id);
    assert.ok(item.guardrails.length, item.id);
    assert.equal(item.reviewState === "approved", false, item.id + " must not be auto-approved");
  }
});

test("MCA Company Master Data is an official entity-research candidate, not a lender licence authority", () => {
  const item = PUBLIC_API_CANDIDATES.find(candidate => candidate.id === "mca-company-master");
  assert.equal(item.sourceType, "official_government_dataset_api");
  assert.ok(item.workspaceFit.includes("property_loans"));
  assert.ok(item.workspaceFit.includes("unsecured_company_loan"));
  assert.ok(item.guardrails.some(line => /do not establish current lender authorisation/i.test(line)));
  assert.ok(item.guardrails.some(line => /do not guess or hardcode a resource ID/i.test(line)));
  assert.equal(item.reviewState, "catalogue_only");
});

test("API Setu is described as a controlled gateway despite the directory's Auth=No metadata", () => {
  const item = PUBLIC_API_CANDIDATES.find(candidate => candidate.id === "api-setu");
  assert.equal(item.authAsListed, "No");
  assert.ok(item.guardrails.some(line => /onboarding|subscription|publisher approval|credentials/i.test(line)));
  assert.equal(item.reviewState, "approval_required");
});

test("the data.gov.in catalogue is not mistaken for one universal, ready-to-fetch dataset", () => {
  const item = PUBLIC_API_CANDIDATES.find(candidate => candidate.id === "ogd-india");
  assert.ok(item.guardrails.some(line => /every resource/i.test(line)));
  assert.ok(item.guardrails.some(line => /API key/i.test(line)));
  assert.equal(item.reviewState, "catalogue_only");
});

test("eCourts and GST verification wrappers are separated from official government registers", () => {
  const courts = PUBLIC_API_CANDIDATES.find(candidate => candidate.id === "ecourts-india");
  const gst = PUBLIC_API_CANDIDATES.find(candidate => candidate.id === "gstinapi");
  assert.match(courts.sourceType, /third_party/);
  assert.equal(courts.workspaceFit.join(","), "litigation");
  assert.ok(courts.guardrails.some(line => /cold-marketing/i.test(line)));
  assert.match(gst.sourceType, /third_party/);
  assert.ok(gst.guardrails.some(line => /Private provider/i.test(line)));
});

test("workspace filtering returns only relevant candidate APIs and does not mix mode intent", () => {
  assert.deepEqual(
    findPublicApiCandidates({ workspaceKey: "agricultural_land", mode: "CUSTOMER" }).map(x => x.id),
    ["ogd-india", "api-setu", "india-mandi-prices", "india-lgd-index", "india-pincode"]
  );
  assert.deepEqual(
    findPublicApiCandidates({ workspaceKey: "litigation", mode: "LENDER" }),
    []
  );
  assert.deepEqual(
    findPublicApiCandidates({ workspaceKey: "fund_portfolio_management", mode: "CUSTOMER" }).map(x => x.id),
    ["ogd-india", "api-setu", "india-pincode", "indian-mutual-fund"]
  );
});

test("catalogue does not surface candidates in policy-disabled workspace modes", () => {
  assert.deepEqual(findPublicApiCandidates({ workspaceKey: "personal_loan", mode: "CUSTOMER" }), []);
  assert.deepEqual(findPublicApiCandidates({ workspaceKey: "litigation", mode: "LENDER" }), []);
});

test("search filters by names, source type and guardrail keywords", () => {
  assert.ok(findPublicApiCandidates({ query: "GSTIN" }).some(x => x.id === "gstinapi"));
  assert.ok(findPublicApiCandidates({ query: "wrapper" }).length >= 2);
});
