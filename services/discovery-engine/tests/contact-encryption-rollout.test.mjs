import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../../../supabase/migrations/20261124001000_discovery_extracted_contact_encryption.sql", import.meta.url), "utf8");
const backfill = await readFile(new URL("../../../scripts/backfill-discovery-contact-facts.mjs", import.meta.url), "utf8");
const handler = await readFile(new URL("../../../supabase/functions/discovery-control/index.ts", import.meta.url), "utf8");
const redaction = await readFile(new URL("../../../supabase/functions/_shared/discovery-contact-redaction.mjs", import.meta.url), "utf8");

test("E05 encryption constraint is added NOT VALID so existing installations are not blocked during schema rollout", () => {
  assert.match(migration, /add constraint discovery_extracted_facts_contact_encryption_check check \([\s\S]*?\) not valid/);
  assert.doesNotMatch(migration, /raise exception 'E05 contact encryption migration stopped/);
  assert.match(migration, /VALIDATE CONSTRAINT after legacy rows are encrypted/);
});

test("legacy E05 contact backfill is resumable, idempotent, secret-backed and dry-run by default", () => {
  assert.match(backfill, /DISCOVERY_E05_CONTACT_BACKFILL_APPLY === "true"/);
  assert.match(backfill, /DISCOVERY_CONTACT_ENCRYPTION_KEY/);
  assert.match(backfill, /DISCOVERY_CONTACT_FINGERPRINT_KEY/);
  assert.match(backfill, /is\("raw_value_ciphertext", null\)/);
  assert.match(backfill, /AES|encryptContactValue|encryptContactValue/);
  assert.match(backfill, /remainingLegacyRows/);
  assert.match(backfill, /offset = apply \? 0 : offset \+ rows\.length/);
  assert.match(backfill, /if \(!apply\)/);
  assert.doesNotMatch(backfill, /console\.log\([^\n]*raw/);
});

test("extraction API redacts observed contacts and source quotes before returning data", () => {
  assert.match(handler, /redactExtractedFacts\(facts \|\| \[\]\)/);
  assert.match(redaction, /quoteRedacted/);
  assert.match(redaction, /delete sourceSpan\.quoteHash/);
  assert.match(redaction, /raw_value: masked/);
});
