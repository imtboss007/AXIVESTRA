# AXIVESTRA — Authoritative 123-Entry Technology Inventory Reconciliation

**Date:** 25 November 2026  
**Scope:** Reconcile the user's authoritative 123-entry inventory (categories A–J) with the earlier 111-row audit workbook.  
**Decision rule:** Preserve existing work; integrate only genuinely missing, compatible capabilities. Do not duplicate existing stack capabilities. Restricted, paid, unlicensed, or unrelated tools require separate approval.

## 1. Inventory reconciliation

The authoritative inventory contains 123 numbered entries across categories A–J:

| Category | Entries | Count |
|---|---:|---:|
| A — UI design, components and design intelligence | 1–36 | 36 |
| B — Lead generation, business intelligence and company discovery | 37–75 | 39 |
| C — Knowledge management and AI workspaces | 76–84 | 9 |
| D — Crawling, data acquisition and automation | 85–90 | 6 |
| E — Engineering infrastructure and agent orchestration | 91–104 | 14 |
| F — External intelligence and repository engineering tools | 105–112 | 8 |
| G — Additional AI and research tools | 113–115 | 3 |
| H — Visualisation and graph intelligence | 116–118 | 3 |
| I — Frontend engineering and build systems | 119–120 | 2 |
| J — 3D / Blender / reconstruction tools | 121–123 | 3 |
| **Total** | **1–123** | **123** |

The earlier audit workbook recorded 104 repository/tool rows plus 7 service rows (111 rows). It counted Scout in both the repository and service sections. Reconciliation against the authoritative list therefore yields **110 distinct inventory entries represented and 13 entries not previously recorded**. The earlier workbook's “111 unique entries” label should not be treated as a verified unique count.

## 2. The 13 previously unrecorded entries

| Original # | Entry | Current finding | AXIVESTRA decision |
|---:|---|---|---|
| 108 | OpenHands Agent Canvas | The old `OpenHands/agent-canvas` repository is archived; Agent Canvas moved into `OpenHands/OpenHands`. Current package is MIT, but its current Node/React stack is not a drop-in for AXIVESTRA's React 18 application. | Optional isolated developer tool only; no runtime integration. |
| 109 | GitHub Repo Auditor | `saagpatel/GithubRepoAuditor`, MIT. A standalone GitHub portfolio auditor with analyzers, scoring and workbook/dashboard output. | Optional read-only portfolio audit tool; do not embed in AXIVESTRA. |
| 110 | Repository Trust Doctor | `Wezylnia/repo-trust-doctor`, Apache-2.0. Local-first static repository trust/security/maintainability scanner; documented as not executing repository code by default. | Optional separate audit tool; no runtime dependency. |
| 111 | RepoSwarm | `reposwarm/reposwarm`, Apache-2.0. Requires Docker and a stack including Temporal, API/worker/UI, storage and an LLM provider. | Do not integrate; duplicates orchestration and infrastructure already present or deliberately gated. |
| 112 | OpenHands Cloud Individual | Official OpenHands Individual plan is listed as free with BYOK or provider usage at cost. It is a hosted developer service, not an AXIVESTRA library. | Optional user-controlled developer tool only; no account, model spend or service activation. |
| 116 | D3.js | ISC-licensed visualisation library. | Defer; ECharts is already integrated and covers current chart/graph needs. |
| 117 | Cytoscape.js | MIT-licensed graph/network visualisation and analysis library. | Defer; ECharts relationship graph is already implemented. Reconsider only if a measured graph-layout/analysis gap appears. |
| 118 | Three.js | MIT-licensed 3D rendering library. | Not relevant to current lender/customer intelligence runtime. Keep as a separate 3D reference. |
| 119 | Biome | Biome project offers MIT and Apache-2.0 licensing. It is a formatter/linter toolchain. | Defer; avoid adding another lint/format stack without a measured gap. |
| 120 | esbuild | MIT-licensed JavaScript bundler. | Retain through the existing Vite/build dependency chain; do not add a duplicate direct build system. |
| 121 | MCP for Blender | `ahujasid/mcp-for-blender`, MIT. Powerful Blender control includes arbitrary Python execution; remote mode has no authentication/encryption and is documented for trusted networks only. | Optional local 3D/manufacturing workflow only; never expose its remote listener publicly. |
| 122 | TRELLIS.2 | `microsoft/TRELLIS.2`, MIT for the project code/model; some dependencies have separate licences. A 4B-parameter 3D generation model with substantial GPU requirements. | Separate 3D R&D only; not an AXIVESTRA dependency. |
| 123 | Nerfstudio | `nerfstudio-project/nerfstudio`, Apache-2.0; NeRF/3D reconstruction and Gaussian-splatting workflow. | Separate 3D reconstruction R&D only; not an AXIVESTRA dependency. |

## 3. Consolidated adoption decision

1. Keep the current AXIVESTRA application stack and existing ECharts relationship visual. Do not add D3, Cytoscape or Three.js as duplicate UI dependencies.
2. Keep the existing React 18, Vite, Supabase, Dexie, AG-UI, TanStack Table/Virtual, React Hook Form and Zod foundation. Do not introduce another app framework, database, sync layer or orchestrator without a demonstrated requirement.
3. Keep RepoSwarm, OpenHands, GitHub Repo Auditor and Repository Trust Doctor outside the AXIVESTRA production runtime. They are developer/repository-analysis tools, not lender/customer data providers.
4. Keep Blender MCP, TRELLIS.2 and Nerfstudio outside AXIVESTRA. They belong to a separate 3D/manufacturing workflow and must not add model/GPU costs to the lender/customer product.
5. No third-party repository was cloned, installed, executed, copied, merged or deployed by this reconciliation.

## 4. Existing architecture is not a live provider

AXIVESTRA's shared E01–E22 discovery architecture remains the selected direction. The data.gov.in bridge is a gated code adapter; it is not a live data source until an exact dataset/resource, server-side API key, approved source registration and owner-authorised activation exist. SearXNG search also remains dependent on a configured, permitted endpoint. Do not enable E20 dispatch, external provider calls, live outreach, production migrations or deployment as part of this inventory update.

## 5. Primary references

- OpenHands Agent Canvas: https://github.com/OpenHands/OpenHands
- GitHub Repo Auditor: https://github.com/saagpatel/GithubRepoAuditor
- Repository Trust Doctor: https://github.com/Wezylnia/repo-trust-doctor
- RepoSwarm: https://github.com/reposwarm/reposwarm
- D3.js: https://github.com/d3/d3
- Cytoscape.js: https://github.com/cytoscape/cytoscape.js
- Three.js: https://github.com/mrdoob/three.js
- Biome: https://github.com/biomejs/biome
- esbuild: https://github.com/evanw/esbuild
- MCP for Blender: https://github.com/ahujasid/mcp-for-blender
- TRELLIS.2: https://github.com/microsoft/TRELLIS.2
- Nerfstudio: https://github.com/nerfstudio-project/nerfstudio
- OpenHands pricing: https://www.openhands.dev/pricing/

## 6. Release boundary

This is an inventory and architecture decision record only. It does not approve third-party adoption, provider activation, new paid services, branch merging, production migrations, production deployment or public release.
