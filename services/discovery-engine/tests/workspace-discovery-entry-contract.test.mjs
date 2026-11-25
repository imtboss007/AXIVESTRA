import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const moduleWorkbench = await readFile(new URL("../../../src/ModuleWorkbench.tsx", import.meta.url), "utf8");
const app = await readFile(new URL("../../../src/App.tsx", import.meta.url), "utf8");
const manager = await readFile(new URL("../../../src/DiscoverySourceManager.tsx", import.meta.url), "utf8");
const queue = await readFile(new URL("../../../src/DiscoveryJobQueue.tsx", import.meta.url), "utf8");

test("each of the sixteen workspaces has a distinct contextual discovery key", () => {
  const keys = [
    "property_sale","property_loans","jv_jda_jd","sr_rate_settlement",
    "agricultural_land","commercial_land","house_purchase","unsecured_company_loan",
    "personal_loan","housing_loan","startup","equity",
    "fund_portfolio_management","investor_relations","litigation","compliance_kyc"
  ];
  for (const key of keys) assert.ok(moduleWorkbench.includes('"' + key + '"'), key + " has no discovery entry");
  assert.match(moduleWorkbench, /Find Lenders/);
  assert.match(moduleWorkbench, /Discover Customers/);
});

test("workspace actions route with an exact selected workspace and LENDER/CUSTOMER mode", () => {
  assert.match(app, /discoveryWorkspaceKey/);
  assert.match(app, /setDiscoveryWorkspaceKey\(workspaceKey\)/);
  assert.match(app, /setDiscoveryMode\(mode\)/);
  assert.match(app, /selectedWorkspaceKey=\{discoveryWorkspaceKey\}/);
  assert.match(app, /selectedMode=\{discoveryMode\}/);
  assert.match(manager, /selectedWorkspaceKey/);
  assert.match(manager, /selectedMode/);
});

test("the contextual queue prioritises the selected enabled profile instead of another workspace", () => {
  assert.match(manager, /initialWorkspaceKey=\{selectedWorkspaceKey\}/);
  assert.match(manager, /initialMode=\{selectedMode\}/);
  assert.match(queue, /initialWorkspaceKey\s*\?/);
  assert.match(queue, /profile\.workspace_key === initialWorkspaceKey/);
  assert.match(queue, /profile\.discovery_mode === \(initialMode \|\| "LENDER"\)/);
});
