import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { domainToASCII } from "node:url";

const MAX_CONTACT_CHARS = 320;
const EMAIL_LOCAL_MAX = 64;
const PHONE_E164 = /^\+[1-9][0-9]{7,14}$/;

function inputText(value) {
  return typeof value === "string" ? value.normalize("NFKC").trim() : "";
}

export function normalizeObservedContact(contactType, rawValue) {
  const raw = inputText(rawValue);
  if (!raw || raw.length > MAX_CONTACT_CHARS || /[\r\n\u0000]/.test(raw)) {
    return { normalizedValue: null, result: "syntax_invalid", reason: "empty_or_oversized_or_control_character" };
  }

  if (contactType === "email") {
    if (/\s/.test(raw)) return { normalizedValue: null, result: "syntax_invalid", reason: "whitespace_not_allowed" };
    const at = raw.lastIndexOf("@");
    if (at <= 0 || at !== raw.indexOf("@")) {
      return { normalizedValue: null, result: "syntax_invalid", reason: "invalid_at_separator" };
    }
    const local = raw.slice(0, at);
    const domain = domainToASCII(raw.slice(at + 1));
    if (!local || local.length > EMAIL_LOCAL_MAX || !domain || domain.length > 253 ||
        local.startsWith(".") || local.endsWith(".") || local.includes("..") ||
        !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) {
      return { normalizedValue: null, result: "syntax_invalid", reason: "invalid_email_local_or_domain" };
    }
    const labels = domain.toLowerCase().split(".");
    if (labels.length < 2 || labels.some(label =>
      !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
    )) {
      return { normalizedValue: null, result: "syntax_invalid", reason: "invalid_email_domain" };
    }
    return { normalizedValue: local + "@" + domain.toLowerCase(), result: "syntax_valid", reason: null };
  }

  if (contactType === "phone") {
    if (/[A-Za-z]/.test(raw) || /(?:ext\.?|x)\s*\d+$/i.test(raw)) {
      return { normalizedValue: null, result: "syntax_invalid", reason: "extension_or_alphabetic_content_not_supported" };
    }
    const compact = raw.replace(/[\s().-]/g, "");
    if (!PHONE_E164.test(compact)) {
      return { normalizedValue: null, result: "syntax_invalid", reason: "international_e164_required_no_country_guessing" };
    }
    return { normalizedValue: compact, result: "syntax_valid", reason: null };
  }

  return { normalizedValue: null, result: "syntax_invalid", reason: "unsupported_contact_type" };
}

function assertKey(key, name) {
  const value = Buffer.isBuffer(key) ? key : Buffer.from(key || []);
  if (value.length !== 32) throw new Error(name + " must be exactly 32 bytes.");
  return value;
}

export function keyFromBase64(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(name + " is required when E08 runs.");
  const key = Buffer.from(value.trim(), "base64");
  if (key.length !== 32 || key.toString("base64") !== value.trim()) {
    throw new Error(name + " must be canonical base64 for exactly 32 bytes.");
  }
  return key;
}

export function encryptContactValue(normalizedValue, encryptionKey, fingerprintKey) {
  const value = inputText(normalizedValue);
  if (!value || value.length > MAX_CONTACT_CHARS) throw new Error("Contact value is empty or oversized.");
  const encKey = assertKey(encryptionKey, "DISCOVERY_CONTACT_ENCRYPTION_KEY");
  const fpKey = assertKey(fingerprintKey, "DISCOVERY_CONTACT_FINGERPRINT_KEY");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const fingerprint = createHmac("sha256", fpKey).update(value, "utf8").digest("hex");
  return {
    value_ciphertext: ciphertext.toString("base64"),
    value_nonce: nonce.toString("base64"),
    value_auth_tag: tag.toString("base64"),
    value_fingerprint: fingerprint,
    encryption_version: "aes-256-gcm-v1"
  };
}

