import test from "node:test";
import assert from "node:assert/strict";
import { redactExtractedFact, redactExtractedFacts, redactObservedContact } from "../../../supabase/functions/_shared/discovery-contact-redaction.mjs";

test("email and phone values are masked before they leave the server boundary", () => {
  assert.equal(redactObservedContact("email", "person.name@example.com"), "p***@example.com");
  assert.equal(redactObservedContact("phone", "+91 98765 43210"), "91*********10");
  assert.equal(redactObservedContact("email", "not-an-email"), "[REDACTED]");
});

test("contact fact source quotes and hashes are redacted with the displayed value", () => {
  const safe = redactExtractedFact({
    id: "fact-1",
    value_type: "email",
    raw_value: "person@example.com",
    normalized_value: "person@example.com",
    source_span: { kind: "html-meta", quote: "person@example.com", quoteHash: "sensitive-digest" }
  });
  assert.equal(safe.raw_value, "p***@example.com");
  assert.equal(safe.normalized_value, null);
  assert.equal(safe.source_span.quote, safe.raw_value);
  assert.equal(safe.source_span.quoteRedacted, true);
  assert.equal(Object.hasOwn(safe.source_span, "quoteHash"), false);
  for (const field of ["raw_value_ciphertext","raw_value_nonce","raw_value_auth_tag","raw_value_fingerprint","raw_value_encryption_version"]) {
    assert.equal(Object.hasOwn(safe, field), false, field + " must remain server-only");
  }
  assert.equal(JSON.stringify(safe).includes("person@example.com"), false);
});

test("non-contact facts remain unchanged and contact lists are transformed consistently", () => {
  const fact = { id: "fact-2", value_type: "string", raw_value: "Example Finance Ltd" };
  assert.equal(redactExtractedFact(fact), fact);
  const results = redactExtractedFacts([fact, { value_type: "phone", raw_value: "+919876543210" }]);
  assert.equal(results[0], fact);
  assert.ok(results[1].raw_value.includes("*"));
});
