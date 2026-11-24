export function redactObservedContact(contactType, rawValue) {
  const raw = typeof rawValue === "string" ? rawValue.normalize("NFKC").trim() : "";
  if (!raw) return "[REDACTED]";
  if (contactType === "email") {
    const at = raw.lastIndexOf("@");
    if (at <= 0 || at === raw.length - 1) return "[REDACTED]";
    const local = raw.slice(0, at);
    const domain = raw.slice(at + 1);
    return (local.length > 1 ? local.slice(0, 1) + "***" : "*") + "@" + domain;
  }
  if (contactType === "phone") {
    const digits = raw.replace(/\D/g, "");
    return digits.length > 4
      ? digits.slice(0, 2) + "*".repeat(Math.max(4, digits.length - 4)) + digits.slice(-2)
      : "[REDACTED]";
  }
  return "[REDACTED]";
}

export function redactExtractedFact(fact) {
  if (!fact || typeof fact !== "object") return fact;
  if (!["email", "phone"].includes(fact.value_type)) return fact;
  const masked = redactObservedContact(fact.value_type, fact.raw_value);
  const sourceSpan = fact.source_span && typeof fact.source_span === "object" && !Array.isArray(fact.source_span)
    ? { ...fact.source_span }
    : {};
  delete sourceSpan.quoteHash;
  sourceSpan.quote = masked;
  sourceSpan.quoteRedacted = true;
  const safeFact = { ...fact };
  for (const key of [
    "raw_value_ciphertext",
    "raw_value_nonce",
    "raw_value_auth_tag",
    "raw_value_fingerprint",
    "raw_value_encryption_version"
  ]) delete safeFact[key];
  return {
    ...safeFact,
    raw_value: masked,
    normalized_value: null,
    source_span: sourceSpan
  };
}

export function redactExtractedFacts(facts) {
  return (Array.isArray(facts) ? facts : []).map(redactExtractedFact);
}
