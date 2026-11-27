import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ui = await readFile(new URL("../../../src/DiscoverySourceManager.tsx", import.meta.url), "utf8");
const handler = await readFile(new URL("../../../supabase/functions/discovery-control/index.ts", import.meta.url), "utf8");
const connector = await readFile(new URL("../../../supabase/functions/_shared/discovery-search-connectors.mjs", import.meta.url), "utf8");

test("LENDER and CUSTOMER discovery UI renders geographic scope and workspace-specific controls per profile", () => {
  assert.match(ui, /getWorkspaceSearchFilterFields\(profile\.workspace_key, profile\.discovery_mode\)/);
  assert.match(ui, /One State \/ Union Territory/);
  assert.match(ui, /All India/);
  assert.match(ui, /International/);
  assert.match(ui, /INDIA_STATES_AND_UTS\.map/);
  assert.match(ui, /filterFields\.map/);
  assert.match(ui, /Search with selected filters/);
});

test("E03 search request sends selected filters to the authenticated backend", () => {
  assert.match(ui, /invoke\("search\.preview", \{ profileId: profile\.id, filters \}\)/);
  assert.match(handler, /normalizeDiscoverySearchFilters\(profile\.workspace_key, profile\.discovery_mode, filterInput\)/);
  assert.match(handler, /coverageScope: filters\.coverageScope/);
  assert.match(handler, /fieldKeys: Object\.keys\(filters\.fields\)/);
});

test("search query builder includes location and module filter terms in the query sent to SearXNG", () => {
  assert.match(connector, /searchTerms: cleanText\(filters\.searchTerms, 500\)/);
  assert.match(connector, /const suffix = Object\.values\(cleanFilters\)\.filter\(Boolean\)/);
});
