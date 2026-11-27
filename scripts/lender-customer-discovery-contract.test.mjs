import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const manager = await readFile(new URL("../src/DiscoverySourceManager.tsx", import.meta.url), "utf8");

test("LENDER and CUSTOMER discovery are separate first-class navigation destinations", () => {
  assert.match(app, /name: "Lender Discovery"/);
  assert.match(app, /name: "Customer Discovery"/);
  assert.match(app, /active === "Lender Discovery"[\s\S]*?selectedMode="LENDER"/);
  assert.match(app, /active === "Customer Discovery"[\s\S]*?selectedMode="CUSTOMER"/);
});

test("company-workspace gate offers an explicit way to switch workspace", () => {
  assert.match(manager, /onSwitchWorkspace\?: \(\) => void/);
  assert.match(manager, /onSwitchWorkspace\(\)/);
  assert.match(manager, /Switch to company workspace/);
});

test("each discovery destination filters profiles to its selected module and mode", () => {
  assert.match(manager, /const activeDiscoveryMode = selectedMode \|\| "LENDER"/);
  assert.match(manager, /profile\.discovery_mode === activeDiscoveryMode &&\s*profile\.workspace_key === selectedSearchWorkspace/);
  assert.match(manager, /invoke\("search\.preview", \{ profileId: profile\.id, filters \}\)/);
  assert.match(manager, /Search with filters/);
  assert.match(manager, /Saved candidates/);
  assert.match(manager, /searchServiceConfigured !== true/);
});
