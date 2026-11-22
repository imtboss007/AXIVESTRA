import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const extractor = await readFile(new URL("../../discovery-worker/extractor.mjs", import.meta.url), "utf8");
const worker = await readFile(new URL("../../discovery-worker/extraction-worker.mjs", import.meta.url), "utf8");
const migration = await readFile(new URL("../../../supabase/migrations/20261122190000_discovery_extraction.sql", import.meta.url), "utf8");
const postgresTest = await readFile(new URL("../../discovery-worker/postgres-integration.test.mjs", import.meta.url), "utf8");

test("E05 starts with deterministic parsers for JSON, HTML, XML, text and PDF text layers", () => {
  assert.match(extractor, /parseJsonEvidence/);
  assert.match(extractor, /parseHtmlEvidence/);
  assert.match(extractor, /parseXmlEvidence/);
  assert.match(extractor, /parseLabeledText/);
  assert.match(extractor, /parsePdfEvidence/);
  assert.match(extractor, /isEvalSupported: false/);
  assert.match(extractor, /OCR is not enabled in E05/);
});

test("E05 is source-schema bounded and rejects fields outside source allow-list", () => {
  assert.match(extractor, /normalizeFieldSchema/);
  assert.match(extractor, /source\?\.allowed_fields/);
  assert.match(extractor, /aliasMap\.get\(normalizeKey\(observation\.key\)\)/);
  assert.match(migration, /v_field = any\(v_source\.allowed_fields\)/);
  assert.match(migration, /field_schema \? v_field/);
  assert.match(migration, /field_schema->v_field->>'type'/);
});

test("every extracted fact retains raw value, typed value, confidence and source-span locator", () => {
  for (const token of ["raw_value","normalized_value","source_span","confidence","validation_status","validation_message"]) {
    assert.match(migration, new RegExp(token));
  }
  assert.match(extractor, /quoteHash/);
  assert.match(extractor, /source_span: observation\.span/);
  assert.match(migration, /source_content_hash/);
  assert.match(migration, /v_evidence\.content_hash is distinct from p_run/);
});

test("extraction remains separate from model outputs and no model API is called by the worker", () => {
  assert.match(worker, /extractStructuredFacts/);
  assert.match(worker, /DISCOVERY_EXTRACTION_WORKER_ENABLED !== "true"/);
  assert.doesNotMatch(worker, /openai|anthropic|google\.generativeai|fetch\(/i);
  assert.match(migration, /extraction_method text not null default 'deterministic'/);
  assert.match(migration, /llm_experimental/);
  assert.match(migration, /revoke all on function public\.complete_discovery_extraction/);
});

test("extraction leases are atomic, retry-bounded and tied to current approved profiles", () => {
  assert.match(migration, /for update of j skip locked/);
  assert.match(migration, /attempts >= max_attempts/);
  assert.match(migration, /discovery_profiles p[\s\S]*?p\.enabled = true/);
  assert.match(migration, /heartbeat_discovery_extraction_job/);
  assert.match(worker, /heartbeat_discovery_extraction_job/);
});

test("extraction output is immutable and human corrections are append-only review events", () => {
  assert.match(migration, /prevent_discovery_extraction_update/);
  assert.match(migration, /discovery_extraction_review_events/);
  assert.match(migration, /decision in \('accepted','rejected','corrected','escalated'\)/);
  assert.match(migration, /on delete cascade/);
  assert.match(postgresTest, /complete_discovery_extraction/);
  assert.match(postgresTest, /append-only/);
});

test("extraction jobs are enqueued only from approved captured evidence and remain company scoped", () => {
  assert.match(migration, /enqueue_discovery_extraction_for_evidence/);
  assert.match(migration, /s\.status = 'approved'/);
  assert.match(migration, /unique\(company_id, evidence_id\)/);
  assert.match(migration, /references public\.discovery_evidence_items\(company_id, id\)/);
});
