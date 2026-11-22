import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export const EXTRACTOR_VERSION = "deterministic-v1.0.0";
const MAX_INPUT_BYTES = 5_000_000;
const MAX_TEXT_CHARS = 2_000_000;
const MAX_OBSERVATIONS = 20_000;
const MAX_FACTS = 2_000;
const MAX_ENTITIES = 500;

const textOf = value => typeof value === "string" ? value.trim() : String(value ?? "").trim();
const digest = value => createHash("sha256").update(value).digest("hex");

function normalizeKey(value) {
  return textOf(value).normalize("NFKC").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "");
}

function fieldDefaults(allowedFields) {
  const schema = {};
  for (const field of allowedFields || []) {
    const key = String(field);
    schema[key] = {
      type: ["email", "phone", "url", "date", "number", "boolean", "percentage", "currency"].includes(key) ? key : "string",
      aliases: [key],
      required: false,
      ...( /^(legal_name|company_name|organization_name|entity_name|institution_name)$/.test(key)
        ? { entityKind: "organization" } : {})
    };
  }
  return schema;
}

export function normalizeFieldSchema(source) {
  const allowed = new Set(Array.isArray(source?.allowed_fields) ? source.allowed_fields : []);
  const incoming = source?.field_schema && typeof source.field_schema === "object" && !Array.isArray(source.field_schema)
    ? source.field_schema : {};
  const defaults = fieldDefaults([...allowed]);
  const result = {};
  for (const field of allowed) {
    const item = incoming[field] && typeof incoming[field] === "object" && !Array.isArray(incoming[field])
      ? incoming[field] : defaults[field];
    const type = textOf(item.type || defaults[field].type);
    if (!["string","number","boolean","date","email","phone","url","identifier","currency","percentage","object","array"].includes(type)) {
      throw new Error("Unsupported source field schema type for " + field + ".");
    }
    const aliases = [...new Set([field, ...(Array.isArray(item.aliases) ? item.aliases : [])]
      .map(textOf).filter(Boolean).map(value => value.slice(0, 120)))];
    if (!aliases.length || aliases.length > 40) throw new Error("Field aliases must contain 1 to 40 values for " + field + ".");
    const entityKind = item.entityKind || defaults[field].entityKind || null;
    if (entityKind && !["organization","person","location"].includes(entityKind)) {
      throw new Error("Entity kind must be organization, person or location.");
    }
    result[field] = { type, aliases, required: item.required === true, entityKind };
  }
  return result;
}

function pushObservation(list, key, value, span, confidence = 0.96) {
  if (list.length >= MAX_OBSERVATIONS) return;
  if (!key || value === null || value === undefined) return;
  const hasText = typeof value === "string" ? value.trim().length > 0 :
    typeof value === "number" || typeof value === "boolean" ||
    (typeof value === "object" && value !== null);
  if (!hasText) return;
  const rawText = typeof value === "string" ? value.trim() : JSON.stringify(value);
  if (!rawText || rawText.length > 20_000) return;
  const quote = rawText.slice(0, 1000);
  list.push({
    key: textOf(key).slice(0, 160),
    value,
    rawText: rawText.slice(0, 20_000),
    span: { ...span, quote, quoteHash: digest(quote) },
    confidence
  });
}

function walkJson(value, path, observations, depth = 0) {
  if (depth > 32 || observations.length >= MAX_OBSERVATIONS) return;
  if (Array.isArray(value)) {
    value.slice(0, 2000).forEach((item, index) => walkJson(item, path + "[" + index + "]", observations, depth + 1));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value).slice(0, 5000)) {
      const childPath = path + "/" + key.replace(/~/g, "~0").replace(/\//g, "~1");
      pushObservation(observations, key, child, { kind: "json-pointer", locator: childPath }, 0.99);
      if (child && typeof child === "object") walkJson(child, childPath, observations, depth + 1);
    }
  }
}

function parseLabeledText(text, observations, kind) {
  let offset = 0;
  const lines = String(text || "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^\s*([^:：=]{1,120})\s*[:：=]\s*(.{1,20000}?)\s*$/u);
    if (match) {
      const rawStart = line.indexOf(match[2]);
      pushObservation(observations, match[1], match[2], {
        kind: kind || "text-line",
        line: index + 1,
        startOffset: offset + Math.max(0, rawStart),
        endOffset: offset + Math.max(0, rawStart) + match[2].length
      }, kind === "text-line" ? 0.82 : 0.91);
    }
    offset += line.length + 1;
  }
}

