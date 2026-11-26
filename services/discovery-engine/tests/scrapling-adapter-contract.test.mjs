import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { extractStructuredFacts } from "../../discovery-worker/extractor.mjs";

const extractor = await readFile(new URL("../../discovery-worker/extractor.mjs", import.meta.url), "utf8");
const worker = await readFile(new URL("../../discovery-worker/extraction-worker.mjs", import.meta.url), "utf8");
const parser = await readFile(new URL("../../discovery-worker/scrapling-parser.py", import.meta.url), "utf8");
const requirements = await readFile(new URL("../../discovery-worker/requirements-scrapling-parser.txt", import.meta.url), "utf8");

test("Scrapling is used only as an opt-in parser of already captured evidence", () => {
  assert.match(extractor, /spawnSync\(python, \[script\]/);
  assert.match(extractor, /htmlParserBackend === "scrapling"/);
  assert.match(worker, /AXIVESTRA_HTML_PARSER_BACKEND === "scrapling"/);
  assert.match(parser, /from scrapling\.parser import Selector/);
  assert.doesNotMatch(parser, /scrapling\.fetchers|scrapling\.spiders|StealthyFetcher|ProxyRotator|solve_cloudflare|requests\.get|urllib\.request/);
  assert.match(requirements, /^scrapling==0\.5\.1\s*$/);
});

test("the optional Scrapling backend extracts table facts from an E04 HTML snapshot without network access", () => {
  const html = Buffer.from(`<!doctype html><html><body>
    <table>
      <thead><tr><th>Sr. No.</th><th>Name of the Bank</th><th>Website</th></tr></thead>
      <tbody><tr><td>1</td><td>Example Bank Limited</td><td>https://bank.example.in</td></tr></tbody>
    </table>
  </body></html>`);
  const source = {
    allowed_fields: ["institution_name", "official_website_url"],
    field_schema: {
      institution_name: { type: "string", aliases: ["Name of the Bank"], entityKind: "organization" },
      official_website_url: { type: "url", aliases: ["Website"] }
    }
  };
  const result = extractStructuredFacts({
    bytes: html,
    contentType: "text/html",
    source,
    contentHash: "a".repeat(64),
    htmlParserBackend: "scrapling"
  });
  assert.ok(result.facts.some(fact => fact.field_name === "institution_name" && fact.raw_value === "Example Bank Limited"));
  assert.ok(result.facts.some(fact => fact.field_name === "official_website_url" && fact.raw_value === "https://bank.example.in"));
  assert.ok(result.facts.every(fact => fact.source_span.kind.startsWith("scrapling")));
});
