# AXIVESTRA public API research catalogue

**Upstream directory:** [public-apis/public-apis](https://github.com/public-apis/public-apis)  
**Directory code/content licence:** MIT  
**Snapshot:** 25 November 2026  
**Upstream README blob:** `dfaa4c5092c918fcb64558b34c0d4c29156d07c0`

## Purpose

This catalogue is a research index for the existing E01–E20 LENDER/CUSTOMER discovery platform. It does not replace E02 source governance, E03 search, E04 bounded fetch, E05 extraction, E06–E10 entity/contact/geo/enrichment stages, E11 matching, E13 provenance or E15 review.

The repository is a directory of API listings, not a universal data licence, service-level guarantee, verified global company/lender database or API endpoint. The public-apis MIT licence applies to the directory repository's code/content. Each listed provider, endpoint, dataset, API contract and data field has its own access and reuse conditions.

## Selected India-relevant candidates

| Candidate | Intended workspace use | AXIVESTRA classification | Initial review state |
|---|---|---|---|
| Open Government Data — India (`data.gov.in`) | Official government datasets for relevant property, agriculture, business and economic context | Government catalogue/API platform; per-resource review required | Catalogue only |
| MCA Company Master Data (`data.gov.in/catalog/company-master-data`) | Company legal-entity research for borrowers, developers, issuers and counterparties | Ministry of Corporate Affairs dataset; exact API resource ID/schema must be selected from the official page | Catalogue only |
| API Setu | Explore government/participating-organisation APIs for approved identity/business workflows | Controlled gateway; onboarding, publisher and API-specific approval required | Approval required |
| Indian Mandi Prices API | Agricultural commodity-price context | Third-party wrapper over public-data context; prefer the matching official dataset | Research only |
| India LGD Index API | State/district/sub-district/block code normalisation | Third-party geography wrapper; verify against authoritative LGD source | Research only |
| Indian Pincode API | Broad postal-location normalisation | Third-party geography service; not address or ownership proof | Research only |
| eCourtsIndia API | User-supplied matter or permitted public case-reference research | Third-party court-data API; never use as cold-marketing signal | Legal review required |
| Indian Mutual Fund API (MFAPI) | Historical scheme/NAV context for fund workflows | Third-party financial-data API; not investor/LP discovery | Research only |
| Razorpay IFSC API | Bank/branch reference data | Third-party reference API; not lender product or licence verification | Research only |
| GSTINAPI | Possible GSTIN verification for company onboarding | Third-party verification provider; provider/privacy/security review required | Legal and provider review required |

The list in `src/lib/public-api-catalog.mjs` is scoped to the existing 16 workspace keys and LENDER/CUSTOMER modes. It records the directory's authentication, HTTPS and CORS labels as supplied; those labels are metadata, not a promise that AXIVESTRA can call the API anonymously.

## Important source findings

- **data.gov.in:** official portal documentation says registered users can generate API keys. Individual dataset pages identify the publisher, licence and resource details. Register and approve a specific dataset/resource, not the whole portal as an unrestricted crawler target. The portal's government-owned resources may use GODL-India, but the individual resource metadata and restrictions still need review.
- **MCA Company Master Data:** the official catalogue identifies the Ministry of Corporate Affairs as publisher and describes company CIN, name/status, class/category, authorised/paid-up capital, registration date, state/ROC and principal business activity fields. The catalogue showed an update date of 13 October 2026 at the time of review. It supports entity research only; it does not establish current NBFC/HFC/bank licence status, active lending products, solvency, property title or borrower credit eligibility. Select the exact API resource ID and field schema from the official page; do not use a guessed resource ID.
- **API Setu:** its official process is an approval-based gateway. A public directory row that says `Auth=No` does not override API Setu onboarding, organisation/use-case validation, subscription, publisher approval or API-specific credentials.
- **Mandi prices:** a market-price series is contextual evidence. It is not land valuation, sale transaction evidence, title proof or proof of land classification. Prefer the corresponding government-published dataset when available.
- **India LGD and PIN-code services:** these can help normalise geography. They do not establish parcel identity, title, possession, zoning, encumbrances or address authority.
- **eCourtsIndia:** the listed service is a third-party domain. It is not to be presented as the official eCourts system without independent source verification. Litigation workspace rules remain strict: user-supplied matters or lawful official public records only, no sensitive allegations harvesting and no cold marketing.
- **MFAPI and Razorpay IFSC:** these are reference-data candidates only. Do not use NAV or IFSC results to imply investor eligibility, suitability, lender licence, loan products or lending authority.
- **GSTINAPI:** this is a private provider, not GSTN/Government of India. Check contract, current service terms, access method, lawful purpose, security, retention and current pricing/free-tier limits.

## Required adapter acceptance before use

Every selected API resource must be individually reviewed and registered through the existing company-scoped E02 source registry. At minimum record:

1. Exact provider and endpoint/resource URL; no wildcard host or guessed endpoint.
2. Provider terms, dataset licence, commercial reuse rights, attribution, jurisdiction and legal basis.
3. Authentication and approval requirements; credentials must stay server-side.
4. Exact allowed fields, extraction schema, personal-data minimisation and purpose.
5. Rate limits, quotas, retention, caching, freshness and deletion/correction path.
6. Evidence provenance: source URL, source publication/update date where available, retrieval time, jurisdiction, data hash and reviewer.
7. Field accuracy and source-health tests. Conflicting values remain separately attributed.

No candidate is automatically approved or attached to a profile. No credentials, API requests, workers, outbound communication, production database migrations or deployment are enabled by this catalogue.

## Fit with existing AXIVESTRA architecture

- **E01:** plan bounded workspace-specific discovery requests.
- **E02:** owner/admin review of each exact API/source and field scope.
- **E03:** query approved source catalogues/search providers; the current SearXNG integration remains off unless configured.
- **E04:** fetch only explicitly selected, approved URLs/resources through the existing governed worker.
- **E05:** parse immutable E04 evidence deterministically; optional Scrapling remains a parser-only backend over captured evidence, not a second network crawler.
- **E06–E10:** entity, role, contact, geography and enrichment facts remain evidence-backed and source-specific.
- **E11–E15:** scoring, review, verification, lead conversion, privacy, suppression and audit remain human-governed.
- **E20:** dispatch remains disabled; catalogue entries do not register adapters or create executable jobs.

## Upstream references

- [Public APIs repository](https://github.com/public-apis/public-apis)
- [Public APIs contributing rules](https://github.com/public-apis/public-apis/blob/master/CONTRIBUTING.md)
- [Open Government Data India](https://www.data.gov.in/)
- [MCA Company Master Data catalogue](https://www.data.gov.in/catalog/company-master-data)
- [India Government API Setu](https://www.apisetu.gov.in/)
- [eCourtsIndia listed API](https://ecourtsindia.com/api)
- [MFAPI](https://www.mfapi.in/)
