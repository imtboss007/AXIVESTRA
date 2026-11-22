# AXIVESTRA Visual Repository Integration Register

**Branch:** `feature/axivestra-visual-integration`  
**Base:** `feature/axivestra-enterprise-experience` at `db014c6fc81d7cf082993dbd353ac9691fd962a9`  
**Scope:** Visual quality, interaction, responsive behaviour and visual regression only.  
**Guardrails:** React 18 + Vite 6; preserve all 16 workspaces, business logic, data models, navigation, permissions, Dexie/Supabase sync, WhatsApp flows, Electron and Capacitor. No merge, deployment or paid service.

## 1. Inventory interpretation

The supplied audit contains 104 repository/tool candidates plus 7 commercial/service products (111 unique entries). They are not 104 visual libraries. The complete inventory must be evaluated by capability, with non-visual infrastructure retained in its own workstream. This register therefore does not discard the non-visual entries; it prevents them from being incorrectly treated as UI component libraries.

## 2. AXIVESTRA visual baseline found in code

- The existing app already has a custom orbital command centre in `src/AxivestraOrbitalHub.tsx`, not a blank dashboard awaiting a 3D framework.
- Existing visual surfaces include `PortfolioAnalytics.tsx` (lazy ECharts), `RelationshipIntelligencePanel.tsx` (explicit-ID relationship graph), `IntelligenceHubExplorer.tsx` (filterable intelligence workspace) and TanStack-backed data tables.
- Existing theme tokens are Night Marine, Teal and restrained Brass in `src/axivestra-theme.css`.
- The theme currently contains mixed visual signals: `color-scheme: light`, white topbar/search/input surfaces and light banner/button overrides coexist with dark canvas/surface tokens. This is a priority consistency defect to review before adding more component libraries.
- The app uses React 18.3.1, Vite 6.0.5 and Lucide. Avoid React 19/Tailwind 4 assumptions and avoid introducing a second component framework.

## 3. Visual candidate register

| Candidate | Capability | Compatibility / licence gate | AXIVESTRA decision |
|---|---|---|---|
| Existing AXIVESTRA orbital hub | 3D-like orbital navigation, 16 workspaces, live counts | Native React/CSS; already in app | **Keep and refine first.** Do not replace with a generic landing-page template. |
| Magic UI | Polished React motion/component patterns | MIT; adapt Tailwind-oriented snippets to current CSS and React 18 | **Select components only** for purposeful micro-interactions. |
| Motion Primitives | Motion patterns and transitions | MIT; check peer dependencies and reduced-motion behaviour | **Select selectively** where it improves interaction clarity. |
| shadcn/ui primitives | Accessible interaction primitives | MIT; copy/adapt only needed primitives, avoid adopting a second full theme | **Reference/adapt** for accessible menus, dialogs, tabs and command patterns if current primitives are deficient. |
| Cult UI | Large shadcn-style component catalogue | MIT; current monorepo targets React 19/Tailwind 4 | **Adapt individual MIT snippets only**; no wholesale install. |
| Origin UI | Copy/paste UI patterns | MIT metadata; verify current canonical source and React/Tailwind assumptions | **Reference/adapt** only. |
| SmoothUI | Animated UI components | MIT; current workspace uses newer Vite/React/Tailwind assumptions | **Do not install wholesale**; cherry-pick only after React 18 adaptation. |
| React Bits | Animated components, backgrounds, effects | Repo reports NOASSERTION; manifest uses React 19/Tailwind 4 and large dependency set | **Do not bulk-copy/install.** Individual item requires exact licence and dependency review. |
| Unlumen UI | Component registry/docs | Public docs/registry MIT; Pro/private content separate | **Public MIT items only**, no Pro source. |
| Aceternity UI | Premium visual patterns | Paid tiers and per-item terms; commercial end-product use differs from redistribution | **Hold** until exact item licence/entitlement is confirmed. |
| ThreeUI | 3D/interactive component patterns | MIT Community; Pro/Beta and third-party assets separate | **Conditional** for a concrete 3D property/site view, not dashboard decoration. |
| Three.js + React Three Fiber + Drei | Full 3D scene rendering | MIT packages; performance and mobile bundle cost | **Defer.** Existing orbital UI does not justify a full 3D engine yet. |
| GSAP | Advanced animation timeline | Verify exact package/plugin terms | **Optional**, only if CSS/React transitions cannot meet a demonstrated need. |
| React Flow / xyflow | Editable node-edge graphs | MIT | **Conditional** for a real deal/workflow graph editor. Existing relationship view is read-only and should remain evidence-based. |
| ECharts | Charts and analytical visualization | Apache-2.0; already integrated and lazy-loaded | **Keep.** Improve chart layout/empty states/legends rather than add Recharts. |
| TanStack Table + Virtual | Dense data tables and virtualization | MIT; already integrated | **Keep.** No duplicate table framework. |
| React Grid Layout | User-configurable dashboard layouts | MIT | **Defer** until saved/resizable dashboards are a confirmed product requirement. |
| Mantine | Full React component framework | MIT but overlaps existing CSS/design system | **Reject for current app**; avoid a second design system. |
| Impeccable | Design QA skill | Apache-2.0 | **Use as design-review reference**, not runtime dependency. |
| Taste Skill | Design direction/reference skill | MIT | **Use as optional design critique**, preserving AXIVESTRA tokens. |
| UI UX Pro Max | Design intelligence skill | MIT | **Reference only**; do not let generated styles override product identity. |
| UI Skills | Skill routing/UX guidance | Exact supplied repo identity must be confirmed | **Use at most one curated router** after exact URL verification. |
| Emil Kowalski Skills | Motion engineering/accessibility guidance | MIT | **Use for motion review**, especially reduced-motion and interaction feedback. |
| Hallmark | Anti-generic UI quality gate | MIT | **Optional QA**; overlaps Impeccable/Taste/Unslop, so do not stack all. |
| Unslop | Design review skill | CC-BY-4.0 attribution | **Optional QA** with attribution if exact intended repo is confirmed. |
| VoltAgent awesome-design-md | Design system examples | MIT collection; third-party brand content remains third-party | **Reference only**, never copy another brand's identity. |
| Skiper UI | Interaction references | Supplied candidate has no confirmed licence/source provenance | **Reference only**, no source reuse until verified. |
| Animmaster Library | Animation reference catalogue | No clear licence confirmed | **Inspiration only**, no source/assets copied. |
| CopilotKit | Agent UI framework | MIT; overlaps AG-UI and bounded renderer already in app | **Defer**; do not add a competing agent UI layer. |
| A2UI | Declarative UI protocol | Apache-2.0; alternate renderer/protocol | **Defer**; keep AG-UI + bounded Zod renderer as the single current path. |
| Vercel AI Elements / Assistant UI | AI conversation UI patterns | Compare exact package versions/licences and AG-UI contract | **Reference only** unless an actual assistant conversation surface is approved. |

