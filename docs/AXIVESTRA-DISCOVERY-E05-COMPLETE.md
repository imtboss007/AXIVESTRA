# AXIVESTRA E05 — Extraction & Normalisation

**Status:** Complete engineering implementation staged on `feat/discovery-e05-complete`. It depends on the E04 governed evidence service. Not merged or deployed. The extraction worker is disabled by default.

## Stage boundary

E05 consumes an E04 immutable evidence snapshot. It extracts only fields approved for that source and maps them to that source's explicit JSON field schema. It emits typed candidate facts, unresolved entity mentions, parser diagnostics and source spans.

E05 does not search the internet, fetch URLs, crawl links, contact people, resolve canonical legal entities, score/qualify leads, infer ownership/title, or create/update workspace records. Those belong to other stages or require separate human-approved workflows. It makes no LLM/API calls. E06/E07 will handle canonical entity and people resolution; E08 separately handles contact validation.

## Deterministic parser stack

- JSON and JSON-LD: bounded recursive field traversal with JSON Pointer locators.
- HTML: Cheerio parser; JSON-LD is parsed as JSON data, not executed; metadata, title, tables, definition lists and literal key/value text are read. Scripts, styles, frames and SVG are excluded from general text parsing.
- XML: leaf-element values with element locators.
- Text: exact labelled key/value lines with line and character offsets.
- PDF: PDF.js text layer only, capped at 300 pages. OCR is deliberately not enabled; scanned/image-only PDFs produce a warning and no guessed values.

No fetched content is run as code. Page instructions are never treated as permissions or agent/system instructions.

## Source field schema

Each source registration has an explicit `field_schema` JSON object whose keys must be inside `allowed_fields`. Each field may state:
- type: string, number, boolean, ISO date, email, phone, HTTPS URL, identifier, currency, percentage, object or array;
- aliases from the source's published field labels;
- required (to report missing values);
- entityKind (organization, person or location) when a source field represents an entity mention.

The schema is size-bounded, validates supported types, caps aliases and rejects undeclared fields. Safe defaults use exact field names. Common financial amount fields use explicit currency parsing; for example `INR 12,50,000` becomes amount 1250000 with currency INR. Ambiguous numbers/dates and malformed typed values are preserved as invalid facts with a reason; values are not silently coerced.

## Immutable output and provenance

Each extraction run is bound to one company, E04 evidence row, source ID, source content hash, parser version and schema hash. Every output item contains:
- exact source field name and value type;
- raw observed value and separately normalised JSON value;
- validation status and validation message;
- heuristic parser confidence/score;
- a source locator (JSON Pointer, HTML selector/meta/table, XML element, text line+offset, or PDF page/item), plus a bounded quoted span and quote hash.

An extracted organization/person/location is only an unresolved source mention. It is not a canonical entity. Conflicting evidence remains separately attributed to its original evidence snapshot; E05 does not overwrite prior values.

Evidence is never changed by extraction. Extraction output and review events are append-only. Human corrections are recorded as separate review events, not destructive updates. Facts, entity mentions and review items are company-scoped by composite foreign keys; deletion under approved evidence retention cascades the derived extraction outputs while the E04 fetch-event audit record remains.

## Worker / operations

Run E04 and E05 as separate processes, with independent environment switches and server-only credentials:

- E04 fetch process: `npm --prefix services/discovery-worker start` (requires `DISCOVERY_WORKER_ENABLED=true` plus a live company owner/admin fetch grant).
- E05 extraction process: `npm --prefix services/discovery-worker run start:extraction` (requires `DISCOVERY_EXTRACTION_WORKER_ENABLED=true`).

E05 does not require or use the E04 one-hour outbound fetch grant because it performs no network requests. It still rechecks that the source remains approved, the parent discovery job succeeded, the workspace profile is enabled, and the source remains attached. Its worker must be run only in a secured server environment with service-role credentials. Both processes are disabled by default.