function parseJsonEvidence(text, observations) {
  let value;
  try { value = JSON.parse(text); } catch (error) {
    throw new Error("Evidence declared JSON but could not be parsed safely: " + error.message);
  }
  walkJson(value, "$", observations);
}

function parseHtmlEvidence(text, observations) {
  const $ = cheerio.load(text, { decodeEntities: true });
  $('script[type="application/ld+json"]').each((index, element) => {
    const raw = $(element).text();
    if (!raw.trim() || raw.length > 500_000) return;
    try {
      const value = JSON.parse(raw);
      walkJson(value, "$.jsonld[" + index + "]", observations);
    } catch {
      // Malformed embedded data is treated as untrusted and is never executed.
    }
  });
  $("script,style,noscript,template,iframe,svg").remove();

  $("title").each((index, element) => pushObservation(observations, "title", $(element).text(), {
    kind: "html-selector", locator: "title"
  }, 0.96));

  $("meta[name],meta[property]").each((index, element) => {
    const key = $(element).attr("name") || $(element).attr("property") || "";
    const content = $(element).attr("content") || "";
    if (content) pushObservation(observations, key, content, {
      kind: "html-meta", locator: "meta[" + ( $(element).attr("name") ? "name" : "property") + "='" + key + "']"
    }, 0.94);
  });

  $("table").each((tableIndex, table) => {
    $(table).find("tr").each((rowIndex, row) => {
      const cells = $(row).find("th,td").toArray();
      if (cells.length < 2) return;
      const key = $(cells[0]).text().trim();
      const value = cells.slice(1).map(cell => $(cell).text().trim()).filter(Boolean).join(" | ");
      if (key && value) pushObservation(observations, key, value, {
        kind: "html-table-cell", locator: "table:nth-of-type(" + (tableIndex + 1) + ") tr:nth-of-type(" + (rowIndex + 1) + ")"
      }, 0.9);
    });
  });

  $("dl").each((dlIndex, dl) => {
    $(dl).find("dt").each((index, dt) => {
      const dd = $(dt).next("dd");
      if (dd.length) pushObservation(observations, $(dt).text(), dd.text(), {
        kind: "html-definition-list", locator: "dl:nth-of-type(" + (dlIndex + 1) + ") dt:nth-of-type(" + (index + 1) + ")"
      }, 0.9);
    });
  });

  $("label").each((index, label) => {
    const key = $(label).text().trim();
    const value = $(label).find("input,textarea,select").first().attr("value") ||
      $(label).find("input,textarea,select").first().val();
    if (key && value) pushObservation(observations, key, value, {
      kind: "html-form-label", locator: "label:nth-of-type(" + (index + 1) + ")"
    }, 0.86);
  });

  parseLabeledText($("body").text().slice(0, MAX_TEXT_CHARS), observations, "html-labeled-text");
}

function parseXmlEvidence(text, observations) {
  const $ = cheerio.load(text, { xmlMode: true, decodeEntities: true });
  $("*").each((index, element) => {
    if ($(element).children().length) return;
    const key = element.name || "";
    const value = $(element).text().trim();
    if (key && value) pushObservation(observations, key, value, {
      kind: "xml-element", locator: "/" + key + "[" + (index + 1) + "]"
    }, 0.94);
  });
}

async function parsePdfEvidence(buffer, observations) {
  const document = await getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: true,
    stopAtErrors: true
  }).promise;
  try {
    const totalPages = Math.min(document.numPages, 300);
    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageLines = [];
      let itemIndex = 0;
      for (const item of content.items) {
        if (typeof item.str !== "string" || !item.str.trim()) continue;
        pageLines.push(item.str);
        const match = item.str.match(/^\s*([^:：=]{1,120})\s*[:：=]\s*(.{1,20000}?)\s*$/u);
        if (match) pushObservation(observations, match[1], match[2], {
          kind: "pdf-text-item", page: pageNumber, itemIndex
        }, 0.84);
        itemIndex += 1;
      }
      parseLabeledText(pageLines.join("\n"), observations, "pdf-page-text");
      if (observations.length >= MAX_OBSERVATIONS) break;
    }
    if (!observations.length) {
      // Scanned/image-only PDFs are deliberately not OCR'd. No invented facts.
      return { warning: "PDF contains no extractable text; OCR is not enabled in E05." };
    }
    return {};
  } finally {
    await document.destroy();
  }
}

