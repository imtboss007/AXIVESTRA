import test from "node:test";
import assert from "node:assert/strict";
import { protectExtractedContactFacts } from "../../discovery-worker/extraction-worker.mjs";
import { decryptContactValue, verifyContactFingerprint } from "../../discovery-worker/contact-validation.mjs";
import { readFile } from "node:fs/promises";

const encryptionKey = Buffer.alloc(32, 11);
const fingerprintKey = Buffer.alloc(32, 19);
const keys = { encryptionKey, fingerprintKey };

test("E05 encrypts contact facts and redacts source-span quotes before database commit", () => {
  const input = [{
    field_name: "work_email",
    value_type: "email",
    raw_value: "Person.Name@example.com",
    normalized_value: "person.name@example.com",
    source_span: { kind: "html-meta", locator: "meta[email]", quote: "Person.Name@example.com", quoteHash: "plain-sha-256" }
  }, {
    field_name: "institution_name",
    value_type: "string",
    raw_value: "Example Finance Ltd",
    normalized_value: "example finance ltd",
    source_span: { kind: "text-line", quote: "Example Finance Ltd" }
  }];
  const stored = protectExtractedContactFacts(input, keys);
  const contact = stored[0];
  assert.notEqual(contact.raw_value, input[0].raw_value);
  assert.equal(contact.normalized_value, null);
  assert.equal(contact.source_span.quoteRedacted, true);
  assert.equal(contact.source_span.quote, contact.raw_value);
  assert.equal(Object.hasOwn(contact.source_span, "quoteHash"), false);
  assert.equal(contact.raw_value_encryption_version, "aes-256-gcm-v1");
  const decrypted = decryptContactValue({
    value_ciphertext: contact.raw_value_ciphertext,
    value_nonce: contact.raw_value_nonce,
    value_auth_tag: contact.raw_value_auth_tag,
    encryption_version: contact.raw_value_encryption_version
  }, encryptionKey);
  assert.equal(decrypted, "Person.Name@example.com");
  assert.equal(verifyContactFingerprint(decrypted, contact.raw_value_fingerprint, fingerprintKey), true);
  assert.equal(stored[1].raw_value, "Example Finance Ltd");
  assert.equal(Object.hasOwn(stored[1], "raw_value_ciphertext"), false);
});

test("E05 fails closed when contacts appear but the encryption keys are missing", () => {
  assert.throws(() => protectExtractedContactFacts([{
    value_type: "phone", raw_value: "+919876543210", source_span: {}
  }], null), /cannot persist extracted email\/phone facts/);
});

test("E05 leaves non-contact facts unchanged when no contact values are present", () => {
  const facts = [{ value_type: "string", raw_value: "Example Finance Ltd" }];
  assert.equal(protectExtractedContactFacts(facts, null), facts);
});

test("database migration requires encrypted contact facts and only stores a masked value", async () => {
  const migration = await readFile(new URL("../../../supabase/migrations/20261124001000_discovery_extracted_contact_encryption.sql", import.meta.url), "utf8");
  const backfill = await readFile(new URL("../../../scripts/backfill-discovery-contact-facts.mjs", import.meta.url), "utf8");
  assert.match(migration, /raw_value_ciphertext text/);
  assert.match(migration, /raw_value_fingerprint ~ '\^\[a-f0-9\]\{64\}\$'/);
  assert.match(migration, /E05 refuses plaintext or incomplete encrypted contact facts/);
  assert.match(migration, /normalized_value := null/);
  assert.match(migration, /quoteRedacted/);
  assert.match(migration, /discovery_extracted_facts_contact_encryption_check check/);
  assert.match(migration, /not valid;/i);
  assert.match(migration, /E05 refuses plaintext or incomplete encrypted contact facts/);
  assert.match(backfill, /DISCOVERY_E05_CONTACT_BACKFILL_APPLY === "true"/);
  assert.match(backfill, /\.is\("raw_value_ciphertext", null\)/);
  assert.match(backfill, /VALIDATE CONSTRAINT discovery_extracted_facts_contact_encryption_check/);
});
