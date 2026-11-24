export const OFFICIAL_SOURCE_STARTERS = Object.freeze([
  {
    id: "rbi-bank-links",
    name: "RBI — Websites of Banks in India",
    canonicalUrl: "https://www.rbi.org.in/scripts/banklinks.aspx",
    domain: "www.rbi.org.in",
    sourceType: "permitted_public_page",
    renderMode: "http",
    jurisdiction: "IN",
    allowedPaths: ["/scripts/banklinks.aspx"],
    allowedPurposes: ["lender institution discovery", "lender institution verification"],
    allowedFields: ["institution_name", "official_website_url"],
    fieldSchema: {
      institution_name: { type: "string", aliases: ["Name of the Bank", "Bank Name"], required: true, entityKind: "organization" },
      official_website_url: { type: "url", aliases: ["Website", "Official Website", "URL"] }
    },
    attribution: "Source: Reserve Bank of India — official bank links.",
    policyNotes: "Official directory starting point. Registration is pending; administrator must review current website terms, permitted automated access, exact paths and extraction scope before approval.",
    category: "LENDER",
    description: "Official bank website directory for public-sector, private-sector and other bank categories."
  },
  {
    id: "rbi-nbfc-register",
    name: "RBI — Registered NBFCs and ARCs",
    canonicalUrl: "https://www.rbi.org.in/Scripts/BS_NBFCList.aspx",
    domain: "www.rbi.org.in",
    sourceType: "permitted_public_page",
    renderMode: "http",
    jurisdiction: "IN",
    allowedPaths: ["/Scripts/BS_NBFCList.aspx"],
    allowedPurposes: ["lender institution discovery", "lender institution verification"],
    allowedFields: ["institution_name", "registration_status", "source_as_of_date"],
    fieldSchema: {
      institution_name: { type: "string", aliases: ["Name of the NBFC", "Name of NBFC", "Company Name"], required: true, entityKind: "organization" },
      registration_status: { type: "string", aliases: ["Certificate of Registration Status", "Status"] },
      source_as_of_date: { type: "date", aliases: ["As on", "Date"] }
    },
    attribution: "Source: Reserve Bank of India — NBFC and ARC register.",
    policyNotes: "Official register landing page. Linked files may have separate formats and access rules; never follow or fetch a linked document unless its exact URL/path and terms have been reviewed and registered.",
    category: "LENDER",
    description: "RBI's public NBFC/ARC register entry point. Check the dated register and cancelled-CoR list separately."
  },
  {
    id: "nhb-hfc-register",
    name: "NHB — Housing Finance Companies with Certificate of Registration",
    canonicalUrl: "https://www.nhb.org.in/supervision/list-of-hfcs-in-india/",
    domain: "www.nhb.org.in",
    sourceType: "permitted_public_page",
    renderMode: "http",
    jurisdiction: "IN",
    allowedPaths: ["/supervision/list-of-hfcs-in-india/"],
    allowedPurposes: ["housing finance provider discovery", "lender institution verification"],
    allowedFields: ["institution_name", "registered_office_address", "certificate_status"],
    fieldSchema: {
      institution_name: { type: "string", aliases: ["Name of the HFC", "Name of Housing Finance Company"], required: true, entityKind: "organization" },
      registered_office_address: { type: "string", aliases: ["Registered Office Address", "Registered Office"] },
      certificate_status: { type: "string", aliases: ["Certificate of Registration", "CoR Status"] }
    },
    attribution: "Source: National Housing Bank — HFC register.",
    policyNotes: "Official NHB HFC register page; the page identifies the list as of 31 March 2026. It is not a credit approval list or a guarantee of current product availability. Administrator must review terms and date/freshness before approval.",
    category: "LENDER",
    description: "NHB's public HFC certificate register starting point; validate current regulatory status independently."
  },
  {
    id: "mca-company-master",
    name: "MCA — Company Master Details",
    canonicalUrl: "https://www.mcacdm.nic.in/company-master-details",
    domain: "www.mcacdm.nic.in",
    sourceType: "permitted_public_page",
    renderMode: "http",
    jurisdiction: "IN",
    allowedPaths: ["/company-master-details"],
    allowedPurposes: ["company identity discovery", "company identity verification"],
    allowedFields: ["legal_name", "registration_id", "registered_state"],
    fieldSchema: {
      legal_name: { type: "string", aliases: ["Company Name", "Legal Name"], required: true, entityKind: "organization" },
      registration_id: { type: "identifier", aliases: ["CIN", "Corporate Identification Number", "LLPIN"] },
      registered_state: { type: "string", aliases: ["Company State", "Registered State"] }
    },
    attribution: "Source: Ministry of Corporate Affairs — Corporate Data Management portal.",
    policyNotes: "Portal and dataset landing page only. Dataset classification, access method, terms and permissible automated use must be reviewed before any query or extraction. Do not bypass forms, authentication or access controls.",
    category: "CUSTOMER",
    description: "Official company master-data portal for company identity research, not a lead list or contact directory."
  }
]);

export function toSourceDraft(starter) {
  if (!starter || !OFFICIAL_SOURCE_STARTERS.some(item => item.id === starter.id)) {
    throw new Error("Choose a known AXIVESTRA official-source starter.");
  }
  return {
    name: starter.name,
    canonicalUrl: starter.canonicalUrl,
    sourceType: starter.sourceType,
    renderMode: starter.renderMode,
    jurisdiction: starter.jurisdiction,
    termsUrl: "",
    licenseRef: "Pending official-source terms and data-rights review",
    allowedPaths: starter.allowedPaths.join("\n"),
    allowedPurposes: starter.allowedPurposes.join("\n"),
    allowedFields: starter.allowedFields.join("\n"),
    fieldSchemaJson: JSON.stringify(starter.fieldSchema, null, 2),
    attribution: starter.attribution,
    policyNotes: starter.policyNotes
  };
}