function normalizeTypedValue(value, type) {
  const raw = value;
  if (type === "object" || type === "array") {
    const expectedArray = type === "array";
    if (typeof raw !== "object" || raw === null || Array.isArray(raw) !== expectedArray) {
      return { valid: false, normalized: null, message: "Value does not match required " + type + " type." };
    }
    return { valid: true, normalized: raw, message: null };
  }
  if (typeof raw === "object" && raw !== null) {
    return { valid: false, normalized: null, message: "Structured object cannot be coerced into a scalar field." };
  }
  const text = textOf(raw);
  if (!text) return { valid: false, normalized: null, message: "Value is empty." };

  if (type === "string" || type === "identifier") {
    return { valid: true, normalized: text, message: null };
  }
  if (type === "number") {
    const numeric = typeof raw === "number" ? raw : (/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text) ? Number(text.replace(/,/g, "")) : NaN);
    return Number.isFinite(numeric)
      ? { valid: true, normalized: numeric, message: null }
      : { valid: false, normalized: null, message: "Value is not an unambiguous number." };
  }
  if (type === "percentage") {
    const match = text.match(/^(-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?)\s*%?$/);
    const numeric = match ? Number(match[1].replace(/,/g, "")) : NaN;
    return Number.isFinite(numeric)
      ? { valid: true, normalized: { value: numeric, unit: "%" }, message: null }
      : { valid: false, normalized: null, message: "Value is not an explicit percentage." };
  }
  if (type === "boolean") {
    if (typeof raw === "boolean") return { valid: true, normalized: raw, message: null };
    const map = { true: true, yes: true, active: true, false: false, no: false, inactive: false };
    const value = map[text.toLowerCase()];
    return value === undefined
      ? { valid: false, normalized: null, message: "Value is not an explicit boolean state." }
      : { valid: true, normalized: value, message: null };
  }
  if (type === "date") {
    if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(text)) {
      return { valid: false, normalized: null, message: "Date must use an unambiguous ISO-8601 representation." };
    }
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime())
      ? { valid: false, normalized: null, message: "Date is invalid." }
      : { valid: true, normalized: text.length === 10 ? text : parsed.toISOString(), message: null };
  }
  if (type === "email") {
    const normalized = text.toLowerCase();
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
    return valid
      ? { valid: true, normalized, message: null }
      : { valid: false, normalized: null, message: "Value is not a syntactically valid observed email address." };
  }
  if (type === "phone") {
    // Preserve what the source actually published. No country inference, number
    // completion, deliverability test, or consent inference occurs here.
    const valid = /^[+()\d .-]{5,40}$/.test(text);
    return valid
      ? { valid: true, normalized: text, message: null }
      : { valid: false, normalized: null, message: "Value is not a plausible literal telephone string." };
  }
  if (type === "url") {
    try {
      const url = new URL(text);
      const valid = url.protocol === "https:" && !url.username && !url.password;
      return valid
        ? { valid: true, normalized: url.toString(), message: null }
        : { valid: false, normalized: null, message: "Only HTTPS URLs without embedded credentials are accepted." };
    } catch {
      return { valid: false, normalized: null, message: "Value is not a valid URL." };
    }
  }
  if (type === "currency") {
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const amount = Number(raw.amount);
      const currency = textOf(raw.currency).toUpperCase();
      if (Number.isFinite(amount) && /^[A-Z]{3}$/.test(currency)) {
        return { valid: true, normalized: { amount, currency }, message: null };
      }
    }
    const match = text.match(/^(INR|USD|EUR|GBP|AED|SGD|JPY|CAD|AUD)\s*(-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?)$/i);
    if (!match) return { valid: false, normalized: null, message: "Currency must explicitly include an ISO code and unambiguous amount." };
    return { valid: true, normalized: { amount: Number(match[2].replace(/,/g, "")), currency: match[1].toUpperCase() }, message: null };
  }
  return { valid: false, normalized: null, message: "Unsupported value type." };
}

function defaultEntityKind(fieldName, schema) {
  if (schema.entityKind) return schema.entityKind;
  if (["legal_name","company_name","organization_name","entity_name","institution_name"].includes(fieldName)) return "organization";
  return null;
}

