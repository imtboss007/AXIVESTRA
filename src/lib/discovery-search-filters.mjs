export const INDIA_STATES_AND_UTS = Object.freeze([
  "Andaman and Nicobar Islands",
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chandigarh",
  "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jammu and Kashmir",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Ladakh",
  "Lakshadweep",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Puducherry",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal"
]);

const text = (key, label, placeholder = "") => ({ key, label, type: "text", placeholder });
const number = (key, label, placeholder = "") => ({ key, label, type: "number", placeholder, min: 0 });
const select = (key, label, options) => ({ key, label, type: "select", options });

const CATALOG = {
  property_sale: {
    LENDER: [
      select("finance_product", "Finance product", ["Loan against property", "Purchase finance", "Bridge finance", "Construction finance", "Development finance"]),
      select("asset_type", "Eligible property type", ["Residential", "Commercial", "Industrial", "Agricultural", "Mixed-use"]),
      number("ticket_min", "Minimum ticket size"), number("ticket_max", "Maximum ticket size"),
      number("ltv_max", "Maximum published LTV (%)")
    ],
    CUSTOMER: [
      select("asset_type", "Property type", ["Residential", "Commercial", "Industrial", "Agricultural", "Mixed-use"]),
      select("transaction_type", "Transaction requirement", ["Sale", "Purchase", "Joint venture", "Development mandate", "Investment"]),
      number("property_value_min", "Minimum property value"), number("property_value_max", "Maximum property value"),
      number("area_min", "Minimum area (sq ft)"), number("area_max", "Maximum area (sq ft)"),
      select("mandate_type", "Mandate", ["Owner sale", "Buyer mandate", "Developer mandate", "Investor mandate"])
    ]
  },
  property_loans: {
    LENDER: [
      select("loan_product", "Loan product", ["Loan against property", "Mortgage loan", "Construction loan", "Project finance", "Bridge loan", "Refinance"]),
      select("collateral_type", "Collateral type", ["Residential property", "Commercial property", "Industrial property", "Land", "Mixed collateral"]),
      number("ticket_min", "Minimum loan amount"), number("ticket_max", "Maximum loan amount"),
      number("ltv_max", "Maximum published LTV (%)"),
      select("borrower_category", "Eligible borrower", ["Individual", "Salaried", "Self-employed", "Business", "MSME", "Company", "Developer"]),
      select("tenure", "Published tenure", ["Up to 5 years", "5–10 years", "10–15 years", "15–20 years", "20–30 years"])
    ],
    CUSTOMER: [
      select("loan_purpose", "Loan purpose", ["Loan against property", "Purchase", "Construction", "Renovation", "Refinance", "Project finance", "Working capital"]),
      select("collateral_type", "Available collateral", ["Residential property", "Commercial property", "Industrial property", "Land", "No collateral / unsecured"]),
      number("loan_min", "Minimum required loan amount"), number("loan_max", "Maximum required loan amount"),
      select("property_type", "Property type", ["Residential", "Commercial", "Industrial", "Agricultural", "Mixed-use"]),
      select("borrower_category", "Borrower category", ["Individual", "Self-employed", "Business", "MSME", "Company", "Developer"]),
      select("project_stage", "Project stage", ["Planning", "Land acquired", "Under construction", "Completed", "Operating"])
    ]
  },
  jv_jda_jd: {
    LENDER: [
      select("finance_type", "Finance type", ["Construction finance", "Project finance", "Land-backed finance", "Structured finance", "Private credit"]),
      select("project_stage", "Project stage", ["Land acquisition", "Approvals", "Pre-construction", "Construction", "Completed / operating"]),
      number("ticket_min", "Minimum exposure"), number("ticket_max", "Maximum exposure"),
      select("security_type", "Security / collateral", ["Land mortgage", "Project assets", "Receivables", "Corporate guarantee", "Structured security"])
    ],
    CUSTOMER: [
      select("partnership_type", "Partnership type", ["JV", "JDA", "JD", "Development agreement", "Co-development"]),
      select("asset_type", "Land / asset type", ["Residential", "Commercial", "Industrial", "Agricultural", "Mixed-use"]),
      number("area_min", "Minimum land area (sq ft)"), number("area_max", "Maximum land area (sq ft)"),
      select("project_stage", "Project stage", ["Land available", "Planning", "Approvals", "Under development", "Operating"]),
      text("partner_capability", "Required partner capability", "e.g. funding, construction, approvals")
    ]
  },
  sr_rate_settlement: {
    LENDER: [
      select("finance_type", "Finance type", ["Bridge finance", "Secured settlement finance", "Structured credit"]),
      select("collateral_type", "Collateral", ["Property", "Receivables", "Business assets", "Other secured"]),
      number("ticket_min", "Minimum ticket size"), number("ticket_max", "Maximum ticket size"),
      select("settlement_type", "Settlement category", ["Property transaction", "Commercial settlement", "Debt settlement", "Other"])
    ],
    CUSTOMER: [
      select("settlement_type", "Settlement category", ["Property transaction", "Commercial settlement", "Debt settlement", "Other"]),
      select("asset_class", "Asset / transaction class", ["Residential property", "Commercial property", "Land", "Business", "Receivable", "Other"]),
      select("counterparty_role", "Counterparty role", ["Buyer", "Seller", "Borrower", "Creditor", "Investor", "Valuer"]),
      number("value_min", "Minimum transaction value"), number("value_max", "Maximum transaction value"),
      text("rate_basis", "Rate / valuation basis", "Optional published rate reference")
    ]
  },
  agricultural_land: {
    LENDER: [
      select("loan_product", "Finance product", ["Agriculture loan", "Land mortgage", "Equipment finance", "Warehouse receipt finance", "Agri project finance"]),
      select("borrower_category", "Eligible borrower", ["Farmer", "Agri business", "Processor", "Cooperative", "MSME", "Company"]),
      select("activity", "Eligible activity", ["Crop production", "Dairy", "Poultry", "Food processing", "Storage", "Agri infrastructure"]),
      number("ticket_min", "Minimum ticket size"), number("ticket_max", "Maximum ticket size")
    ],
    CUSTOMER: [
      select("land_use", "Land / business use", ["Cultivation", "Dairy", "Poultry", "Food processing", "Warehouse", "Agri infrastructure", "Investment"]),
      select("crop_activity", "Crop / activity", ["Field crops", "Horticulture", "Plantation", "Dairy", "Poultry", "Mixed farming", "Other"]),
      number("area_min", "Minimum land area (acres)"), number("area_max", "Maximum land area (acres)"),
      select("irrigation", "Irrigation", ["Irrigated", "Partially irrigated", "Rain-fed", "Not specified"]),
      select("transaction_intent", "Requirement", ["Purchase", "Sale", "Lease", "Finance", "Partnership"])
    ]
  },
  commercial_land: {
    LENDER: [
      select("finance_type", "Finance product", ["Commercial mortgage", "Industrial property finance", "Construction finance", "Warehouse finance", "Project finance"]),
      select("asset_use", "Asset use", ["Industrial", "Warehouse / logistics", "Office", "Retail", "Mixed-use"]),
      number("ticket_min", "Minimum ticket size"), number("ticket_max", "Maximum ticket size"),
      number("ltv_max", "Maximum published LTV (%)")
    ],
    CUSTOMER: [
      select("land_use", "Required use", ["Industrial", "Warehouse / logistics", "Office", "Retail", "Commercial", "Mixed-use"]),
      text("industry", "Industry / operating sector", "e.g. manufacturing, logistics"),
      number("area_min", "Minimum area (sq ft)"), number("area_max", "Maximum area (sq ft)"),
      select("requirement", "Requirement", ["Purchase", "Lease", "Sale", "Development", "Investment"]),
      select("infrastructure", "Infrastructure need", ["Power", "Water", "Road access", "Rail / port", "Ready industrial estate", "Any"])
    ]
  },
  startup: {
    LENDER: [
      select("funding_instrument", "Funding instrument", ["Venture debt", "Working capital", "Revenue-based finance", "Venture capital", "Private equity", "Grant"]),
      select("stage", "Funding stage", ["Pre-seed", "Seed", "Series A", "Series B", "Series C+", "Growth", "Established"]),
      text("sector", "Sector", "e.g. SaaS, manufacturing, healthtech"),
      number("ticket_min", "Minimum ticket size"), number("ticket_max", "Maximum ticket size")
    ],
    CUSTOMER: [
      text("sector", "Company sector", "e.g. SaaS, manufacturing, healthtech"),
      select("stage", "Company stage", ["Idea", "Pre-seed", "Seed", "Series A", "Series B+", "Growth", "Established"]),
      text("product_service", "Product / service", "What the company provides"),
      select("partnership_type", "Customer / partnership opportunity", ["B2B customer", "Strategic partner", "Supplier", "Distributor", "Investor portfolio"]),
      text("growth_signal", "Public growth signal", "e.g. expansion, hiring, new facility")
    ]
  },
  equity: {
    LENDER: [
      select("investor_type", "Investor type", ["Angel", "Venture capital", "Private equity", "Family office", "Equity fund"]),
      select("stage", "Investment stage", ["Pre-seed", "Seed", "Series A", "Series B", "Growth", "Pre-IPO"]),
      text("sector", "Sector mandate", "e.g. manufacturing, aerospace"),
      number("ticket_min", "Minimum investment"), number("ticket_max", "Maximum investment"),
      select("instrument", "Instrument", ["Equity", "Preference shares", "Convertible", "SAFE", "Other"])
    ],
    CUSTOMER: [
      text("sector", "Issuer sector", "Company sector"),
      select("stage", "Company stage", ["Startup", "Early growth", "Growth", "Established", "Pre-IPO"]),
      number("capital_min", "Minimum capital sought"), number("capital_max", "Maximum capital sought"),
      select("instrument", "Preferred instrument", ["Equity", "Preference shares", "Convertible", "SAFE", "Strategic investment"]),
      select("transaction_type", "Transaction", ["Primary raise", "Secondary sale", "Strategic investment", "Joint venture"])
    ]
  },
  unsecured_company_loan: {
    LENDER: [
      select("loan_product", "Loan product", ["Unsecured business loan", "Working capital", "Term loan", "Invoice finance", "Trade finance"]),
      select("borrower_segment", "Eligible company segment", ["Startup", "MSME", "SME", "Mid-market", "Large enterprise"]),
      number("ticket_min", "Minimum loan amount"), number("ticket_max", "Maximum loan amount"),
      select("tenure", "Published tenure", ["Up to 1 year", "1–3 years", "3–5 years", "5+ years"]),
      text("published_criteria", "Published eligibility criteria", "Only public provider criteria")
    ],
    CUSTOMER: [
      text("sector", "Company sector", "e.g. manufacturing, engineering"),
      select("business_type", "Business type", ["Manufacturer", "Trader", "Service provider", "Exporter", "MSME", "Startup"]),
      select("funding_purpose", "Funding purpose", ["Working capital", "Machinery", "Expansion", "Order finance", "Invoice finance", "Term loan"]),
      number("loan_min", "Minimum loan requirement"), number("loan_max", "Maximum loan requirement"),
      select("operating_period", "Operating history", ["Under 1 year", "1–3 years", "3–5 years", "5+ years"])
    ]
  },
  personal_loan: {
    LENDER: [
      select("loan_product", "Loan product", ["Personal loan", "Salary loan", "Professional loan", "Pre-approved personal loan"]),
      select("provider_type", "Provider type", ["Bank", "Licensed NBFC", "Regulated digital lending institution"]),
      number("ticket_min", "Minimum published amount"), number("ticket_max", "Maximum published amount"),
      select("tenure", "Published tenure", ["Up to 1 year", "1–3 years", "3–5 years", "5+ years"])
    ],
    CUSTOMER: [
      select("intake_type", "Enquiry source", ["User-entered", "Inbound enquiry", "Documented referral", "Explicitly consented partner"]),
      select("loan_purpose", "Customer-stated purpose", ["Medical", "Education", "Travel", "Home improvement", "Debt consolidation", "Other"]),
      number("loan_min", "Minimum requested amount"), number("loan_max", "Maximum requested amount"),
      select("consent_status", "Consent / referral status", ["Consent recorded", "Referral documented", "Inbound enquiry"])
    ]
  },
  housing_loan: {
    LENDER: [
      select("loan_variant", "Home-loan variant", ["Home purchase", "Home construction", "Plot purchase", "Plot + construction", "Balance transfer", "Top-up"]),
      select("borrower_category", "Eligible borrower", ["Salaried", "Self-employed", "Professional", "NRI", "Joint applicants"]),
      number("ticket_min", "Minimum loan amount"), number("ticket_max", "Maximum loan amount"),
      number("ltv_max", "Maximum published LTV (%)"),
      select("tenure", "Published tenure", ["Up to 5 years", "5–10 years", "10–15 years", "15–20 years", "20–30 years"]),
      select("rate_type", "Published rate type", ["Fixed", "Floating", "Fixed / floating"])
    ],
    CUSTOMER: [
      select("property_type", "Property type", ["Apartment", "Independent house", "Villa", "Plot", "Under-construction project", "Resale property"]),
      number("property_value_min", "Minimum property value"), number("property_value_max", "Maximum property value"),
      number("loan_min", "Minimum loan requirement"), number("loan_max", "Maximum loan requirement"),
      select("purchase_stage", "Purchase stage", ["Planning", "Booking", "Agreement", "Under construction", "Ready to move", "Resale"]),
      select("buyer_type", "Buyer category", ["First home", "Second home", "NRI", "Joint purchase", "Investment property"])
    ]
  },
  house_purchase: {
    LENDER: [
      select("loan_variant", "Finance product", ["Home purchase", "Resale home", "Plot purchase", "Balance transfer", "Top-up"]),
      select("property_type", "Eligible property", ["Apartment", "Independent house", "Villa", "Plot", "Resale"]),
      number("ticket_min", "Minimum ticket size"), number("ticket_max", "Maximum ticket size"),
      number("ltv_max", "Maximum published LTV (%)")
    ],
    CUSTOMER: [
      select("property_type", "Property type", ["Apartment", "Independent house", "Villa", "Plot", "Resale"]),
      number("property_value_min", "Minimum budget"), number("property_value_max", "Maximum budget"),
      select("purchase_stage", "Purchase stage", ["Searching", "Shortlisted", "Offer", "Agreement", "Registration"]),
      select("purchase_type", "Purchase type", ["New property", "Resale", "Under construction", "Plot"]),
      text("locality", "Preferred locality", "Optional locality / city")
    ]
  },
  litigation: {
    LENDER: [
      select("finance_type", "Finance category", ["Litigation finance", "Legal-cost finance", "Receivables-backed finance"]),
      select("case_category", "Permitted case category", ["Commercial", "Property", "Arbitration", "Insolvency"]),
      number("ticket_min", "Minimum facility"), number("ticket_max", "Maximum facility")
    ],
    CUSTOMER: [
      select("case_category", "Matter category", ["Commercial", "Property", "Arbitration", "Insolvency", "Contract"]),
      select("court_level", "Court / forum level", ["District", "High Court", "Supreme Court", "Tribunal", "Arbitration"]),
      select("matter_status", "Matter status", ["Filed", "Pending", "Appeal", "Award / order", "Settlement"]),
      select("party_type", "Party type", ["Company", "Institution", "Government body", "Other legal entity"])
    ]
  },
  fund_portfolio_management: {
    LENDER: [
      select("capital_strategy", "Capital strategy", ["Private credit", "Real estate debt", "Venture debt", "Private equity", "Venture capital", "Infrastructure"]),
      select("fund_stage", "Fund stage", ["Fundraising", "Active deployment", "Follow-on", "Realisation"]),
      number("ticket_min", "Minimum investment"), number("ticket_max", "Maximum investment"),
      text("sector_mandate", "Sector / asset mandate", "Published mandate only")
    ],
    CUSTOMER: [
      select("entity_type", "Entity type", ["Fund", "Fund manager", "Portfolio company", "Issuer", "Project sponsor"]),
      select("asset_class", "Asset class", ["Private credit", "Real estate", "Equity", "Infrastructure", "Venture", "Other"]),
      select("capital_need", "Capital requirement", ["Fundraising", "Portfolio finance", "Co-investment", "Exit / realisation"]),
      number("capital_min", "Minimum capital need"), number("capital_max", "Maximum capital need")
    ]
  },
  investor_relations: {
    LENDER: [
      select("investor_type", "Investor type", ["Institutional", "Family office", "Fund", "Angel", "Strategic investor"]),
      select("instrument", "Instrument", ["Equity", "Debt", "Preference shares", "Convertible", "Fund commitment"]),
      number("ticket_min", "Minimum commitment"), number("ticket_max", "Maximum commitment"),
      text("mandate", "Published investment mandate", "Sector / stage / asset focus")
    ],
    CUSTOMER: [
      select("issuer_type", "Issuer / fund type", ["Company", "Fund", "Fund manager", "Project sponsor", "Startup"]),
      select("capital_activity", "Capital activity", ["Fundraising", "Investor reporting", "Co-investment", "Strategic partnership"]),
      number("capital_min", "Minimum capital target"), number("capital_max", "Maximum capital target"),
      select("instrument", "Instrument", ["Equity", "Debt", "Preference shares", "Fund commitment", "Convertible"])
    ]
  },
  compliance_kyc: {
    LENDER: [
      select("institution_type", "Institution type", ["Bank", "NBFC", "HFC", "Fund", "Company", "Intermediary"]),
      select("review_type", "Compliance review", ["Regulatory registration", "Licence status", "Entity identity", "Sanctions screening"]),
      select("jurisdiction_type", "Jurisdiction", ["Domestic", "Cross-border", "International"])
    ],
    CUSTOMER: [
      select("entity_type", "Entity type", ["Company", "LLP", "Partnership", "Trust", "Fund", "Individual (consented intake only)"]),
      select("review_type", "Review type", ["Company identity", "Registration status", "KYC document review", "Sanctions screening"]),
      select("onboarding_stage", "Onboarding stage", ["Prospect", "Documents requested", "Under review", "Verified", "Refresh due"])
    ]
  }
};

