import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ui = await readFile(new URL("../../../src/DiscoverySourceManager.tsx", import.meta.url), "utf8");
const handler = await readFile(new URL("../../../supabase/functions/discovery-control/index.ts", import.meta.url), "utf8");
const connector = await readFile(new URL("../../../supabase/functions/_shared/discovery-search-connectors.mjs", import.meta.url), "utf8");

test("LENDER and CUSTOMER discovery UI renders geographic scope and workspace-specific controls per profile", () => {
  assert.match(ui, /getWorkspaceSearchFilterFields\(profile\.workspace_key, profile\.discovery_mode\)/);
  assert.match(ui, /One State \/ UT/);
  assert.match(ui, /All India/);
  assert.match(ui, /International/);
  assert.match(ui, /INDIA_STATES_AND_UTS\.map/);
  assert.match(ui, /primaryFilterFields\.map/);\n  assert.match(ui, /additionalFilterFields\.map/);
  assert.match(ui, /Search with filters/);\n  assert.match(ui, /discovery-more-filters/);\n  assert.match(ui, /Clear filters/);
});

test("E03 search request sends selected filters to the authenticated backend", () => {
  assert.match(ui, /invoke\("search\.preview", \{ profileId: profile\.id, filters \}\)/);\n  assert.match(ui, /invoke\("search\.status"\)/);\n  assert.match(ui, /invoke\("search\.candidates\.list"\)/);
  assert.match(handler, /normalizeDiscoverySearchFilters\(profile\.workspace_key, profile\.discovery_mode, filterInput\)/);
  assert.match(handler, /coverageScope: filters\.coverageScope/);
  assert.match(handler, /fieldKeys: Object\.keys\(filters\.fields\)/);
});

test("search query builder includes location and module filter terms in the query sent to SearXNG", () => {
  assert.match(connector, /searchTerms: cleanText\(filters\.searchTerms, 500\)/);
  assert.match(connector, /const suffix = Object\.values\(cleanFilters\)\.filter\(Boolean\)/);
});


test("module selector limits visible profile cards and their filters to the selected workspace in the active mode", () => {
  assert.match(ui, /const activeDiscoveryMode = selectedMode \|\| "LENDER"/);
  assert.match(ui, /profile\.discovery_mode === activeDiscoveryMode &&\s*profile\.workspace_key === selectedSearchWorkspace/);
  assert.match(ui, /Select a module to search/);
  assert.match(ui, /setSelectedSearchWorkspace\(event\.target\.value\)/);
  assert.match(ui, /setProfileDraft\(current => \(\{ \.\.\.current, workspaceKey: event\.target\.value \}\)\)/);
  assert.match(ui, /getWorkspaceSearchFilterFields\(profile\.workspace_key, profile\.discovery_mode\)/);
});
