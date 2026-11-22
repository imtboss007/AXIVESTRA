# AXIVESTRA — 111-entry repository acceleration map

**Inventory source:** `AXIMACH_104_Repository_Audit.xlsx`, `AXIVESTRA_Technology_Repository_Audit.xlsx`, and `AXIVESTRA_Technology_Ecosystem_Audit.md` from the project Library.  
**Inventory count:** 104 repository/tool candidates + 7 hosted/commercial services = 111 distinct entries. These are not 111 compatible code libraries.  
**Purpose:** reuse the strongest existing work, avoid duplicate architectures, and make each AXIVESTRA stage smaller, faster to build and easier to verify.

## 1. Current acceleration already in the codebase

| Reused / retained project | Licence / status | AXIVESTRA use | Decision |
|---|---|---|---|
| [Crawlee](https://github.com/apify/crawlee) | Apache-2.0 | E04 bounded TypeScript crawler, request queue, source adapters and Playwright integration | Already used in the isolated discovery worker; keep as the single crawler foundation |
| [Playwright](https://github.com/microsoft/playwright) | Apache-2.0 | E04 browser mode only when a source is expressly approved for it; E2E/CI browser tests | Already in use; do not add another browser automation engine |
| [AG-UI](https://github.com/ag-ui-protocol/ag-ui) | MIT | Existing agent-to-UI protocol | Already in root dependencies; keep |
| [Supabase](https://github.com/supabase/supabase) | Apache-2.0 | Existing authentication, Postgres, storage and serverless functions | Keep; enforce RLS, server-side authorization and service-role isolation |
| [Dexie](https://github.com/dexie/Dexie.js) | Apache-2.0 | Existing local-first IndexedDB store | Keep; do not add a second sync engine |
| [TanStack Table](https://github.com/TanStack/table) + [Virtual](https://github.com/TanStack/virtual) | MIT | Existing data tables and large-list virtualization | Keep |
| [ECharts](https://github.com/apache/echarts) | Apache-2.0 | Existing dashboards/charts | Keep |
| [React Hook Form](https://github.com/react-hook-form/react-hook-form) + [Zod](https://github.com/colinhacks/zod) | MIT | Existing validated forms and contracts | Keep; reuse schemas at API boundaries |

**Result:** do not install a duplicate framework merely to make the stack look larger. The largest immediate gain is making existing libraries do more of the work and keeping one shared service per capability.

## 2. Highest-value selective reuse

### A. OpenProspector — provider-waterfall architecture (MIT)

Repository: [clawnify/OpenProspector](https://github.com/clawnify/OpenProspector)  
Verified in this review: MIT `LICENSE`; provider contracts in `src/server/providers/types.ts`; registry and waterfall in `src/server/providers/index.ts` and `company.ts`; recent code activity through 17 November 2026.

**Reuse selectively in the future enrichment stage (E07), not as a second app.**

The most valuable ideas are:
- thin provider adapters with one stable, vendor-neutral result contract;
- input eligibility declared before a provider is called, so missing identifiers do not burn credits;
- explicit outcomes for hit, miss, ineligible, unconfigured, no credits, error, unmapped response and pending callback;
- field-specific provider ordering rather than one global order;
- first verified value wins for deliverability fields, while company facts fill gaps without pretending one API covers everything;
- attribution, provider credit use, cache status and cost recorded per attempt;
- idempotent callbacks for asynchronous providers.

**Do not transplant its whole application.** The current OpenProspector root requires Node >=22.13 and uses React 19, Tailwind 4, Cloudflare D1, Hono, SQLite and Clawnify packages. AXIVESTRA is React 18 + Vite + Supabase/Postgres + Dexie. A wholesale adoption would introduce a second database, UI framework and runtime.

**AXIVESTRA adaptation rule:** reuse the provider-waterfall contract and tests inside the existing server-side source/enrichment architecture. Keep Supabase as the source of record. Every provider must be independently approved for purpose, territory, price, terms, data retention and export. No provider key or personal-data call is enabled by importing this repository.

### B. KeeLead — source catalogue as a review queue (MIT)

Repository: [Atum246/keelead](https://github.com/Atum246/keelead)  
Verified in this review: MIT `LICENSE`, Next.js 14 + React 18 + Prisma architecture, and the advertised 62-source catalogue.

**Use it as a source-discovery checklist, not a production connector bundle.**

The repository has a large number of source adapters, but the README's “free sources” and “62 sources” claims do not establish data licence, current endpoint availability, source terms or commercial reuse. A source-by-source review is mandatory.

A code inspection found a concrete example of why:
- `lib/sources/company/companies-house.ts` generates random example people, emails and telephone numbers instead of returning official Companies House records.
- The visible US Census adapter returns aggregate state/industry statistics and its displayed `establishments` value is sourced from the employment column; it must not be represented as company-level evidence.
- The SEC EDGAR adapter is a US public-company source, not India coverage.

Therefore, do not copy the 62-source registry into AXIVESTRA. Reuse only independently verified official API adapters after source-specific licence, API policy, attribution, rate-limit, schema, tenant and integration tests.

### C. Promptfoo — AI evaluation and red-team tests (MIT)

Repository: [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo)  
Verified: MIT package; active upstream updates on 22 November 2026.

**Use before any model/agent can interpret discovery evidence or operate AXIVESTRA records.** It belongs in isolated CI/evaluation, not the user-facing runtime. Use synthetic and redacted samples. Test prompt injection, schema compliance, unsafe claims, cross-tenant leakage, source attribution, invented facts and refusal to turn an observed contact detail into consent.

It is not yet a required runtime dependency because E05 extraction is deterministic and the application has no production model gateway in this branch.

### D. ScrapeGraphAI — optional experimental extractor (MIT)

Repository: [ScrapeGraphAI/Scrapegraph-ai](https://github.com/ScrapeGraphAI/Scrapegraph-ai)  
Verified: MIT licence; Python >=3.12; current package depends on LangChain provider integrations, Playwright and other model/processing packages.

**Do not replace E05's deterministic parsers.** A later isolated experiment may compare its LLM-based field extraction against labelled source documents, with provider keys, token cost, privacy, prompt-injection isolation and repeatability measured. It must never overwrite raw evidence or bypass source field schemas. Keep it disabled unless a model provider and data-processing basis are expressly approved.

### E. Search and geospatial tools

| Candidate | Intended use | Decision |
|---|---|---|
| [Photon](https://github.com/komoot/photon) — Apache-2.0 | Geocoding, address/place lookup | Preferred first geocoder when a real geospatial requirement appears; OSM attribution/ODbL still apply |
| [Pelias](https://github.com/pelias/pelias) — MIT | Custom, self-hosted multi-source geocoder | Use only if Photon is insufficient and operations justify its larger stack |
| [OpenSERP](https://github.com/karust/openserp) — MIT | Controlled development research/search prototype | Not a guaranteed unrestricted commercial search API; upstream search-engine rules apply |
| [OSMnx](https://github.com/gboeing/osmnx) — MIT | Offline road/network analysis | Appropriate for route/network analytics; it is not evidence of title, ownership or property value |
| [React Flow / xyflow](https://github.com/xyflow/xyflow) — MIT | Real user-editable workflow/relationship graph | Use only for a genuine node editor; ordinary route diagrams should remain lightweight |

### F. Visual/design acceleration

Use one small set of design-time aids and keep AXIVESTRA's approved token system:
- [Impeccable](https://github.com/pbakaus/impeccable) — design QA vocabulary and review skill.
- [Taste Skill](https://github.com/Leonxlnx/taste-skill) — design-direction reference.
- [Magic UI](https://github.com/magicuidesign/magicui), [Motion Primitives](https://github.com/ibelick/motion-primitives) and [ThreeUI](https://github.com/MengTo/threeui) — selectively adapt individual permitted components only.

Do not add React 19/Tailwind 4 libraries wholesale to the React 18/Vite 6 application. Do not layer Mantine, Cult UI, Origin UI, Aceternity, CopilotKit and multiple render protocols on top of the existing design system.

## 3. Do-not-integrate / guard list

- AGPL repositories (OpenGTM, OpenEnrich, SearXNG, AppFlowy, Khoj, OpenAVMKit): no embedding into the proprietary service without an explicit copyleft/legal decision.
- OpenSanctions: source code is MIT but its bulk dataset is CC BY-NC 4.0; do not use that dataset commercially without separate rights.
- Treg: Apache-2.0 plus additional hosted/embedded service restrictions; written permission required before offering it as part of AXIVESTRA SaaS.
- Scout and Company Contact Scraper: no verified compatible licence in the supplied audit; do not copy.
- LinkedIn, Google Maps and social scraping connectors: do not activate by default; platform terms, privacy, source permissions and data rights remain separate.
- KeeLead's source labels/README counts: never convert catalogue entries into approved sources automatically.
- Email permutators and SMTP checks: a guessed or syntactically valid email is not evidence of identity, deliverability or consent.
- Apollo: official API/contract use only; do not scrape the Apollo service.
- Nx, Turborepo, Rush, Temporal, PowerSync, LangGraph and CopilotKit: defer until a demonstrated workload justifies the added runtime/operations.

## 4. How repository reuse will reduce build time

1. **Inventory-first:** before implementing a capability, search this 111-entry register and the upstream repos already reviewed.
2. **Capability reuse:** compare the existing AXIVESTRA implementation first; prefer adapting one library over adding a competing framework.
3. **Adapter boundary:** isolate third-party code behind an AXIVESTRA-owned interface. Do not spread third-party data models through the database or UI.
4. **Small integration slices:** inspect licence, package compatibility, dependencies, network behaviour, security and data rights; then add one adapter/component at a time on a feature branch.
5. **Regression from day one:** require unit tests, source-contract tests and relevant CI before adding the next integration.
6. **Measure improvement:** compare implementation time, dependency count, CI duration, API calls per accepted fact, cost per accepted record, error rate, data completeness and manual review time before/after.
7. **No silent activation:** installing or adapting code never enables a source, API key, paid service, outbound call, outreach workflow, merge or deployment.

## 5. Current implementation mapping

| AXIVESTRA stage | Repositories already used / selected | Next best reuse |
|---|---|---|
| E04 source governance + fetch | Crawlee + Playwright; existing Supabase/AG-UI/Zod | Keep one crawler; no second scraping engine |
| E05 deterministic extraction | Cheerio + PDF.js over immutable evidence; schema-bound source fields | Keep deterministic baseline; Promptfoo later for model tests; ScrapeGraphAI only as an isolated experiment |
| E06 entity resolution | Existing Postgres IDs, source spans and E05 unresolved mentions | Evaluate entity-resolution patterns from OpenProspector/KeeLead, but use exact official identifiers and human review |
| E07 licensed enrichment | Existing source registry, purpose/field allow-lists, quotas, audit | Adapt OpenProspector provider-waterfall contract and per-field cost ledger; approve APIs one by one |
| E08 contact verification | No contact/outreach activation in current stage | Compare Reacher and provider-specific verifiers only for technical validation; never infer consent |
| Geospatial | No additional geocoder required in E04/E05 | Photon first; OSMnx only for network analysis |
| UI | Existing theme, TanStack, ECharts, RHF, Zod, Motion | Borrow small components from Magic UI/Motion Primitives; preserve design tokens |

## 6. What this review does and does not claim

- This document is a targeted code/compatibility review of high-value candidates, not a full security audit of every file in all 104 repositories.
- MIT/Apache/BSD licences do not grant rights to the underlying data providers or sites.
- No third-party project has been wholesale cloned into AXIVESTRA by this stage. Crawlee and Playwright are already the selected worker libraries; existing root dependencies are retained.
- No provider credentials have been added, no new external data source has been activated, and no bulk outreach is performed.
- Any future component copied from a third-party repo must preserve its copyright/licence notices and record the exact upstream commit/tag in the implementation register.
- “10,000×” is a target expression, not a benchmark. Improvement must be measured; no speed multiplier is assumed.