export function decryptContactValue(envelope, encryptionKey) {
  const key = assertKey(encryptionKey, "DISCOVERY_CONTACT_ENCRYPTION_KEY");
  if (envelope?.encryption_version !== "aes-256-gcm-v1") throw new Error("Unsupported contact encryption version.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.value_nonce, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.value_auth_tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.value_ciphertext, "base64")),
    decipher.final()
  ]).toString("utf8");
}

export function verifyContactFingerprint(value, expectedFingerprint, fingerprintKey) {
  const key = assertKey(fingerprintKey, "DISCOVERY_CONTACT_FINGERPRINT_KEY");
  const actual = createHmac("sha256", key).update(inputText(value), "utf8").digest();
  const expected = Buffer.from(String(expectedFingerprint || ""), "hex");
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

export function maskContactValue(contactType, normalizedValue) {
  if (contactType === "email") {
    const [local, domain] = String(normalizedValue).split("@");
    if (!domain) return "***";
    const shown = local.length > 2 ? local.slice(0, 1) + "***" + local.slice(-1) : "*".repeat(local.length);
    return shown + "@" + domain;
  }
  if (contactType === "phone") {
    const value = String(normalizedValue);
    return value.length > 4 ? value.slice(0, 3) + "*".repeat(Math.max(3, value.length - 5)) + value.slice(-2) : "***";
  }
  return "***";
}

export function buildContactCandidate({ fact, entity, fieldSchema, allowedFields, evidenceId, encryptionKey, fingerprintKey }) {
  if (!fact || fact.validation_status !== "valid" || !fact.source_span ||
      typeof fact.source_span !== "object" || Array.isArray(fact.source_span)) return null;
  const fieldName = String(fact.field_name || "");
  if (!Array.isArray(allowedFields) || !allowedFields.includes(fieldName)) return null;
  const fieldDefinition = fieldSchema?.[fieldName];
  const contactType = fieldDefinition?.type;
  if (!["email", "phone"].includes(contactType) || fact.value_type !== contactType) return null;
  if (!entity || fact.extracted_entity_id !== entity.id) return null;

  const validation = normalizeObservedContact(contactType, fact.raw_value);
  const normalizedValue = validation.normalizedValue || inputText(fact.raw_value);
  if (!normalizedValue || normalizedValue.length > MAX_CONTACT_CHARS) return null;
  const encrypted = encryptContactValue(normalizedValue, encryptionKey, fingerprintKey);
  return {
    extracted_fact_id: fact.id,
    extracted_entity_id: entity.id,
    entity_kind: entity.entity_kind,
    contact_type: contactType,
    field_name: fieldName,
    ...encrypted,
    masked_value: maskContactValue(contactType, normalizedValue),
    validation: {
      method: "syntax_only",
      result: validation.result,
      reason: validation.reason,
      confidence: validation.result === "syntax_valid" ? 0.99 : 0.99,
      catch_all_result: null,
      bounce_type: null
    },
    source_span: fact.source_span,
    evidence_id: evidenceId
  };
}

export function normalizeProviderValidation({ provider, result, catchAll, bounceType, confidence }) {
  const providerName = String(provider || "").trim().toLowerCase();
  if (!["reacher_self_hosted", "contracted_provider", "inbound_bounce", "manual_review"].includes(providerName)) {
    throw new Error("Validation provider is not an approved E08 adapter.");
  }
  const allowedResults = new Set([
    "reachable", "not_reachable", "catch_all", "mailbox_unknown",
    "mx_found", "no_mx", "bounced", "provider_unknown"
  ]);
  if (!allowedResults.has(result)) throw new Error("Unsupported provider validation result.");
  const bounce = bounceType ?? null;
  if (bounce !== null && !["soft_bounce", "hard_bounce", "complaint"].includes(bounce)) {
    throw new Error("Unsupported bounce classification.");
  }
  const score = Number(confidence);
  if (!Number.isFinite(score) || score < 0 || score > 1) throw new Error("Validation confidence must be between zero and one.");
  return {
    method: providerName,
    result,
    catch_all_result: typeof catchAll === "boolean" ? catchAll : null,
    bounce_type: bounce,
    confidence: score
  };
}
