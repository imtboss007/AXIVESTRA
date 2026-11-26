import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadContactValidationInputs } from "./contact-validation-worker.mjs";
import { encryptContactValue } from "./contact-validation.mjs";

const worker = await readFile(new URL("./contact-validation-worker.mjs", import.meta.url), "utf8");

function mockAdmin({ run, evidence, source, facts, entities }) {
  return {
    from(table) {
      const filters = {};
      const query = {
        select() { return query; },
        eq(key, value) { filters[key] = value; return query; },
        in(key, value) { filters[key] = value; return query; },
        async maybeSingle() {
          const data = table === "discovery_extraction_runs" ? run :
            table === "discovery_evidence_items" ? evidence : source;
          return { data, error: null };
        },
        then(resolve) {
          const data = table === "discovery_extracted_facts" ? facts : entities;
          return Promise.resolve({ data, error: null }).then(resolve);
        }
      };
      return query;
    }
  };
}

const keys = { encryptionKey: Buffer.alloc(32, 2), fingerprintKey: Buffer.alloc(32, 3) };
const job = {
  company_id: "company-1", extraction_run_id: "run-1", evidence_id: "evidence-1", source_id: "source-1",
  field_schema_snapshot: { work_email: { type: "email", aliases: ["work_email"] } },
  allowed_fields_snapshot: ["work_email"]
};
const run = { id: "run-1", evidence_id: "evidence-1", source_id: "source-1", status: "completed", source_content_hash: "a".repeat(64) };
const evidence = { id: "evidence-1", content_hash: "a".repeat(64) };
const source = { id: "source-1", status: "approved", allowed_fields: ["work_email"], field_schema: job.field_schema_snapshot };
const encryptedFact = encryptContactValue("asha@example.com", keys.encryptionKey, keys.fingerprintKey);
const facts = [{
  id: "fact-1", extracted_entity_id: "entity-1", field_name: "work_email", value_type: "email",
  raw_value: null,
  raw_value_ciphertext: encryptedFact.value_ciphertext,
  raw_value_nonce: encryptedFact.value_nonce,
  raw_value_auth_tag: encryptedFact.value_auth_tag,
  raw_value_fingerprint: encryptedFact.value_fingerprint,
  raw_value_encryption_version: encryptedFact.encryption_version,
  validation_status: "valid", source_span: { kind: "json-pointer", locator: "$/email" }
}];
const entities = [{ id: "entity-1", entity_kind: "person" }];

test("E08 worker creates only encrypted candidates from source-approved email/phone facts", async () => {
  const result = await loadContactValidationInputs(mockAdmin({ run,evidence,source,facts,entities }), job, keys);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].validation.result, "syntax_valid");
  assert.equal(JSON.stringify(result.candidates).includes("asha@example.com"), false);
});

test("E08 worker rejects legacy plaintext contact facts without a complete authenticated encryption envelope", async () => {
  const plaintextFact = { ...facts[0], raw_value: "asha@example.com", raw_value_ciphertext: null };
  await assert.rejects(
    loadContactValidationInputs(mockAdmin({ run,evidence,source,facts:[plaintextFact],entities }), job, keys),
    /plaintext or incompletely encrypted E05 contact fact/
  );
});

test("E08 worker fails closed when a source removes approval or changes its contact field schema", async () => {
  await assert.rejects(
    loadContactValidationInputs(mockAdmin({
      run,evidence,source:{ ...source, status:"paused" },facts,entities
    }), job, keys),
    /source approval or exact contact-field schema changed/
  );
  await assert.rejects(
    loadContactValidationInputs(mockAdmin({
      run,evidence,source:{ ...source, field_schema:{} },facts,entities
    }), job, keys),
    /source approval or exact contact-field schema changed/
  );
});

test("E08 worker does not make provider/network calls or infer consent", () => {
  assert.doesNotMatch(worker, /fetch\s*\(/);
  assert.doesNotMatch(worker, /axios|got\(|https?\.request/);
  assert.doesNotMatch(worker, /consent|permitted_to_contact/i);
});
