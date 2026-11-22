# AXIVESTRA — 111-entry repository acceleration map

Inventory source: `AXIMACH_104_Repository_Audit.xlsx`, `AXIVESTRA_Technology_Repository_Audit.xlsx` and `AXIVESTRA_Technology_Ecosystem_Audit.md` in the project Library.

**Inventory count:** 104 repository/tool candidates + 7 hosted/commercial services = 111 distinct entries. They are not 111 equally compatible code libraries. This register records selective reuse decisions so future modules do not reinvent existing work or create duplicate stacks.

## 1. Already reused / keep

| Project | Licence | AXIVESTRA use | Decision |
|---|---|---|---|
| [Crawlee](https://github.com/apify/crawlee) | Apache-2.0 | E04 bounded TypeScript crawler and request handling | Already integrated in isolated worker; keep as the only crawler base |
| [Playwright](https://github.com/microsoft/playwright) | Apache-2.0 | E04 approved browser mode and CI browser tests | Already integrated; do not add another browser automation engine |
| [AG-UI](https://github.com/ag-ui-protocol/ag-ui) | MIT | Existing agent-to-UI protocol | Keep |
| [Supabase](https://github.com/supabase/supabase) | Apache-2.0 | Existing Auth, Postgres, Storage and Edge Functions | Keep, with RLS and server-side authorization |
| [Dexie](https://github.com/dexie/Dexie.js) | Apache-2.0 | Existing local-first IndexedDB | Keep; do not add a second sync system |
| [TanStack Table](https://github.com/TanStack/table) + [Virtual](https://github.com/TanStack/virtual) | MIT | Existing data tables and virtualized lists | Keep |
| [ECharts](https://github.com/apache/echarts) | Apache-2.0 | Existing dashboard charts | Keep |
| [React Hook Form](https://github.com/react-hook-form/react-hook-form) + [Zod](https://github.com/colinhacks/zod) | MIT | Existing forms and validation contracts | Keep |

The fast route is to exploit the installed foundation, not add a second React framework, database, search engine or crawler.

## 2. High-value selective reuse

### OpenProspector — provider waterfall architecture

Repository: [clawnify/OpenProspector](https://github.com/clawnify/OpenProspector), MIT; recent code activity observed in November 2026.

Reuse its *architecture pattern* for AXIVESTRA E07 enrichment:
- thin provider adapters with one vendor-neutral contract;
- eligibility checks before a paid API call;
- separate outcomes for hit, miss, ineligible, unconfigured, no credits, error, unmapped response and asynchronous pending;
- independently configurable order per field;
- verified email/phone results stop the relevant waterfall; unverified fallbacks do not;
- cost/credit ledger, per-provider attribution, cache and callback receipts.

Do not adopt the whole app. Its current root uses Node >=22.13, React 19, Tailwind 4, Cloudflare D1, Hono, SQLite and Clawnify-specific packages. AXIVESTRA uses React 18, Vite, Supabase/Postgres and Dexie. Wholesale adoption would add a second database and runtime. Adapt the provider interface/runner pattern behind AXIVESTRA's current server-side source controls. Approve each provider API and data purpose independently.

### KeeLead — source catalogue as a review queue

Repository: [Atum246/keelead](https://github.com/Atum246/keelead), MIT; current architecture uses Next.js 14, React 18 and Prisma.

Use it to identify possible source families, not as a ready-made 62-source production feed. “Free source” or source-count claims do not establish data licences, endpoint reliability, commercial reuse or legal permission.

Code review found concrete reliability warnings:
- Its Companies House module generates random demo contacts/emails/phones rather than querying actual Companies House records.
- Its visible US Census connector returns aggregate state/industry data, not company-level leads; it also appears to use employment data for an establishments value.
- SEC EDGAR is a US public-company source, not India coverage.

Do not copy the full source registry. Reuse only individually verified official API adapters with source-specific tests, attribution, rate limits, jurisdictions and terms.

### Promptfoo — future AI evaluation

Repository: [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo), MIT, actively maintained.

Use it in isolated CI before any model/agent is permitted to interpret discovery evidence or act on AXIVESTRA records. Test prompt injection, schema compliance, tenant isolation, provenance, hallucinated facts, unsafe claims and consent inference using synthetic/redacted data. It is not a runtime dependency while E05 remains deterministic and no production model gateway exists.

### ScrapeGraphAI — optional experimental extraction

Repository: [ScrapeGraphAI/Scrapegraph-ai](https://github.com/ScrapeGraphAI/Scrapegraph-ai), MIT. Current project requires Python >=3.12 and includes LangChain provider integrations, Playwright and other processing dependencies.

Do not replace E05's deterministic parser baseline. Later, run it as an isolated comparison experiment against labelled documents, with explicit model/provider approval, prompt-injection tests, privacy boundaries, cost measurements and reproducibility checks. It cannot bypass source field schemas or overwrite raw evidence.

## 3. Other candidates by capability

| Candidate | Use | Decision |
|---|---|---|
| [Photon](https://github.com/komoot/photon) (Apache-2.0) | Geocoding | First geocoder to evaluate when location data is required; OSM attribution/ODbL still apply |
| [Pelias](https://github.com/pelias/pelias) (MIT) | Self-hosted multi-source geocoder | Only if Photon is insufficient and operating it is justified |
| [OpenSERP](https://github.com/karust/openserp) (MIT) | Development research/search prototype | Not a guaranteed unrestricted commercial search API; upstream search-engine terms apply |
| [OSMnx](https://github.com/gboeing/osmnx) (MIT) | Offline road/network analytics | Useful for route analysis; never evidence of property title or ownership |
| [React Flow / xyflow](https://github.com/xyflow/xyflow) (MIT) | User-editable workflow/relationship graph | Use only for an actual node editor, not static diagrams |
| [Magic UI](https://github.com/magicuidesign/magicui), [Motion Primitives](https://github.com/ibelick/motion-primitives), [ThreeUI](https://github.com/MengTo/threeui) | Select UI components | Adapt isolated components into AXIVESTRA's tokens; no second design system |
| [Impeccable](https://github.com/pbakaus/impeccable), [Taste Skill](https://github.com/Leonxlnx/taste-skill) | Development-time design QA | Use as review aids, not app dependencies |

## 4. Hard exclusions / legal gates

- AGPL repositories (OpenGTM, OpenEnrich, SearXNG, AppFlowy, Khoj, OpenAVMKit): no embedding into proprietary AXIVESTRA without a specific legal decision.
- OpenSanctions source code is MIT; the bulk dataset is CC BY-NC 4.0. Do not use that dataset commercially without separate rights.
- Treg is Apache-2.0 with additional hosted/embedded service restrictions; written permission is required before offering it as part of AXIVESTRA SaaS.
- Scout and Company Contact Scraper had no verified reusable licence in the supplied audit; do not copy.
- LinkedIn, Google Maps and social scraping connectors do not become approved sources merely because a scraper exists. Platform terms, privacy, source permissions and data rights apply.
- Email permutation or SMTP checks do not establish identity, deliverability or consent.
- Apollo: use only official API/contract scope; do not scrape its platform.
- Nx, Turborepo, Rush, Temporal, PowerSync, LangGraph and CopilotKit are deferred until a demonstrated need justifies their additional stack/operations.

## 5. AXIVESTRA stage map

| Stage | Existing stack / selected repository | Acceleration decision |
|---|---|---|
| E04 source governance + fetch | Crawlee + Playwright + Supabase | Keep one governed crawler; no competing scraper |
| E05 extraction + normalisation | Cheerio + PDF.js over immutable evidence | Keep deterministic; later Promptfoo tests and optional ScrapeGraphAI experiment |
| E06 entity resolution | E05 unresolved mentions + existing Postgres IDs | Use exact authoritative identifiers, source evidence and human review |
| E07 licensed enrichment | E04 source registry, field allow-lists, quotas, audit | Adapt OpenProspector's field waterfall, eligibility and cost ledger; approve providers one by one |
| E08 contact validation | No outbound contact in E05 | Evaluate Reacher/provider verifiers only for technical validation; never infer consent |
| Geospatial | No extra geocoder in E04/E05 | Photon first; OSMnx for network analytics |
| UI | Existing theme, TanStack, ECharts, RHF, Zod, Motion | Reuse current system; cherry-pick only compatible visual components |

## 6. Reuse operating rule

1. Search this inventory before creating a new capability.
2. Check the current AXIVESTRA implementation and avoid duplicate foundations.
3. Verify repository licence, exact package/path licence, compatibility, activity, dependencies, data-source terms and security.
4. Keep reused code behind an AXIVESTRA-owned adapter/API contract.
5. Integrate one small slice on a feature branch; retain licence notices and record exact upstream commit/tag.
6. Add unit, security, source-contract and full regression tests before adopting the next slice.
7. Measure before/after: implementation time, dependency count, CI time, API calls per accepted fact, cost per accepted record, error rate, completeness and human-review time.
8. No source, paid API, browser session, outreach, merge, main-branch change or deployment is enabled simply because code was added.

“10,000×” is an aspiration, not a benchmark. No speed multiplier is assumed without measurements.

## 7. Review boundary

This is a targeted compatibility/code inspection of high-value candidates, not a full security audit of every file in all 104 repositories. A public source-code licence does not grant rights to the underlying data or the websites queried. No third-party app has been wholesale cloned into AXIVESTRA, no provider key was added and no external source was activated by this map.
