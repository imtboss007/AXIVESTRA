import test from "node:test";
import assert from "node:assert/strict";
import {
  isPublicAddress, assertPublicResolvedAddresses, parseRobotsRules,
  redactUrl, validateCandidateUrls, makeRobotsUrl
} from "./worker-policy.mjs";

const source = {
  id: "source-1",
  status: "approved",
  canonical_url: "https://registry.example.gov.in/api",
  domain: "registry.example.gov.in",
  allowed_paths: ["/api/v1/entities"],
  max_pages_per_job: 4
};

test("fetch destination guard rejects private, loopback, link-local and reserved IPv4", () => {
  for (const ip of ["127.0.0.1","10.1.2.3","172.16.0.1","192.168.1.1","169.254.1.1","100.64.0.1","224.0.0.1","203.0.113.5"]) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("1.1.1.1"), true);
});

test("fetch destination guard accepts only public global-unicast IPv6", () => {
  for (const ip of ["::1","::","fe80::1","fc00::1","ff02::1","2001:db8::1","2001:2::1","2001:20::1","2002::1","3fff::1","5f00::1"]) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
});

test("DNS answers fail closed when any answer is non-public", () => {
  assert.equal(assertPublicResolvedAddresses([{ address: "8.8.8.8", family: 4 }]).address, "8.8.8.8");
  assert.throws(() => assertPublicResolvedAddresses([
    { address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }
  ]), /private or reserved/);
});

test("robots policy applies user-agent groups and most-specific allow/disallow rule", () => {
  const rules = parseRobotsRules(`
User-agent: *
Disallow: /private
Disallow: /api/internal
Allow: /api/internal/public
User-agent: AXIVESTRA-DiscoveryBot
Disallow: /restricted
Allow: /restricted/public$
`);
  assert.equal(rules.allows("https://registry.example.gov.in/api/v1/entities/1"), true);
  assert.equal(rules.allows("https://registry.example.gov.in/private/record"), false);
  assert.equal(rules.allows("https://registry.example.gov.in/api/internal/record"), false);
  assert.equal(rules.allows("https://registry.example.gov.in/api/internal/public/record"), true);
  assert.equal(rules.allows("https://registry.example.gov.in/restricted/private"), false);
  assert.equal(rules.allows("https://registry.example.gov.in/restricted/public"), true);
});

test("candidate URL validation is exact-host, path-allow-listed and page-budget limited", () => {
  assert.deepEqual(validateCandidateUrls(source, ["https://registry.example.gov.in/api/v1/entities/123"]), [
    "https://registry.example.gov.in/api/v1/entities/123"
  ]);
  assert.throws(() => validateCandidateUrls(source, ["https://evil.example/api/v1/entities"]), /exact approved source origin/);
  assert.throws(() => validateCandidateUrls(source, ["https://registry.example.gov.in/private"]), /approved source path list/);
  assert.throws(() => validateCandidateUrls(source, Array(5).fill("https://registry.example.gov.in/api/v1/entities/123")), /approved maximum/);
  assert.throws(() => validateCandidateUrls(source, ["https://registry.example.gov.in/api/v1/entities/123", "https://registry.example.gov.in/api/v1/entities/123"]), /Duplicate/);
});

test("robots policy URL is exact same-origin /robots.txt", () => {
  assert.equal(makeRobotsUrl(source), "https://registry.example.gov.in/robots.txt");
});

test("audit URL redaction keeps parameter names but removes values", () => {
  assert.equal(
    redactUrl("https://registry.example.gov.in/api/v1/entities?api_key=secret&region=IN"),
    "https://registry.example.gov.in/api/v1/entities?api_key=%5Bredacted%5D&region=%5Bredacted%5D"
  );
});
