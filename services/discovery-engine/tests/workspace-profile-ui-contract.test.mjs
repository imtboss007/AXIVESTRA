import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manager = await readFile(new URL("../../../src/DiscoverySourceManager.tsx", import.meta.url), "utf8");
const queue = await readFile(new URL("../../../src/DiscoveryJobQueue.tsx", import.meta.url), "utf8");
const profiles = await readFile(new URL("../../../src/lib/discovery-profiles.mjs", import.meta.url), "utf8");

test("workspace profile creation saves validated criteria instead of an empty object", () => {
  assert.match(manager, /getDefaultWorkspaceCriteria/);
  assert.match(manager, /validateWorkspaceCriteria\(JSON\.parse\(criteriaText\)/);
  assert.match(manager, /criteria\s*\n\s*\}\);/);
  assert.doesNotMatch(manager, /criteria:\s*\{\s*\}/);
});

test("existing workspace profile criteria can be edited and saved without overwriting source links", () => {
  assert.match(manager, /const saveProfileCriteria/);
  assert.match(manager, /criteriaEditors\[profile\.id\]/);
  assert.match(manager, /Workspace-specific discovery criteria saved/);
  assert.match(manager, /Save criteria/);
  assert.match(manager, /profiles\.upsert/);
});

test("discovery manager exposes full 16-workspace by 2-mode profile coverage", () => {
  assert.match(manager, /discovery-profile-coverage/);
  assert.match(manager, /WORKSPACES\.map/);
  assert.match(manager, /renderStatus\("LENDER"\)/);
  assert.match(manager, /renderStatus\("CUSTOMER"\)/);
  assert.match(manager, /Not configured/);
  assert.match(manager, /Configured · disabled/);
  assert.match(manager, /Policy restricted/);
  assert.match(manager, /enrichment-purpose/);
});

test("queued jobs carry their exact workspace/mode profile criteria to the server", () => {
  assert.match(queue, /criteria:\s*selectedProfile\.criteria \|\| \{\}/);
  assert.match(queue, /buildDiscoveryQueryHints/);
  assert.match(queue, /PROFILE-DRIVEN SEARCH PLAN/);
  assert.match(queue, /does not crawl links or expand scope/);
  assert.match(queue, /searchPublicDirectories/);
  assert.match(queue, /results remain unverified and are never fetched automatically/);
});

test("profile catalogue encodes separate lender and customer target classes with policy guardrails", () => {
  assert.match(profiles, /property_loans:/);
  assert.match(profiles, /investor_relations:/);
  assert.match(profiles, /compliance_kyc:/);
  assert.match(profiles, /disabledByPolicy/);
  assert.match(profiles, /Equity investors are not debt lenders/);
});

test("new profiles allow an exact free-text purpose before any source is approved", () => {
  assert.match(manager, /list="axivestra-discovery-purposes"/);
  assert.match(manager, /Enter the exact discovery purpose/);
  assert.doesNotMatch(manager, /purposeOptions\.length/);
});

test("profile activation is independent from target-source attachment, while E04 remains source-gated", () => {
  assert.match(manager, /Search-only profile enabled/);
  assert.match(manager, /E04 stays blocked until an exact target source is approved and attached/);
  assert.doesNotMatch(manager, /!profile\.enabled && attached\.filter\(source => source\.status === "approved"\)\.length === 0/);
});
