import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const component = await readFile(new URL("../../../src/DiscoveryPublicApiCatalogue.tsx", import.meta.url), "utf8");
const manager = await readFile(new URL("../../../src/DiscoverySourceManager.tsx", import.meta.url), "utf8");
const catalogue = await readFile(new URL("../../../src/lib/public-api-catalog.mjs", import.meta.url), "utf8");

test("public API catalogue is visible from the discovery source-governance screen and follows the selected workspace/mode", () => {
  assert.match(manager, /<DiscoveryPublicApiCatalogue workspaceKey=\{selectedWorkspaceKey\} mode=\{selectedMode\}/);
  assert.match(component, /findPublicApiCandidates/);
  assert.match(component, /workspaceKey/);
  assert.match(component, /mode/);
});

test("the UI clearly labels catalogue entries as research candidates, never approved sources", () => {
  assert.match(component, /Research catalogue only/);
  assert.match(component, /no API is called/);
  assert.match(component, /no source is added to the company registry/);
  assert.match(component, /candidate\.reviewState/);
  assert.doesNotMatch(component, /sources\.register|jobs\.enqueue|fetch\(/);
});

test("upstream API documentation links remain separate from AXIVESTRA's approved source registry", () => {
  assert.match(component, /candidate\.docsUrl/);
  assert.match(catalogue, /providerUrl:/);
  assert.match(catalogue, /docsUrl:/);
  assert.match(catalogue, /directory metadata only/i);
});
