import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export const EXTRACTOR_VERSION = "deterministic-v1.1.0";
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
      type: ["email", "phone", "url", "date", "number", "boolean", "percentage", "currency"].includes(key)
        ? key
        : ["turnover","annual_turnover","amount","ticket_size","revenue","assets_under_management"].includes(key)
          ? "currency" : "string",
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
  for (const field of Object.keys(incoming)) {
    if (!allowed.has(field)) throw new Error("Extraction schema contains a field outside the source field allow-list: " + field + ".");
  }
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
    value.slice(0, 2000).forEach((item, index) => walkJson(item, path + "/" + index, observations, depth + 1));
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

function parseHtmlEvidence(text, observations, schema, htmlParserBackend) {
  // Use Cheerio's htmlparser2 backend for a faster, lower-allocation parse.
  // Source offsets are enabled so every table fact can point back to its exact cell.
  const backend = htmlParserBackend === "parse5" ? "parse5" : "htmlparser2";
  const $ = backend === "parse5"
    ? cheerio.load(text, { sourceCodeLocationInfo: true })
    : cheerio.load(text, {
        xml: {
          xmlMode: false,
          decodeEntities: true,
          withStartIndices: true,
          withEndIndices: true
        }
      });

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
      kind: "html-meta", locator: "meta[" + ($(element).attr("name") ? "name" : "property") + "='" + key + "']"
    }, 0.94);
  });

  const schemaAliases = new Set(
    Object.entries(schema || {}).flatMap(([field, config]) =>
      [field, ...(Array.isArray(config.aliases) ? config.aliases : [])].map(normalizeKey)
    ).filter(Boolean)
  );

  const cellSpan = (cell, tableIndex, rowNumber, columnIndex, rowCells, header) => {
    const tagName = String(cell.name || cell.tagName || "td").toLowerCase();
    const sameTagIndex = rowCells.slice(0, columnIndex + 1).filter(candidate =>
      String(candidate.name || candidate.tagName || "td").toLowerCase() === tagName
    ).length;
    const sourceLocation = cell.sourceCodeLocation;
    const startOffset = Number.isInteger(cell.startIndex) ? cell.startIndex
      : Number.isInteger(sourceLocation?.startOffset) ? sourceLocation.startOffset : null;
    const endOffset = Number.isInteger(cell.endIndex) ? cell.endIndex + 1
      : Number.isInteger(sourceLocation?.endOffset) ? sourceLocation.endOffset : null;
    return {
      kind: "html-table-cell",
      locator: "table:nth-of-type(" + (tableIndex + 1) + ") tr:nth-of-type(" + rowNumber + ") " +
        tagName + ":nth-of-type(" + sameTagIndex + ")",
      row: rowNumber,
      column: columnIndex + 1,
      cellTag: tagName,
      ...(header ? { header } : {}),
      ...(startOffset !== null ? { startOffset } : {}),
      ...(endOffset !== null ? { endOffset } : {})
    };
  };

  $("table").each((tableIndex, table) => {
    // Exclude nested-table rows: each row belongs to its nearest table only.
    const rows = $(table).find("tr").filter((_, row) => $(row).closest("table")[0] === table).toArray();
    if (!rows.length) return;
    const firstCells = $(rows[0]).children("th,td").toArray();
    const firstHeaderValues = firstCells.map(cell => $(cell).text().trim()).filter(Boolean);
    const schemaHeaderCount = firstHeaderValues.reduce((count, value) =>
      count + (schemaAliases.has(normalizeKey(value)) ? 1 : 0), 0
    );
    // Registry sites frequently style header rows with <td> inside <tbody>.
    // Require at least two schema-recognised labels and a majority match to
    // avoid reclassifying ordinary key/value rows as column headers.
    const schemaHeaderRow = firstCells.length > 1 &&
      schemaHeaderCount >= 2 &&
      schemaHeaderCount >= Math.ceil(firstHeaderValues.length * 0.5);
    const firstRowIsHeader = firstCells.length > 1 && (
      $(rows[0]).closest("thead").length > 0 ||
      firstCells.every(cell => String(cell.name || cell.tagName || "").toLowerCase() === "th") ||
      schemaHeaderRow
    );

    if (firstRowIsHeader) {
      const headers = firstCells.map(cell => $(cell).text().trim());
      rows.slice(1).forEach((row, rowOffset) => {
        const rowNumber = rowOffset + 2;
        const cells = $(row).children("th,td").toArray();
        cells.forEach((cell, columnIndex) => {
          const header = headers[columnIndex];
          const value = $(cell).text().trim();
          if (!header || !value) return;
          pushObservation(observations, header, value,
            cellSpan(cell, tableIndex, rowNumber, columnIndex, cells, header), 0.92);
        });
      });
      return;
    }

    // Key/value table: preserve each value cell independently rather than
    // collapsing several cells into one untraceable joined string.
    rows.forEach((row, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const cells = $(row).children("th,td").toArray();
      if (cells.length < 2) return;
      const key = $(cells[0]).text().trim();
      if (!key) return;
      cells.slice(1).forEach((cell, valueOffset) => {
        const value = $(cell).text().trim();
        if (!value) return;
        const columnIndex = valueOffset + 1;
        pushObservation(observations, key, value,
          cellSpan(cell, tableIndex, rowNumber, columnIndex, cells, key), 0.9);
      });
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
function parseCsvRows(text) {
  const input = String(text || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  const pushCell = () => {
    row.push(cell.trim());
    cell = "";
    if (row.length > 500) throw new Error("CSV exceeds the 500-column extraction limit.");
  };
  const pushRow = () => {
    pushCell();
    if (row.some(value => value.length > 0)) rows.push(row);
    row = [];
    if (rows.length > 20_000) throw new Error("CSV exceeds the 20,000-row extraction limit.");
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"' && cell.trim().length === 0) {
      quoted = true;
      cell = "";
    } else if (character === ",") {
      pushCell();
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      pushRow();
    } else {
      cell += character;
    }

    if (cell.length > 20_000) throw new Error("CSV cell exceeds the 20,000-character extraction limit.");
  }

  if (quoted) throw new Error("CSV contains an unterminated quoted cell.");
  if (cell.length || row.length) pushRow();
  return rows;
}

function parseCsvEvidence(text, observations) {
  const rows = parseCsvRows(text);
  if (!rows.length) return "CSV did not contain a header row or data records.";
  const headers = rows[0].map(value => value.trim());
  if (!headers.length || headers.some(header => !header)) {
    throw new Error("CSV header row contains an empty column name.");
  }

  const keys = headers.map(normalizeKey);
  if (new Set(keys).size !== keys.length) {
    throw new Error("CSV header row contains duplicate or ambiguously normalized column names.");
  }

  const warnings = [];
  if (rows.length === 1) warnings.push("CSV contains a header row but no data rows.");
  for (let rowIndex = 1; rowIndex < rows.length && observations.length < MAX_OBSERVATIONS; rowIndex += 1) {
    const values = rows[rowIndex];
    if (values.length !== headers.length && warnings.length < 10) {
      warnings.push("CSV row " + (rowIndex + 1) + " contains " + values.length + " cells; header declares " + headers.length + ".");
    }
    const count = Math.min(values.length, headers.length);
    for (let columnIndex = 0; columnIndex < count && observations.length < MAX_OBSERVATIONS; columnIndex += 1) {
      const value = values[columnIndex];
      if (!value) continue;
      pushObservation(observations, headers[columnIndex], value, {
        kind: "csv-cell",
        row: rowIndex + 1,
        column: columnIndex + 1,
        header: headers[columnIndex]
      }, 0.94);
    }
  }
  return warnings.length ? warnings.join(" ") : null;
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
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: true,
    stopAtErrors: true
  });
  try {
    const document = await loadingTask.promise;
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
    try { await loadingTask.destroy(); } catch { /* best-effort cleanup after parse/load failures */ }
  }
}

function parseLocaleIndependentNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  const text = textOf(value);
  const match = text.match(/^-?(?:(?:\d+)|(?:\d{1,3}(?:,\d{3})+)|(?:\d{1,2}(?:,\d{2})+,\d{3}))(?:\.\d+)?$/);
  return match ? Number(text.replace(/,/g, "")) : NaN;
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
    const numeric = parseLocaleIndependentNumber(raw);
    return Number.isFinite(numeric)
      ? { valid: true, normalized: numeric, message: null }
      : { valid: false, normalized: null, message: "Value is not an unambiguous number." };
  }
  if (type === "percentage") {
    const numeric = parseLocaleIndependentNumber(text.replace(/%$/, "").trim());
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
    const datePattern = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
    const match = text.match(datePattern);
    if (!match) {
      return { valid: false, normalized: null, message: "Date must use an unambiguous ISO-8601 representation." };
    }
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const calendarDate = new Date(Date.UTC(year, month - 1, day));
    const calendarValid = calendarDate.getUTCFullYear() === year &&
      calendarDate.getUTCMonth() === month - 1 && calendarDate.getUTCDate() === day;
    const parsed = new Date(text);
    if (!calendarValid || Number.isNaN(parsed.getTime())) {
      return { valid: false, normalized: null, message: "Date is not a valid calendar date or timestamp." };
    }
    return { valid: true, normalized: text.length === 10 ? text : parsed.toISOString(), message: null };
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
    const match = text.match(/^(INR|USD|EUR|GBP|AED|SGD|JPY|CAD|AUD)\s+(.+)$/i);
    const amount = match ? parseLocaleIndependentNumber(match[2]) : NaN;
    if (!match || !Number.isFinite(amount)) return { valid: false, normalized: null, message: "Currency must explicitly include an ISO code and unambiguous amount." };
    return { valid: true, normalized: { amount, currency: match[1].toUpperCase() }, message: null };
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
  contentHash,
  htmlParserBackend = "htmlparser2"
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
  else if (mime === "text/html") parseHtmlEvidence(text, observations, schema, htmlParserBackend);
  else if (["text/csv","application/csv"].includes(mime)) parserWarning = parseCsvEvidence(text, observations);
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
      if (!key) continue;
      const prior = aliasMap.get(key);
      if (prior && prior !== field) {
        throw new Error("Ambiguous source field alias \"" + alias + "\" maps to both " + prior + " and " + field + ".");
      }
      aliasMap.set(key, field);
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
  if (observations.length >= MAX_OBSERVATIONS) {
    warnings.push("The parser reached the 20,000-observation ceiling; remaining source content was not inspected.");
  }
  if (facts.length >= MAX_FACTS) {
    warnings.push("The parser reached the 2,000-fact output ceiling; remaining matching values were not emitted.");
  }
  if (entities.size >= MAX_ENTITIES) {
    warnings.push("The parser reached the 500-entity-mention ceiling; remaining entity mentions were not emitted.");
  }
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