The E05 worker can claim multiple independent evidence jobs in parallel using `DISCOVERY_EXTRACTION_CONCURRENCY` (default **2**, hard-capped at **4** slots per process). Each slot has a distinct worker identity and lease; PostgreSQL `FOR UPDATE SKIP LOCKED` prevents two slots from claiming the same job. Additional worker processes can be added horizontally. Increase concurrency only after measuring CPU, memory and PDF workload on the deployment host; the limit is intentionally conservative to avoid memory spikes from parsing multiple large PDFs at once.

The extraction queue is automatically populated after a new eligible E04 evidence snapshot is stored, and the E05 migration also queues historical eligible evidence that was captured before E05 existed. A job is claimed using a leased `FOR UPDATE SKIP LOCKED` RPC, heartbeated, retried with capped attempts/backoff, and completed atomically with its output records.

## AXIVESTRA UI

The existing external-intelligence source manager now includes:
- source-specific field schema editor;
- recent extraction run selector;
- evidence hash, source, parser version, counts and warnings;
- valid/invalid fact status, raw and normalized values, heuristic score and source span;
- unresolved entity mentions clearly separated from canonical entity records;
- owner/admin accept/reject actions that append a review receipt.

Company members may view company-scoped extraction outputs; only company owner/admin roles may write human review decisions. No fact is promoted into a customer, lender, contact or asset record by this stage.

## Validation

CI includes:
- deterministic parser tests for JSON/HTML/JSON-LD/XML/CSV/text/PDF text layers and typed values;\n- a synthetic-data parser benchmark reporting operations/second, facts/second, bytes/second, mean/p95 latency and heap delta for JSON, HTML, XML, CSV and text (run manually with `npm --prefix services/discovery-worker run bench:extractor`);
- alias, allowed-field, missing-required-field, injection-like text and no-consent-inference tests;
- E05 SQL contract tests;
- PostgreSQL 16 integration tests that apply E02/E04/E05 migrations, claim extraction jobs and verify company-scoped provenance/facts, field allow-lists, immutable output and evidence-retention cascade;
- full AXIVESTRA regression, Deno Edge Function type-check and application build.

A successful complete CI run is required before E05 is called validated. The benchmark creates a measurable throughput baseline; no 10,000× improvement is claimed until an apples-to-apples baseline is measured against the previous extraction path on the same hardware and evidence fixtures.

## Repository-inventory reuse decisions

This build follows the 111-entry inventory's direction without stacking overlapping products:

- **R085 Crawlee (Apache-2.0)** remains the single shared crawler foundation for E04.
- **R087 Playwright (Apache-2.0)** remains the existing browser test dependency and is used by E04 only under the explicit source render policy. It is not a second crawler engine.
- **R044 Crawl4AI, R045 Scrapling, R086 Scrapy and R064 AnyCrawl** are alternatives, not added dependencies. The current shared Node worker is already Crawlee-based.
- **R052 ScrapeGraphAI (MIT)** is deferred to a separate, isolated experiment only; it is not in the E05 production extraction path and no LLM calls are made.
- **R083 Promptfoo (MIT)** is reserved for synthetic-data evaluations and prompt-injection regression before a future model-assisted extraction experiment. It is not needed in deterministic E05 production runtime.
- **Langfuse** is deferred until real production model traffic exists.
- Existing AXIVESTRA React, Supabase, AG-UI, table and theme components are retained; no competing UI/agent/workflow framework was added.

The speed strategy is reuse + deterministic parsing + bounded parallel job claims + one evidence model, not more overlapping crawler or agent frameworks.

## Release gate / exclusions

No E05 migration is applied to the production database. No extraction worker is running. No LLM provider or third-party extraction engine has been connected. ScrapeGraphAI remains a possible isolated experiment only after prompt-injection, privacy, cost, source terms and security gates are reviewed. No merge, deployment or external data-source activation has occurred.
