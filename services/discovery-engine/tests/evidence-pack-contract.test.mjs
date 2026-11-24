import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

const [migration, edge, workspace, manager, packageJson, integration, roadmap, docs] = await Promise.all([
  read("supabase/migrations/20261123260000_axivestra_evidence_pack_management.sql"),
  read("supabase/functions/discovery-control/index.ts"),
  read("src/DiscoveryEvidenceWorkspace.tsx"),
  read("src/DiscoverySourceManager.tsx"),
  read("package.json"),
  read("services/discovery-worker/postgres-integration.test.mjs"),
  read("docs/AXIVESTRA-REVISED-DISCOVERY-ROADMAP-E05-E16.md"),
  read("docs/AXIVESTRA-DISCOVERY-E21-EVIDENCE-OPERATIONS.md")
]);
const packageManifest = JSON.parse(packageJson);

test("E21 creates a company-scoped evidence pack and immutable review ledger", () => {
  for (const table of ["discovery_evidence_packs","discovery_evidence_pack_items","discovery_evidence_pack_events"]) {
    assert.match(migration, new RegExp("create table if not exists public\\." + table));
  }
  for (const view of ["discovery_evidence_candidate_inbox","discovery_evidence_pack_inbox","discovery_evidence_pack_item_inbox","discovery_evidence_pack_event_inbox"]) {
    assert.match(migration, new RegExp("create or replace view public\\." + view));
  }
  assert.match(migration, /enable row level security/);
  assert.match(migration, /public\.is_company_member\(company_id\)/);
  assert.match(migration, /before update or delete on public\.discovery_evidence_pack_events/);
  assert.match(migration, /Evidence pack history is append-only/);
  assert.match(migration, /revoke all on public\.discovery_evidence_packs,[\s\S]*from public,anon,authenticated,service_role/);
  assert.match(migration, /grant select on public\.discovery_evidence_candidate_inbox/);
  assert.match(migration, /add_discovery_evidence_pack_item/);
  assert.match(migration, /Only company owners\/admins/);
});

test("E21 enforces draft curation, submit/review lifecycle and approved-only export", () => {
  assert.match(migration, /status text not null default 'draft' check\(status in \('draft','in_review','approved','rejected'\)\)/);
  assert.match(migration, /Only draft evidence packs can be changed/);
  assert.match(migration, /Only a draft evidence pack can be submitted/);
  assert.match(migration, /Only a submitted evidence pack can be reviewed/);
  assert.match(migration, /Only a rejected evidence pack can be reopened/);
  assert.match(migration, /Only an approved evidence pack can be exported/);
  assert.match(migration, /p_manifest_hash\s+!~/);
  assert.match(migration, /itemCount',v_count/);
});

test("E21 evidence views and export contract exclude raw values and storage references", () => {
  assert.match(migration, /source_license_snapshot/);
  assert.match(migration, /evidence_content_hash/);
  assert.match(migration, /evidence_retained/);
  assert.doesNotMatch(migration, /raw_blob_ref|canonical_url|raw_value|normalized_value|value_ciphertext|lease_token_hash/i);
  const exportStart = edge.indexOf('if (action === "evidence.packs.export")');
  const extractionStart = edge.indexOf('if (action === "extractions.list")', exportStart);
  assert.ok(exportStart >= 0 && extractionStart > exportStart);
  const exportBlock = edge.slice(exportStart, extractionStart);
  assert.match(exportBlock, /schemaVersion: "axivestra\.evidence-pack\.v1"/);
  assert.match(exportBlock, /manifestHash/);
  assert.match(exportBlock, /evidenceSha256/);
  assert.match(exportBlock, /evidenceRetained/);
  assert.match(exportBlock, /sourceSpan/);
  assert.match(exportBlock, /record_discovery_evidence_pack_export/);
  assert.doesNotMatch(exportBlock, /raw_blob_ref|canonical_url|raw_value|normalized_value|content_body|signedUrl/i);
});

test("E21 evidence manager is connected to the existing discovery workspace", () => {
  assert.match(workspace, /E21 · REVISED ROADMAP E11/);
  assert.match(workspace, /evidence\.packs\.list/);
  assert.match(workspace, /evidence\.packs\.add/);
  assert.match(workspace, /evidence\.packs\.submit/);
  assert.match(workspace, /evidence\.packs\.review/);
  assert.match(workspace, /evidence\.packs\.export/);
  assert.match(workspace, /metadata\/provenance bundle exported/);
  assert.match(manager, /DiscoveryEvidenceWorkspace/);
  assert.match(manager, /<DiscoveryEvidenceWorkspace companyId=\{companyId\} companyRole=\{companyRole\}\/>/);
  assert.match(packageManifest.scripts.test, /evidence-pack-contract\.test\.mjs/);
  assert.match(packageManifest.scripts["test:discovery"], /evidence-pack-contract\.test\.mjs/);
  assert.match(integration, /20261123260000_axivestra_evidence_pack_management\.sql/);
  assert.match(integration, /E21 evidence pack lifecycle/);
  assert.match(roadmap, /technical E21 evidence operations/i);
  assert.match(docs, /E21 — Evidence Manager/);
});