function makeMentionKey(kind, name) {
  return kind + ":" + digest(normalizeKey(name)).slice(0, 48);
}

export function extractStructuredFacts({
  bytes,
  contentType,
  source,
  contentHash
}) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes || []);
  if (bytes.byteLength > MAX_INPUT_BYTES) throw new Error("Evidence exceeds E05's 5 MB processing limit.");
  const text = bytes.toString("utf8");
  if (text.length > MAX_TEXT_CHARS && !String(contentType).includes("pdf")) {
    throw new Error("Evidence text exceeds E05's two-million-character processing limit.");
  }

  const schema = normalizeFieldSchema(source);
  const observations = [];
  let parserWarning = null;
  const mime = String(contentType || "").split(";")[0].trim().toLowerCase();

  if (["application/json","application/ld+json"].includes(mime)) parseJsonEvidence(text, observations);
  else if (mime === "text/html") parseHtmlEvidence(text, observations);
  else if (["application/xml","text/xml"].includes(mime)) parseXmlEvidence(text, observations);
  else if (mime === "text/plain") parseLabeledText(text, observations, "text-line");
  else if (mime === "application/pdf") {
    // parsePdfEvidence is async and dispatched below
    return parsePdfEvidence(bytes, observations).then(result =>
      assembleResult(observations, schema, source, contentHash, result.warning || null));
  } else {
    return {
      entities: [], facts: [],
      warnings: ["Unsupported evidence MIME type: " + (mime || "unknown") + "."],
      extractorVersion: EXTRACTOR_VERSION,
      schemaHash: digest(JSON.stringify(schema)),
      sourceContentHash: contentHash
    };
  }
  return assembleResult(observations, schema, source, contentHash, parserWarning);
}

function assembleResult(observations, schema, source, contentHash, parserWarning) {
  const aliasMap = new Map();
  for (const [field, config] of Object.entries(schema)) {
    for (const alias of config.aliases) {
      const key = normalizeKey(alias);
      if (key && !aliasMap.has(key)) aliasMap.set(key, field);
    }
  }

  const facts = [];
  const entities = new Map();
  const seen = new Set();
  for (const observation of observations) {
    const field = aliasMap.get(normalizeKey(observation.key));
    if (!field) continue;
    const config = schema[field];
    const result = normalizeTypedValue(observation.value, config.type);
    const mentionKind = defaultEntityKind(field, config);
    let mentionKey = null;
    if (mentionKind && typeof observation.value === "string" && observation.value.trim()) {
      mentionKey = makeMentionKey(mentionKind, observation.value);
      if (!entities.has(mentionKey)) {
        entities.set(mentionKey, {
          mention_key: mentionKey,
          entity_kind: mentionKind,
          raw_name: observation.rawText,
          normalized_name: textOf(result.normalized || observation.rawText).normalize("NFKC").replace(/\s+/g, " ").trim(),
          source_span: observation.span,
          confidence: observation.confidence
        });
      }
    }

    const dedupeKey = [field, observation.rawText, JSON.stringify(observation.span)].join("|");
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    facts.push({
      mention_key: mentionKey,
      field_name: field,
      value_type: config.type,
      raw_value: observation.rawText,
      normalized_value: result.valid ? result.normalized : null,
      source_span: observation.span,
      confidence: observation.confidence,
      validation_status: result.valid ? "valid" : "invalid",
      validation_message: result.message
    });
    if (facts.length >= MAX_FACTS) break;
    if (entities.size >= MAX_ENTITIES) break;
  }

  const warnings = [];
  if (parserWarning) warnings.push(parserWarning);
  for (const [field, config] of Object.entries(schema)) {
    if (config.required && !facts.some(fact => fact.field_name === field && fact.validation_status === "valid")) {
      warnings.push("Required source field was not found or did not validate: " + field + ".");
    }
  }
  if (!facts.length) warnings.push("No source fields matched the approved extraction schema. No values were inferred.");
  return {
    entities: [...entities.values()],
    facts,
    warnings: warnings.slice(0, 100),
    invalidFactCount: facts.filter(fact => fact.validation_status === "invalid").length,
    extractorVersion: EXTRACTOR_VERSION,
    schemaHash: digest(JSON.stringify(schema)),
    sourceContentHash: contentHash
  };
}