export function getWorkspaceSearchFilterFields(workspaceKey, mode) {
  const normalizedMode = String(mode || "").toUpperCase();
  const fields = CATALOG[workspaceKey]?.[normalizedMode];
  if (!fields) throw new Error("Unknown AXIVESTRA workspace or discovery mode for search filters.");
  return fields.map(field => Object.freeze({ ...field, options: field.options ? [...field.options] : undefined }));
}

export function createDefaultDiscoverySearchFilters() {
  return {
    coverageScope: "india",
    state: "Karnataka",
    country: "",
    currency: "INR",
    fields: {}
  };
}

const CURRENCIES = new Set(["INR", "USD", "EUR", "GBP", "AED", "SGD", "CAD", "AUD"]);

function cleanValue(value, maxLength = 120) {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}

export function normalizeDiscoverySearchFilters(workspaceKey, mode, input = {}) {
  const definitions = getWorkspaceSearchFilterFields(workspaceKey, mode);
  const scope = ["state", "india", "international"].includes(input.coverageScope)
    ? input.coverageScope
    : "india";
  const state = cleanValue(input.state, 100);
  const country = cleanValue(input.country, 100);
  const currency = CURRENCIES.has(input.currency) ? input.currency : "INR";
  if (scope === "state" && !INDIA_STATES_AND_UTS.includes(state)) {
    throw new Error("Choose a valid Indian State or Union Territory for state-level search.");
  }
  if (scope !== "international" && country) {
    throw new Error("A country name can be selected only for International search.");
  }
  const location = scope === "state" ? state + ", India"
    : scope === "india" ? "India"
    : country;
  const rawFields = input.fields && typeof input.fields === "object" && !Array.isArray(input.fields) ? input.fields : {};
  const values = [];
  const cleanFields = {};
  for (const field of definitions) {
    const raw = rawFields[field.key];
    if (raw === undefined || raw === null || raw === "") continue;
    if (field.type === "select") {
      const value = cleanValue(raw, 120);
      if (!field.options.includes(value)) throw new Error("Invalid value for " + field.label + ".");
      cleanFields[field.key] = value;
      values.push(field.label + ": " + value);
    } else if (field.type === "number") {
      const value = cleanValue(String(raw), 24);
      if (!/^\d+(?:\.\d{1,3})?$/.test(value) || !Number.isFinite(Number(value)) || Number(value) < 0) {
        throw new Error(field.label + " must be a non-negative number.");
      }
      cleanFields[field.key] = value;
      values.push(field.label + ": " + value + (/(amount|ticket|budget|capital|value|facility|investment|commitment|exposure|loan)/i.test(field.label) ? " " + currency : ""));
    } else {
      const value = cleanValue(raw, 120);
      if (!value) continue;
      cleanFields[field.key] = value;
      values.push(field.label + ": " + value);
    }
  }
  const extra = cleanValue(input.keywords, 160);
  if (extra) values.push("Keywords: " + extra);
  return {
    coverageScope: scope,
    state: scope === "state" ? state : "",
    country: scope === "international" ? country : "",
    currency,
    location,
    sector: "",
    product: "",
    stage: "",
    instrument: "",
    searchTerms: values.join(" ").slice(0, 500),
    fields: cleanFields
  };
}

export const DISCOVERY_SEARCH_FILTER_WORKSPACES = Object.freeze(Object.keys(CATALOG));
