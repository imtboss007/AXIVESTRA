/**
 * Curated AXIVESTRA API research catalogue sourced from public-apis/public-apis.
 * The upstream repository is an MIT-licensed directory; each API's service,
 * dataset, terms, licence, eligibility and data rights remain independently reviewable.
 * Snapshot: 2026-11-25. Upstream README blob: dfaa4c5092c918fcb64558b34c0d4c29156d07c0.
 */
export const PUBLIC_API_CATALOGUE_SOURCE = Object.freeze({
  name: "public-apis/public-apis",
  repositoryUrl: "https://github.com/public-apis/public-apis",
  readmeUrl: "https://github.com/public-apis/public-apis/blob/master/README.md",
  contributingUrl: "https://github.com/public-apis/public-apis/blob/master/CONTRIBUTING.md",
  license: "MIT",
  upstreamReadmeBlobSha: "dfaa4c5092c918fcb64558b34c0d4c29156d07c0",
  snapshotDate: "2026-11-25",
  useBoundary: "Directory metadata only. No API is enabled, fetched, or approved by importing this catalogue."
});

export const PUBLIC_API_CANDIDATES = Object.freeze([
  {
    id: "ogd-india",
    name: "Open Government Data — India",
    category: "Open Data",
    providerUrl: "https://www.data.gov.in/",
    docsUrl: "https://www.data.gov.in/apis",
    sourceType: "official_government_catalogue",
    jurisdiction: "IN",
    authAsListed: "apiKey",
    httpsAsListed: true,
    corsAsListed: "Unknown",
    modeFit: ["LENDER", "CUSTOMER"],
    workspaceFit: ["property_sale", "agricultural_land", "commercial_land", "startup", "equity", "unsecured_company_loan", "fund_portfolio_management", "investor_relations", "compliance_kyc"],
    relevance: "Search official Indian government datasets and dataset-level APIs for company, economic, agriculture and public-sector evidence. A dataset must be selected individually.",
    guardrails: [
      "The portal requires a registered account to generate an API key; keep that key server-side.",
      "Every resource has its own publisher, fields, access method, freshness and permitted-use metadata; review each resource before registering its exact endpoint.",
      "The portal states that published content is owned by the respective Ministry/State/Department/Organisation and licensed under GODL-India; confirm the selected resource's own terms and access class.",
      "Dataset facts are not proof of property title, lender licence, borrower eligibility or investor suitability."
    ],
    reviewState: "catalogue_only",
    evidence: "public-apis Government entry; official data.gov.in Help and API catalogue"
  },
  {
    id: "mca-company-master",
    name: "MCA Company Master Data",
    category: "Business",
    providerUrl: "https://www.data.gov.in/catalog/company-master-data",
    docsUrl: "https://www.data.gov.in/apis",
    termsUrl: "https://www.data.gov.in/help",
    sourceType: "official_government_dataset_api",
    jurisdiction: "IN",
    authAsListed: "apiKey",
    httpsAsListed: true,
    corsAsListed: "Unknown",
    modeFit: ["LENDER", "CUSTOMER"],
    workspaceFit: [
      "property_sale", "property_loans", "jv_jda_jd", "commercial_land",
      "startup", "equity", "unsecured_company_loan", "housing_loan",
      "house_purchase", "compliance_kyc"
    ],
    relevance: "MCA-published company master dataset for legal-entity research: CIN, company name/status/class/category, authorised and paid-up capital, registration date, registered state/ROC, principal business activity and registered office address.",
    guardrails: [
      "The official catalogue lists the dataset as published by the Ministry of Corporate Affairs and updated on 13 October 2026; recheck the current dataset page and resource metadata before each registration.",
      "The resource's exact API resource ID and current field schema must be selected from the official catalogue; do not guess or hardcode a resource ID from a third-party sample.",
      "Store the API key only as a server-side secret. Registered portal access is required to generate a key.",
      "Company registration and capital fields do not establish current lender authorisation, RBI/NHB licence, current solvency, active lending product or credit eligibility.",
      "Treat registered-office address and company-status records as source-stamped registry observations; not proof of property ownership, current operations or beneficial ownership."
    ],
    reviewState: "catalogue_only",
    evidence: "official data.gov.in Company Master Data catalogue; Ministry of Corporate Affairs; public-apis Open Data directory"
  },
  {
    id: "api-setu",
    name: "API Setu — Government API Marketplace",
    category: "Open Data",
    providerUrl: "https://www.apisetu.gov.in/",
    docsUrl: "https://www.apisetu.gov.in/sop",
    termsUrl: "https://docs.apisetu.gov.in/document-central/terms-of-use/",
    sourceType: "official_government_api_gateway",
    jurisdiction: "IN",
    authAsListed: "No",
    httpsAsListed: true,
    corsAsListed: "Yes",
    modeFit: ["LENDER", "CUSTOMER"],
    workspaceFit: ["property_sale", "property_loans", "jv_jda_jd", "agricultural_land", "commercial_land", "startup", "equity", "unsecured_company_loan", "personal_loan", "housing_loan", "house_purchase", "litigation", "fund_portfolio_management", "investor_relations", "compliance_kyc"],
    relevance: "Discover government and participating-organisation APIs that may support authorised company, identity, property or public-service workflows.",
    guardrails: [
      "The directory's Auth=No flag does not mean the underlying API is anonymous or unrestricted.",
      "Consumer onboarding, a valid organisational use case, API subscription, publisher approval and API-specific credentials may be required.",
      "Use only APIs approved for AXIVESTRA's own organisation and exact purpose; sensitive personal data requires the relevant consent and legal controls.",
      "Do not treat API Setu as a general prospecting feed or bypass its gateway."
    ],
    reviewState: "approval_required",
    evidence: "public-apis Open Data entry; official API Setu SOP and Terms of Use"
  },
  {
    id: "india-mandi-prices",
    name: "Indian Mandi Prices API",
    category: "Government",
    providerUrl: "https://mandi-api.vercel.app/docs",
    docsUrl: "https://mandi-api.vercel.app/docs",
    sourceType: "third_party_wrapper_of_government_data",
    jurisdiction: "IN",
    authAsListed: "No",
    httpsAsListed: true,
    corsAsListed: "Yes",
    modeFit: ["CUSTOMER"],
    workspaceFit: ["agricultural_land"],
    relevance: "Potential reference for daily wholesale mandi price context; the public-apis entry says coverage is limited to five Indian states and is sourced from data.gov.in.",
    guardrails: [
      "Third-party wrapper, not the Government of India endpoint. Prefer the exact data.gov.in resource/API after reviewing its publisher, current resource ID, fields and licence.",
      "Market prices are contextual signals only; they are not parcel valuation, sale-price evidence, land classification or title evidence.",
      "Validate date, state/market coverage and field meanings before use."
    ],
    reviewState: "research_only",
    evidence: "public-apis Government entry; official data.gov.in mandi catalogue"
  },
  {
    id: "india-lgd-index",
    name: "India LGD Index API",
    category: "Government",
    providerUrl: "https://india-lgd-index-api.vercel.app/docs",
    docsUrl: "https://india-lgd-index-api.vercel.app/docs",
    sourceType: "third_party_geography_wrapper",
    jurisdiction: "IN",
    authAsListed: "No",
    httpsAsListed: true,
    corsAsListed: "Yes",
    modeFit: ["LENDER", "CUSTOMER"],
    workspaceFit: ["property_sale", "agricultural_land", "commercial_land", "property_loans", "jv_jda_jd", "housing_loan", "house_purchase", "startup", "unsecured_company_loan"],
    relevance: "Potential location normalisation for Indian state, district, sub-district and development-block codes.",
    guardrails: [
      "Third-party wrapper. Verify values and code validity against the authoritative Local Government Directory before relying on them.",
      "Geographic codes do not establish plot boundaries, land use, title, possession, zoning or encumbrances."
    ],
    reviewState: "research_only",
    evidence: "public-apis Government entry"
  },
  {
    id: "india-pincode",
    name: "Indian Pincode API",
    category: "Government",
    providerUrl: "https://indianpincode.com/",
    docsUrl: "https://indianpincode.com/",
    sourceType: "third_party_geography_service",
    jurisdiction: "IN",
    authAsListed: "No",
    httpsAsListed: true,
    corsAsListed: "Yes",
    modeFit: ["LENDER", "CUSTOMER"],
    workspaceFit: ["property_sale", "agricultural_land", "commercial_land", "property_loans", "jv_jda_jd", "housing_loan", "house_purchase", "startup", "unsecured_company_loan", "fund_portfolio_management"],
    relevance: "Potential PIN-code and postal-office lookup for broad location normalisation.",
    guardrails: [
      "Third-party service, not an authoritative proof of address or property location.",
      "Cross-check material address facts with an official postal or government source; do not infer ownership or property identity."
    ],
    reviewState: "research_only",
    evidence: "public-apis Government entry"
  },
  {
    id: "ecourts-india",
    name: "eCourtsIndia API",
    category: "Government",
    providerUrl: "https://ecourtsindia.com/api",
    docsUrl: "https://ecourtsindia.com/api",
    sourceType: "third_party_court_data_api",
    jurisdiction: "IN",
    authAsListed: "apiKey",
    httpsAsListed: true,
    corsAsListed: "Yes",
    modeFit: ["CUSTOMER"],
    workspaceFit: ["litigation"],
    relevance: "Potential research lead for court-case reference data when the user has already supplied a matter or a lawful public-record purpose.",
    guardrails: [
      "Third-party domain; do not classify it as the official eCourts system or treat its data as authoritative without verifying its provenance and terms.",
      "Litigation discovery remains user-supplied/official-record led; never use case records as a cold-marketing trigger.",
      "Do not collect sensitive allegations or personal-party profiles. No legal conclusions or automated filings."
    ],
    reviewState: "legal_review_required",
    evidence: "public-apis Government entry"
  },
  {
    id: "indian-mutual-fund",
    name: "Indian Mutual Fund API (MFAPI)",
    category: "Finance",
    providerUrl: "https://www.mfapi.in/",
    docsUrl: "https://www.mfapi.in/",
    sourceType: "third_party_financial_data_api",
    jurisdiction: "IN",
    authAsListed: "No",
    httpsAsListed: true,
    corsAsListed: "Unknown",
    modeFit: ["CUSTOMER"],
    workspaceFit: ["fund_portfolio_management", "investor_relations"],
    relevance: "Historical Indian mutual-fund scheme/NAV reference data; it is product/market data, not an investor or LP directory.",
    guardrails: [
      "Verify API terms, data freshness and scheme coverage before use; distinguish provider data from official AMC/AMFI evidence.",
      "NAV history is not a recommendation, performance forecast, investor suitability assessment or portfolio ownership record."
    ],
    reviewState: "research_only",
    evidence: "public-apis Finance entry"
  },
  {
    id: "razorpay-ifsc",
    name: "Razorpay IFSC API",
    category: "Finance",
    providerUrl: "https://razorpay.com/docs/",
    docsUrl: "https://razorpay.com/docs/",
    sourceType: "third_party_bank_reference_api",
    jurisdiction: "IN",
    authAsListed: "No",
    httpsAsListed: true,
    corsAsListed: "Unknown",
    modeFit: ["LENDER"],
    workspaceFit: ["property_loans", "unsecured_company_loan", "personal_loan", "housing_loan", "fund_portfolio_management"],
    relevance: "Potential bank/branch IFSC reference only; it does not discover lender products, loan criteria, regulatory status or finance contacts.",
    guardrails: [
      "Verify endpoint availability, current terms and data source before integration; do not infer licensing or lender capability from an IFSC match.",
      "Keep the RBI bank and NBFC registers as the authority for institution identity and regulatory status."
    ],
    reviewState: "research_only",
    evidence: "public-apis Finance entry"
  },
  {
    id: "gstinapi",
    name: "GSTINAPI",
    category: "Business",
    providerUrl: "https://www.gstinapi.in/docs",
    docsUrl: "https://www.gstinapi.in/docs",
    sourceType: "third_party_business_verification_api",
    jurisdiction: "IN",
    authAsListed: "apiKey",
    httpsAsListed: true,
    corsAsListed: "No",
    modeFit: ["CUSTOMER"],
    workspaceFit: ["unsecured_company_loan", "startup", "compliance_kyc"],
    relevance: "Possible GSTIN verification provider candidate; public-apis says the service offers a free tier.",
    guardrails: [
      "Private provider, not GSTN/Government of India. Independently verify terms, data provenance, contract, security, retention and current free-tier limits.",
      "No bulk enrichment, personal data collection or KYC clearance until lawfully authorised and human-reviewed."
    ],
    reviewState: "legal_and_provider_review_required",
    evidence: "public-apis Business entry"
  }
  {
    id: "searchpincode-in",
    name: "SearchPinCode — India Postal Lookup",
    category: "Geocoding",
    providerUrl: "https://searchpincode.in/api",
    docsUrl: "https://searchpincode.in/api",
    sourceType: "third_party_postal_reference_api",
    jurisdiction: "IN",
    authAsListed: "No",
    httpsAsListed: true,
    corsAsListed: "Yes",
    modeFit: ["LENDER", "CUSTOMER"],
    workspaceFit: ["property_sale", "agricultural_land", "commercial_land", "property_loans", "jv_jda_jd", "housing_loan", "house_purchase", "unsecured_company_loan", "startup", "fund_portfolio_management"],
    relevance: "Potential Indian PIN-code, post-office and district reference for location normalisation across lender and customer workspaces.",
    guardrails: [
      "Third-party lookup service, not an India Post source or official proof of address.",
      "Verify provider terms, data provenance, freshness, coverage, quotas and permitted reuse before registration.",
      "A PIN-code match does not prove parcel location, property title, possession, zoning or borrower eligibility."
    ],
    reviewState: "research_only",
    evidence: "public-apis Geocoding entry"
  },
  {
    id: "sec-edgar-data",
    name: "SEC EDGAR Data",
    category: "Finance",
    providerUrl: "https://www.sec.gov/edgar/sec-api-documentation",
    docsUrl: "https://www.sec.gov/edgar/sec-api-documentation",
    sourceType: "official_regulatory_financial_api",
    jurisdiction: "US",
    authAsListed: "No",
    httpsAsListed: true,
    corsAsListed: "Yes",
    modeFit: ["LENDER", "CUSTOMER"],
    workspaceFit: ["equity", "startup", "unsecured_company_loan", "fund_portfolio_management", "investor_relations", "compliance_kyc"],
    relevance: "Official SEC submissions and XBRL company-facts data for US public reporting issuers; a source for filings and disclosed company facts, not a global private-company or lender directory.",
    guardrails: [
      "Send a descriptive User-Agent with a monitored contact address and respect SEC fair-access guidance; keep requests within the published rate limit.",
      "Use issuer CIK and exact SEC endpoints; preserve filing accession, form type, filing date, period and source URL.",
      "SEC filing data does not prove current lending authorisation, private-company solvency, property title, borrower eligibility or the completeness of an issuer's disclosures.",
      "US public-issuer coverage only; do not infer that missing records mean an entity does not exist."
    ],
    reviewState: "approval_required",
    evidence: "public-apis Finance entry; official SEC EDGAR API documentation and fair-access policy"
  },
  {
    id: "opencorporates",
    name: "OpenCorporates",
    category: "Open Data",
    providerUrl: "https://opencorporates.com/",
    docsUrl: "https://api.opencorporates.com/documentation/API-Reference",
    sourceType: "licensed_company_registry_aggregator",
    jurisdiction: "GLOBAL",
    authAsListed: "apiKey",
    httpsAsListed: true,
    corsAsListed: "Unknown",
    modeFit: ["LENDER", "CUSTOMER"],
    workspaceFit: ["property_sale", "agricultural_land", "commercial_land", "jv_jda_jd", "property_loans", "unsecured_company_loan", "housing_loan", "house_purchase", "startup", "equity", "fund_portfolio_management", "investor_relations", "compliance_kyc"],
    relevance: "Cross-jurisdiction company-register search and corporate identity enrichment where supported by the underlying national register.",
    guardrails: [
      "Commercial use in a proprietary application requires a suitable paid API/data licence; directory inclusion or an API key does not grant reuse rights.",
      "Coverage, source date, field availability and licence differ by jurisdiction and underlying register; keep each observation source-stamped.",
      "Do not treat an aggregated director/officer result as current beneficial ownership, a lender licence or proof of operating status."
    ],
    reviewState: "legal_and_provider_review_required",
    evidence: "public-apis Open Data entry; OpenCorporates API reference and commercial-use terms"
  },
  {
    id: "opensanctions",
    name: "OpenSanctions — Sanctions and PEP Screening",
    category: "Open Data",
    providerUrl: "https://www.opensanctions.org/",
    docsUrl: "https://www.opensanctions.org/docs/api/",
    sourceType: "third_party_screening_data_api",
    jurisdiction: "GLOBAL",
    authAsListed: "No",
    httpsAsListed: true,
    corsAsListed: "Yes",
    modeFit: ["CUSTOMER"],
    workspaceFit: ["compliance_kyc"],
    relevance: "Potential sanctions and politically-exposed-person screening reference for the Compliance & KYC review workflow only; not a prospecting or lead-generation source.",
    guardrails: [
      "The public-apis Auth label is directory metadata, not confirmation of anonymous production access; hosted API access and commercial licensing must be checked with OpenSanctions.",
      "Business/commercial use requires the appropriate current API key and data licence; do not assume the non-commercial or research allowance applies to AXIVESTRA.",
      "A fuzzy match is a review candidate, never a confirmed sanctions hit or legal conclusion; retain list version, match rationale, reviewer and false-positive disposition.",
      "Do not use screening records as a cold-marketing trigger or automatically reject, block or score a person."
    ],
    reviewState: "legal_and_provider_review_required",
    evidence: "public-apis Open Data entry; official OpenSanctions API documentation and licensing terms"
  },
]);

export function findPublicApiCandidates({ query = "", workspaceKey = "", mode = "" } = {}) {
  const term = String(query || "").trim().toLowerCase();
  const selectedMode = String(mode || "").toUpperCase();
  return PUBLIC_API_CANDIDATES.filter(candidate => {
    if (workspaceKey && !candidate.workspaceFit.includes(workspaceKey)) return false;
    if (selectedMode && !candidate.modeFit.includes(selectedMode)) return false;
    if (!term) return true;
    const haystack = [
      candidate.name, candidate.category, candidate.relevance, candidate.providerUrl,
      candidate.sourceType, ...candidate.guardrails, ...candidate.workspaceFit
    ].join(" ").toLowerCase();
    return haystack.includes(term);
  });
}