## 4. Non-visual inventory remains in scope

The remaining candidates are not ignored. Their separate workstreams are:

- **AI engineering / testing:** Promptfoo (priority for synthetic-data prompt regression and red-team checks); Langfuse only when production model traffic exists; LangGraph only if stateful agent orchestration is justified; gstack/Ruflo/OpenHands are developer tooling, not end-user UI.
- **Search, scraping and lead sourcing:** Crawlee + Playwright as the preferred TypeScript direction; choose one crawler service; OpenProspector/KeeLead/BlitzProspector only after provider-by-provider data rights, pricing and accuracy checks. No bulk scraping or unapproved outreach.
- **Geospatial:** one geocoder (Photon or Pelias), OSMnx for network analysis; preserve OSM attribution/ODbL obligations.
- **Property intelligence:** OpenComps as schema reference only; asking-price datasets are not closed-sale comparables; OpenAVMKit requires commercial licensing/copoly-left review and India validation.
- **Data / knowledge:** keep Supabase + Dexie; PowerSync is a measured alternative, not a second sync engine. AGPL products (AppFlowy, Khoj, OpenGTM, OpenEnrich, SearXNG) are not embedded in the proprietary core without legal review.
- **Financial / compliance data:** OpenBB is a connector framework, not a free licence to underlying feeds; OpenSanctions code and bulk dataset have different licences (bulk data is non-commercial unless separately licensed).
- **Workflow / developer infrastructure:** defer Temporal, Nx, Turborepo, Rush and Backstage until a demonstrated scale requirement. Keep Playwright; consider Vitest only as a deliberate test-runner migration. Prefer Dependabot over AGPL Renovate unless a feature gap is proven.
- **Commercial services:** Apify, Apollo, Treg, YouMind and PromptHero remain external products with their own terms/costs. No paid service or account automation is assumed.

## 5. Ordered implementation sequence

1. **Visual audit + theme consistency:** inspect existing theme and component scopes; resolve dark/light contradictions without changing business behaviour.
2. **Command-centre refinement:** improve orbital hub hierarchy, node legibility, focus states, pause/reduced-motion controls, and mobile grid fallback. Preserve all 16 routes.
3. **Dashboard and analytics:** tighten KPI hierarchy, chart legends, empty states, responsive sizing and data provenance labels. Continue to distinguish recorded exposure from verified NAV/valuation.
4. **Relationship intelligence:** improve graph readability, search/filter and list fallback; only draw links from explicit saved IDs.
5. **Data tables and forms:** standardize row density, sticky headers, filters, validation feedback and mobile overflow using existing TanStack/RHF/Zod stack.
6. **Visual regression:** extend existing Node tests and Playwright coverage for 320px, 720px and desktop; test keyboard focus, reduced motion, contrast and no horizontal overflow.
7. **Candidate reuse:** adapt only selected MIT/Apache-2.0 snippets after per-component provenance, licence, React 18 and dependency checks.

## 6. Explicit non-goals

- No new visual framework or wholesale component-library install.
- No React 19/Vite 7/Tailwind 4 migration in this visual pass.
- No new 3D runtime until a specific feature proves it is needed.
- No business logic, schema, permission, storage, sync or navigation changes.
- No merge to `main`, deployment, public release or paid service activation.
