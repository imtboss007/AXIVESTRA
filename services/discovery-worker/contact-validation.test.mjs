import test from "node:test";
import assert from "node:assert/strict";
import {
  buildContactCandidate, decryptContactValue, encryptContactValue, keyFromBase64,
  maskContactValue, normalizeObservedContact, normalizeProviderValidation,
  verifyContactFingerprint
} from "./contact-validation.mjs";

const enc = Buffer.alloc(32, 7);
const fp = Buffer.alloc(32, 9);
const base = {
  id: "fact-1", extracted_entity_id: "person-1", field_name: "work_email",
  value_type: "email", raw_value: "Asha.Rao@Example.com", validation_status: "valid",
  source_span: { kind: "html-meta", locator: "contact.email" }
};
const schema = { work_email: { type: "email", aliases: ["work_email"] } };

test("E08 validates observed email syntax without claiming mailbox reachability", () => {
  assert.deepEqual(normalizeObservedContact("email", "Asha.Rao@Example.com"), {
    normalizedValue: "Asha.Rao@example.com", result: "syntax_valid", reason: null
  });
  assert.equal(normalizeObservedContact("email", "not-an-email").result, "syntax_invalid");
  assert.equal(normalizeObservedContact("email", "a@@example.com").result, "syntax_invalid");
  assert.equal(normalizeObservedContact("email", "bad\r\nBcc:x@example.com").result, "syntax_invalid");
});

test("E08 requires an explicit international phone number and never guesses country code", () => {
  assert.equal(normalizeObservedContact("phone", "+91 98765-43210").normalizedValue, "+919876543210");
  assert.equal(normalizeObservedContact("phone", "9876543210").result, "syntax_invalid");
  assert.equal(normalizeObservedContact("phone", "+1 202 555 0100 ext 5").result, "syntax_invalid");
});

test("E08 rejects facts without a source-backed allow-listed email/phone schema", () => {
  assert.equal(buildContactCandidate({
    fact: base, entity: { id: "person-1", entity_kind: "person" },
    fieldSchema: {}, allowedFields: ["work_email"], evidenceId: "evidence-1",
    encryptionKey: enc, fingerprintKey: fp
  }), null);
  assert.equal(buildContactCandidate({
    fact: { ...base, field_name: "unapproved_email" },
    entity: { id: "person-1", entity_kind: "person" },
    fieldSchema: schema, allowedFields: ["work_email"], evidenceId: "evidence-1",
    encryptionKey: enc, fingerprintKey: fp
  }), null);
  assert.equal(buildContactCandidate({
    fact: { ...base, validation_status: "invalid" },
    entity: { id: "person-1", entity_kind: "person" },
    fieldSchema: schema, allowedFields: ["work_email"], evidenceId: "evidence-1",
    encryptionKey: enc, fingerprintKey: fp
  }), null);
});

test("E08 candidates contain ciphertext and keyed fingerprints, never plaintext contact values", () => {
  const candidate = buildContactCandidate({
    fact: base, entity: { id: "person-1", entity_kind: "person" },
    fieldSchema: schema, allowedFields: ["work_email"], evidenceId: "evidence-1",
    encryptionKey: enc, fingerprintKey: fp
  });
  assert.equal(candidate.contact_type, "email");
  assert.equal(candidate.validation.result, "syntax_valid");
  assert.equal(candidate.validation.method, "syntax_only");
  assert.equal(candidate.validation.catch_all_result, null);
  assert.equal(candidate.validation.bounce_type, null);
  assert.equal(candidate.masked_value, "A***o@example.com");
  assert.equal(JSON.stringify(candidate).includes("Asha.Rao@example.com"), false);
  assert.equal(decryptContactValue(candidate, enc), "Asha.Rao@example.com");
  assert.equal(verifyContactFingerprint("Asha.Rao@example.com", candidate.value_fingerprint, fp), true);
  assert.equal(verifyContactFingerprint("other@example.com", candidate.value_fingerprint, fp), false);
});

test("E08 encryption keys require canonical 32-byte base64 material", () => {
  assert.deepEqual(keyFromBase64(enc.toString("base64"), "TEST_KEY"), enc);
  assert.throws(() => keyFromBase64("too-short", "TEST_KEY"), /32 bytes/);
});

test("E08 provider outcomes are validated and keep catch-all/bounce separate", () => {
  assert.deepEqual(normalizeProviderValidation({
    provider: "reacher_self_hosted", result: "catch_all",
    catchAll: true, bounceType: null, confidence: 0.72
  }), {
    method: "reacher_self_hosted", result: "catch_all",
    catch_all_result: true, bounce_type: null, confidence: 0.72
  });
  assert.throws(() => normalizeProviderValidation({
    provider: "unknown_provider", result: "reachable", confidence: 1
  }), /not an approved/);
  assert.throws(() => normalizeProviderValidation({
    provider: "contracted_provider", result: "reachable", confidence: 2
  }), /between zero and one/);
});

test("E08 does not infer contact permission from a valid syntax result", () => {
  const candidate = buildContactCandidate({
    fact: base, entity: { id: "person-1", entity_kind: "person" },
    fieldSchema: schema, allowedFields: ["work_email"], evidenceId: "evidence-1",
    encryptionKey: enc, fingerprintKey: fp
  });
  assert.equal(Object.hasOwn(candidate, "consent"), false);
  assert.equal(Object.hasOwn(candidate, "permitted_to_contact"), false);
  assert.equal(candidate.validation.result, "syntax_valid");
});
