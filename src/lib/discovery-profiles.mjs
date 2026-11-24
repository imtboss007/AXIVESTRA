const WORKSPACE_PROFILES = {
  property_sale: {
    CUSTOMER: {
      targetClasses: ["property_owner_or_seller", "verified_buyer", "developer", "property_investor", "licensed_broker"],
      requiredFields: ["legal_name", "entity_type", "geography"],
      preferredFields: ["asset_type", "locality", "area_band", "use_or_zoning_when_authoritative", "asking_price_band", "mandate_type", "transaction_stage"],
      matchDimensions: ["location", "asset_class", "size_value_band", "transaction_intent", "mandate", "evidence_quality"],
      sourcePriorities: ["official_property_or_company_source", "developer_website", "permitted_listing", "licensed_property_feed"],
      guardrails: ["A listing is not title proof or a completed sale.", "Verify seller authority and buyer mandate.", "Never infer ownership or encumbrances from maps or marketing pages."]
    },
    LENDER: {
      targetClasses: ["purchase_finance_bank", "mortgage_lender", "loan_against_property_provider", "bridge_lender", "development_finance_provider"],
      requiredFields: ["institution_name", "product_type", "jurisdiction"],
      preferredFields: ["collateral_type", "geography", "ticket_size_band", "borrower_type", "ltv_range", "tenure", "published_rate_and_fees", "eligibility", "application_channel"],
      matchDimensions: ["location", "product", "collateral", "ticket_size", "borrower_type", "ltv", "published_eligibility", "source_recency"],
      sourcePriorities: ["regulator_register", "official_lender_product_page", "official_bank_or_nbfc_directory", "licensed_provider_feed"],
      guardrails: ["Verify lender identity, regulatory status and current product terms.", "Published product criteria are not a promise of approval.", "Keep debt lenders distinct from equity investors."]
    }
  },
  property_loans: {
    CUSTOMER: {
      targetClasses: ["property_owner_seeking_mortgage", "business_borrower", "construction_or_project_borrower", "refinance_borrower", "inbound_or_referred_borrower"],
      requiredFields: ["legal_name", "entity_type", "geography"],
      preferredFields: ["loan_purpose", "requested_amount_band", "collateral_class", "property_profile", "project_stage", "public_business_capacity_indicator"],
      matchDimensions: ["requested_amount", "collateral", "location", "use_of_funds", "borrower_category", "project_stage"],
      sourcePriorities: ["user_provided_or_inbound", "official_company_registry", "official_lender_or_programme_directory", "licensed_business_feed"],
      guardrails: ["Never infer private credit score, bank balances, repayment history, tax returns or private turnover.", "Do not mark a borrower qualified until verified.", "Public signals are leads, not underwriting evidence."]
    },
    LENDER: {
      targetClasses: ["bank", "nbfc", "housing_finance_company", "credit_fund", "private_credit_lender", "mortgage_or_lap_provider", "construction_or_project_finance_lender"],
      requiredFields: ["institution_name", "product_type", "jurisdiction"],
      preferredFields: ["regulatory_category", "licence_status", "products", "state_city_coverage", "ticket_size_band", "ltv_range", "tenure", "published_rates_and_fees", "eligible_property", "eligible_borrower", "contact_channel"],
      matchDimensions: ["requested_amount_vs_ticket", "collateral_and_ltv", "geography", "use_of_funds", "borrower_type", "published_eligibility", "source_date"],
      sourcePriorities: ["rbi_or_nhb_register", "official_bank_or_nbfc_product_page", "official_company_registry", "licensed_provider_feed"],
      guardrails: ["Do not infer private credit scores, balances or repayment history.", "Verify licence/status and product terms from authoritative sources.", "No lender approval guarantee."]
    }
  },
  jv_jda_jd: {
    CUSTOMER: {
      targetClasses: ["landowner_entity", "family_landholding_entity", "developer_or_builder", "co_development_partner", "institutional_buyer", "project_operator"],
      requiredFields: ["legal_name", "entity_type", "geography"],
      preferredFields: ["project_location", "area_band", "authoritative_permitted_use", "ownership_entity_identity", "developer_track_record", "project_class", "partnership_mandate"],
      matchDimensions: ["land_or_project_size", "location", "project_type", "development_stage", "partner_capability", "capital_need"],
      sourcePriorities: ["official_company_registry", "official_rera_or_project_record", "official_planning_or_land_source", "developer_website"],
      guardrails: ["No title, zoning or encumbrance conclusions from secondary sources.", "Verify ownership, beneficial ownership and authority with legal documents."]
    },
    LENDER: {
      targetClasses: ["construction_finance_lender", "project_finance_lender", "land_backed_credit_provider", "development_lender", "structured_finance_provider", "private_credit_fund"],
      requiredFields: ["institution_name", "product_type", "jurisdiction"],
      preferredFields: ["project_stage", "security_policy", "collateral_policy", "minimum_exposure", "maximum_exposure", "promoter_criteria", "geography", "disbursement_milestones", "covenants"],
      matchDimensions: ["project_size", "location", "project_type", "stage", "capital_need", "security_structure", "experience_evidence"],
      sourcePriorities: ["regulator_register", "official_lender_product_page", "published_fund_or_lender_mandate", "licensed_provider_feed"],
      guardrails: ["Do not infer private underwriting criteria.", "Published mandates do not establish approval or availability."]
    }
  },
  sr_rate_settlement: {
    CUSTOMER: {
      targetClasses: ["settlement_counterparty", "property_transaction_party", "professional_valuer"],
      requiredFields: ["entity_name", "entity_type", "jurisdiction"],
      preferredFields: ["settlement_type", "asset_or_transaction_class", "geography", "rate_basis", "counterparty_role", "source_documents"],
      matchDimensions: ["settlement_category", "asset_class", "geography", "rate_basis", "counterparty_role", "provenance"],
      sourcePriorities: ["user_provided_case_or_transaction_record", "official_published_rate_schedule", "licensed_valuation_source"],
      guardrails: ["Keep SR taxonomy configurable; do not expand its meaning automatically.", "Never scrape or infer private case data."]
    },
    LENDER: {
      targetClasses: ["bridge_finance_provider", "secured_settlement_finance_provider"],
      requiredFields: ["institution_name", "product_type", "jurisdiction"],
      preferredFields: ["amount_band", "collateral", "eligibility", "published_terms"],
      matchDimensions: ["settlement_type", "amount_band", "collateral", "geography"],
      sourcePriorities: ["official_lender_product_page", "regulator_register", "licensed_provider_feed"],
      guardrails: ["Conditional profile: enable only when the workspace owner explicitly configures settlement finance.", "Do not infer legal entitlement, settlement value or lender approval."]
    }
  },
  agricultural_land: {
    CUSTOMER: {
      targetClasses: ["landowner_or_seller", "agricultural_operator", "agri_business", "processor", "farm_buyer", "warehouse_or_industrial_user", "project_developer"],
      requiredFields: ["entity_name", "entity_type", "geography"],
      preferredFields: ["district", "taluk", "village", "area_band", "crop_or_irrigation_when_sourced", "land_use_when_authoritative", "business_activity", "stated_intent"],
      matchDimensions: ["district_taluk_village", "land_size", "use", "water_or_infrastructure_context", "business_type", "project_need"],
      sourcePriorities: ["official_agriculture_or_land_portal", "official_company_registry", "agri_lender_or_scheme_page", "permitted_local_business_directory"],
      guardrails: ["Maps and OSM records do not prove title, possession or land classification.", "Verify agricultural eligibility and legal status against authoritative records."]
    },
    LENDER: {
      targetClasses: ["agriculture_bank", "rural_finance_institution", "cooperative_lender", "warehouse_receipt_lender", "equipment_finance_lender", "agri_project_finance_provider"],
      requiredFields: ["institution_name", "product_type", "jurisdiction"],
      preferredFields: ["eligible_borrower", "eligible_activity_or_crop", "eligible_asset", "security", "district_or_state_coverage", "ticket_size_band", "published_rate", "tenure", "scheme_source"],
      matchDimensions: ["district_state", "activity", "asset", "loan_purpose", "collateral", "ticket_size"],
      sourcePriorities: ["regulator_or_government_register", "official_bank_or_cooperative_page", "official_scheme_page", "licensed_provider_feed"],
      guardrails: ["Verify current scheme and lender eligibility from official sources.", "No inference of land title or private borrower finances."]
    }
  },
  commercial_land: {
    CUSTOMER: {
      targetClasses: ["commercial_or_industrial_landowner", "industrial_user", "logistics_operator", "retail_or_office_user", "warehouse_user", "developer", "commercial_investor"],
      requiredFields: ["entity_name", "entity_type", "geography"],
      preferredFields: ["use_type_when_authoritative", "micro_market", "area_band", "frontage_or_access", "infrastructure", "stated_availability_or_requirement", "company_profile"],
      matchDimensions: ["use_class", "micro_market", "area", "infrastructure", "capital_need", "asset_readiness"],
      sourcePriorities: ["industrial_area_authority", "official_investment_portal", "company_or_developer_website", "permitted_listing", "licensed_dataset"],
      guardrails: ["Do not infer permitted use, title, environmental clearance, ownership or encumbrances from listing text.", "Preserve inspection and verification status."]
    },
    LENDER: {
      targetClasses: ["commercial_mortgage_lender", "construction_finance_lender", "project_finance_lender", "equipment_or_warehouse_financier", "private_credit_fund", "real_estate_debt_fund"],
      requiredFields: ["institution_name", "product_type", "jurisdiction"],
      preferredFields: ["asset_class", "occupancy_or_development_status", "ticket_size_band", "location", "ltv_range", "borrower_type", "tenure", "collateral_eligibility"],
      matchDimensions: ["use_class", "location", "plot_or_building_area", "infrastructure", "capital_required", "asset_readiness", "ticket_fit"],
      sourcePriorities: ["regulator_register", "official_lender_product_page", "published_fund_mandate", "licensed_provider_feed"],
      guardrails: ["Do not infer private lending criteria or security acceptance.", "Published terms require lender confirmation."]
    }
  },
  startup: {
    CUSTOMER: {
      targetClasses: ["startup", "founder_led_company", "scale_up", "strategic_customer_candidate", "partnership_candidate", "investee_company"],
      requiredFields: ["legal_name", "entity_type", "geography"],
      preferredFields: ["sector", "stage", "location", "product", "sourced_funding_status", "public_hiring_or_expansion_signal", "stated_partnership_or_customer_fit"],
      matchDimensions: ["sector", "stage", "instrument", "use_of_funds", "ticket", "geography", "growth_signal"],
      sourcePriorities: ["official_company_registry", "official_startup_or_fund_portfolio", "corporate_announcement", "licensed_api"],
      guardrails: ["Use sourced company-level facts only.", "Do not collect founders' private contact details or personal financial data without a lawful defined purpose."]
    },
    LENDER: {
      targetClasses: ["venture_debt_provider", "startup_bank_or_nbfc", "revenue_based_finance_provider", "venture_capital_fund_equity_only"],
      requiredFields: ["institution_name", "product_type", "jurisdiction"],
      preferredFields: ["debt_or_equity_instrument", "stage", "sector", "geography", "ticket_size_band", "published_traction_criteria", "security_or_guarantee_policy", "application_channel"],
      matchDimensions: ["instrument", "stage", "sector", "use_of_funds", "ticket", "geography", "published_mandate"],
      sourcePriorities: ["regulator_register", "official_lender_or_fund_mandate", "official_portfolio_page", "licensed_provider_feed"],
      guardrails: ["Keep venture debt and equity funding separate.", "Equity investors are not debt lenders."]
    }
  },
  equity: {
    CUSTOMER: {
      targetClasses: ["issuer_company", "prospective_investee_company", "lawfully_listed_promoter_or_shareholder", "secondary_market_counterparty"],
      requiredFields: ["legal_name", "entity_type", "jurisdiction"],
      preferredFields: ["sector", "instrument", "share_class", "geography", "sourced_corporate_event", "published_fundraising_or_sale_mandate"],
      matchDimensions: ["stage", "sector", "instrument", "valuation_or_ticket_band", "geography", "investment_thesis", "evidence_quality"],
      sourcePriorities: ["official_exchange_filing", "official_company_filing", "regulator_register", "licensed_corporate_action_feed"],
      guardrails: ["Do not infer current beneficial ownership or shareholding from stale web content.", "A prospect score is not investment advice or suitability."]
    },
    LENDER: {
      targetClasses: ["angel_investor", "venture_capital_fund", "private_equity_firm", "family_office", "equity_fund", "optional_debt_provider_separate"],
      requiredFields: ["institution_name", "capital_instrument", "jurisdiction"],
      preferredFields: ["stage", "sector", "ticket_size_band", "geography", "equity_instrument", "published_investment_thesis", "portfolio_exposure"],
      matchDimensions: ["instrument", "stage", "sector", "ticket", "geography", "mandate_fit", "evidence_date"],
      sourcePriorities: ["official_fund_website", "public_fund_documents", "official_regulator_register", "official_portfolio_page"],
      guardrails: ["Classify equity funds as investors, never debt lenders.", "Do not infer beneficial ownership or investor eligibility.", "No recommendation or suitability conclusion."]
    }
  },
  unsecured_company_loan: {
    CUSTOMER: {
      targetClasses: ["company_borrower", "msme", "working_capital_borrower", "term_loan_borrower", "invoice_or_trade_finance_borrower", "inbound_or_referred_company"],
      requiredFields: ["legal_name", "entity_type", "geography"],
      preferredFields: ["sector", "state_or_city", "public_operating_indicator", "stated_funding_need", "ticket_size_band", "years_operating_when_sourced"],
      matchDimensions: ["company_segment", "stated_need", "ticket", "geography", "sector_eligibility", "source_freshness"],
      sourcePriorities: ["official_company_registry", "official_msme_or_programme_directory", "company_website", "licensed_business_feed"],
      guardrails: ["Never scrape or infer personal credit scores, bank statements, private turnover or tax returns.", "Do not label a company qualified until verified."]
    },
    LENDER: {
      targetClasses: ["bank", "nbfc", "sme_or_msme_lender", "private_debt_fund", "credit_fund", "invoice_finance_provider", "trade_finance_provider", "regulated_digital_lending_partner"],
      requiredFields: ["institution_name", "product_type", "jurisdiction"],
      preferredFields: ["unsecured_product", "published_turnover_or_tenure_criteria", "ticket_size_band", "sector_exclusions", "geography", "interest_and_fees", "collateral_or_guarantee_terms"],
      matchDimensions: ["company_segment", "stated_need", "ticket", "geography", "sector", "published_eligibility", "product"],
      sourcePriorities: ["regulator_register", "official_bank_or_nbfc_product_page", "official_msme_scheme_page", "licensed_provider_feed"],
      guardrails: ["Use only published eligibility criteria.", "No private underwriting attributes or credit-score inference."]
    }
  },
  personal_loan: {
    CUSTOMER: {
      targetClasses: ["user_entered_borrower", "referred_borrower", "inbound_enquiry", "explicitly_consented_borrower"],
      requiredFields: ["borrower_reference", "consent_or_referral_basis", "jurisdiction"],
      preferredFields: ["requested_amount_band", "purpose", "customer_provided_eligibility_attributes", "permitted_partner_channel"],
      matchDimensions: ["requested_amount", "published_product_criteria", "location", "consent_scope"],
      sourcePriorities: ["user_entered", "inbound_enquiry", "documented_referral", "explicitly_consented_partner"],
      disabledByPolicy: true,
      guardrails: ["External person discovery is disabled.", "No internet scraping of private individuals, phone numbers, personal finances, salary or creditworthiness.", "Only user-entered, referred, inbound or explicitly consented borrower intake is permitted."]
    },
    LENDER: {
      targetClasses: ["bank_personal_loan", "licensed_nbfc_personal_loan", "regulated_digital_lending_institution"],
      requiredFields: ["institution_name", "product_type", "jurisdiction"],
      preferredFields: ["licence_status", "published_income_criteria", "geography", "ticket_size_band", "rate_and_fees", "tenure", "official_application_channel"],
      matchDimensions: ["requested_amount", "published_product_criteria", "geography", "tenure", "fees", "permitted_channel"],
      sourcePriorities: ["rbi_register", "official_bank_or_nbfc_product_page", "official_partner_api"],
      guardrails: ["Verify provider licensing and published terms.", "Pre-screen is not regulated underwriting or loan approval."]
    }
  },
  housing_loan: {
    CUSTOMER: {
      targetClasses: ["inbound_homebuyer", "user_provided_homebuyer", "developer_or_project_entity", "explicit_home_loan_enquiry", "referral_partner"],
      requiredFields: ["entity_name", "entity_type", "geography"],
      preferredFields: ["project_or_property_area", "enquiry_source", "price_band", "developer_identity", "official_project_approval_reference"],
      matchDimensions: ["property_geography", "property_value", "loan_amount", "project_and_lender_eligibility", "tenure"],
      sourcePriorities: ["user_or_inbound_enquiry", "official_rera_or_project_portal", "developer_website", "official_company_registry"],
      guardrails: ["Do not scrape individual homebuyers or infer salary, employment or credit history.", "Project approval must be verified from authoritative records."]
    },
    LENDER: {
      targetClasses: ["bank_home_loan", "housing_finance_company", "authorised_nbfc_home_finance_provider"],
      requiredFields: ["institution_name", "product_type", "jurisdiction"],
      preferredFields: ["borrower_category", "project_coverage", "ltv", "ticket_size_band", "published_rate_and_fees", "tenure", "prepayment_terms"],
      matchDimensions: ["property_geography", "property_value", "loan_amount", "project_eligibility", "borrower_type", "rate", "tenure"],
      sourcePriorities: ["rbi_or_nhb_register", "official_hfc_or_bank_product_page", "official_project_directory"],
      guardrails: ["Verify current HFC/NBFC status and lender terms.", "Published eligibility is not approval."]
    }
  },
  house_purchase: {
    CUSTOMER: {
      targetClasses: ["buyer", "seller", "developer", "verified_property_representative", "configured_broker"],
      requiredFields: ["entity_name", "entity_type", "geography"],
      preferredFields: ["property_type", "locality", "budget_band", "area_band", "sourced_possession_or_registration_status", "transaction_stage", "authorised_contact_route"],
      matchDimensions: ["budget_vs_price", "location", "property_type", "area", "transaction_stage", "financing_need", "source_reliability"],
      sourcePriorities: ["developer_website", "official_project_record", "permitted_property_listing", "user_referral"],
      guardrails: ["A listing is not legal due diligence.", "Keep title, encumbrance, approval, valuation and seller identity verification separate."]
    },
    LENDER: {
      targetClasses: ["home_loan_bank", "housing_finance_company", "mortgage_lender", "bridge_lender"],
      requiredFields: ["institution_name", "product_type", "jurisdiction"],
      preferredFields: ["property_category", "purchase_price_or_loan_band", "ltv", "location", "project_eligibility", "published_rate", "published_terms"],
      matchDimensions: ["property_value", "location", "asset_category", "loan_amount", "ltv", "project_eligibility"],
      sourcePriorities: ["rbi_or_nhb_register", "official_bank_or_hfc_product_page", "official_project_portal"],
      guardrails: ["No inference of title, seller authority or loan approval.", "Verify product terms and project eligibility."]
    }
  },
  litigation: {
    CUSTOMER: {
      targetClasses: ["user_provided_organization", "organization_in_official_public_record", "legal_professional", "law_firm_or_counsel"],
      requiredFields: ["legal_name", "entity_type", "jurisdiction"],
      preferredFields: ["court_or_authority", "case_number", "party_name_when_necessary", "filing_or_hearing_date", "official_status", "professional_expertise"],
      matchDimensions: ["jurisdiction", "court_or_tribunal", "case_type", "verified_entity_identity", "expertise", "source_date"],
      sourcePriorities: ["user_uploaded_matter", "official_court_or_tribunal_portal", "permitted_professional_directory"],
      guardrails: ["No sensitive personal allegations or cold marketing from litigation records.", "No legal conclusion or filing automation from web snippets.", "Limit to user-supplied matters and lawfully available official public records."]
    },
    LENDER: {
      targetClasses: ["owner_configured_litigation_finance_provider_only"],
      requiredFields: ["institution_name", "product_type", "jurisdiction"],
      preferredFields: ["legal_review_reference", "published_finance_mandate"],
      matchDimensions: ["explicitly_configured_purpose", "jurisdiction", "published_mandate"],
      sourcePriorities: ["owner_approved_official_or_licensed_source"],
      disabledByPolicy: true,
      guardrails: ["Off by default; require explicit owner configuration and legal review.", "Never infer a case is eligible for funding or use litigation as a cold-marketing trigger."]
    }
  },
  fund_portfolio_management: {
    CUSTOMER: {
      targetClasses: ["limited_partner", "institutional_investor", "lawfully_eligible_investor", "investee_company", "co_investor", "strategic_counterparty"],
      requiredFields: ["entity_name", "entity_type", "jurisdiction"],
      preferredFields: ["mandate", "geography", "fund_or_investment_stage", "sector", "stated_ticket_band", "published_portfolio", "investment_thesis"],
      matchDimensions: ["mandate", "ticket", "fund_strategy", "geography", "liquidity_need", "sector", "source_freshness"],
      sourcePriorities: ["official_fund_or_manager_website", "published_fund_document", "official_regulator_page", "portfolio_company_filing"],
      guardrails: ["Do not infer accredited or institutional status from web data.", "Keep private placement, solicitation and suitability processes outside automated discovery."]
    },
    LENDER: {
      targetClasses: ["fund_credit_provider", "working_capital_provider", "subscription_facility_provider", "asset_backed_lender", "private_credit_fund", "equity_fund_separate"],
      requiredFields: ["institution_name", "product_type", "jurisdiction"],
      preferredFields: ["facility_type", "fund_or_manager_eligibility", "collateral_or_borrowing_base", "ticket_size_band", "geography", "tenure", "covenants"],
      matchDimensions: ["facility_type", "fund_strategy", "collateral", "ticket", "geography", "covenants"],
      sourcePriorities: ["official_lender_or_fund_website", "published_fund_documents", "regulator_register", "licensed_provider_feed"],
      guardrails: ["Keep equity capital distinct from credit facilities.", "Do not infer investor eligibility or private fund financials."]
    }
  },
  investor_relations: {
    CUSTOMER: {
      targetClasses: ["existing_investor", "limited_partner", "prospective_institutional_investor", "relationship_intermediary"],
      requiredFields: ["entity_name", "entity_type", "jurisdiction"],
      preferredFields: ["published_mandate", "fund_interest", "geography", "fund_strategy", "ticket_band", "public_investment_history", "relationship_source"],
      matchDimensions: ["mandate", "fund_strategy", "geography", "ticket", "public_investments", "relationship_history"],
      sourcePriorities: ["approved_crm", "documented_referral", "official_investor_website", "public_annual_report", "licensed_feed"],
      guardrails: ["No unsolicited automated bulk investor outreach.", "Store processing purpose, preference, opt-out and approval before messaging."]
    },
    LENDER: {
      targetClasses: ["optional_fund_or_portfolio_finance_provider"],
      requiredFields: ["institution_name", "product_type", "jurisdiction"],
      preferredFields: ["facility_type", "eligibility", "ticket_band", "relationship_owner"],
      matchDimensions: ["facility_type", "fund_strategy", "geography", "ticket"],
      sourcePriorities: ["official_lender_page", "approved_crm", "licensed_feed"],
      disabledByPolicy: true,
      guardrails: ["Not a default investor-relations lead type; enable only for an explicitly approved fund-finance workflow.", "Investors remain separate from debt lenders."]
    }
  },
  compliance_kyc: {
    CUSTOMER: {
      targetClasses: ["onboarded_entity", "counterparty", "vendor", "borrower_entity", "investor_entity"],
      requiredFields: ["legal_name", "registration_identifier", "jurisdiction"],
      preferredFields: ["registration_status", "authorised_director_or_beneficial_owner_data", "source_authority", "screening_reference"],
      matchDimensions: ["exact_identifier", "legal_name_variant", "jurisdiction", "licence_or_registration", "source_authority"],
      sourcePriorities: ["official_company_registry", "official_regulator_register", "licensed_kyc_or_sanctions_provider", "authorised_data_feed"],
      guardrails: ["Only lawfully required related-person data from authorised authoritative sources.", "Human review for fuzzy and adverse-media matches.", "Never auto-reject, blacklist or clear KYC from model inference or a non-commercial dataset."]
    },
    LENDER: {
      targetClasses: ["bank_counterparty", "nbfc_counterparty", "institutional_investor_counterparty", "regulated_vendor"],
      requiredFields: ["institution_name", "registration_identifier", "jurisdiction"],
      preferredFields: ["regulator_authorisation", "licence_status", "registered_address", "permitted_products", "official_notice"],
      matchDimensions: ["exact_identifier", "jurisdiction", "licence_status", "permitted_product", "source_recency"],
      sourcePriorities: ["rbi_register", "nhb_register", "official_company_registry", "licensed_kyc_feed"],
      guardrails: ["Institution verification is distinct from lead generation or lending approval.", "Human review of identity and adverse notices is mandatory."]
    }
  }
};

const E11_MATCH_KEYS = Object.freeze([
  "geography", "type", "ticket", "instrument", "collateral", "stage", "mandate", "evidence_freshness"
]);

export const E11_MATCH_CRITERIA = E11_MATCH_KEYS;

export function validateE11MatchCriteria(value) {
  const input = value === undefined || value === null ? {} : value;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("matchCriteria must be a JSON object.");
  }
  const result = {};
  for (const [key, rule] of Object.entries(input)) {
    if (!E11_MATCH_KEYS.includes(key)) {
      throw new Error("Unsupported E11 match criterion: " + key + ".");
    }
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
      throw new Error("E11 " + key + " criteria must be an object.");
    }
    const allowedProperties = key === "evidence_freshness"
      ? ["maxAgeDays", "weight", "required"]
      : ["value", "weight", "required"];
    if (Object.keys(rule).some(property => !allowedProperties.includes(property))) {
      throw new Error("E11 " + key + " contains an unsupported criterion property.");
    }
    const weight = rule.weight === undefined ? 1 : rule.weight;
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0 || weight > 100) {
      throw new Error("E11 " + key + " weight must be between 0 and 100.");
    }
    if (rule.required !== undefined && typeof rule.required !== "boolean") {
      throw new Error("E11 " + key + " required must be boolean.");
    }
    if (key === "evidence_freshness") {
      if (typeof rule.maxAgeDays !== "number" || !Number.isFinite(rule.maxAgeDays) ||
          rule.maxAgeDays < 0 || rule.maxAgeDays > 3650) {
        throw new Error("E11 evidence_freshness.maxAgeDays must be between 0 and 3650.");
      }
      result[key] = { maxAgeDays: rule.maxAgeDays, weight, required: rule.required === true };
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(rule, "value")) {
      throw new Error("E11 " + key + " must include an explicit value.");
    }
    const criterionValue = rule.value;
    if (key === "ticket") {
      if (!criterionValue || typeof criterionValue !== "object" || Array.isArray(criterionValue) ||
          Object.keys(criterionValue).some(part => !["min", "max", "currencyCode"].includes(part)) ||
          !Object.keys(criterionValue).length ||
          Object.values(criterionValue).some(part => typeof part !== "number" || !Number.isFinite(part) || part < 0) ||
          (criterionValue.min !== undefined && criterionValue.max !== undefined && criterionValue.min > criterionValue.max) ||
          (criterionValue.currencyCode !== undefined && (typeof criterionValue.currencyCode !== "string" || !/^[A-Z]{3}$/.test(criterionValue.currencyCode)))) {
        throw new Error("E11 ticket.value must be a non-negative min/max range.");
      }
    } else {
      const isValid = typeof criterionValue === "string" && criterionValue.trim().length > 0 ||
        typeof criterionValue === "number" && Number.isFinite(criterionValue) ||
        Array.isArray(criterionValue) && criterionValue.length > 0 && criterionValue.length <= 40 &&
          criterionValue.every(item => typeof item === "string" && item.trim().length > 0 && item.length <= 120);
      if (!isValid) {
        throw new Error("E11 " + key + ".value must be a non-empty string, finite number or bounded list of strings.");
      }
    }
    result[key] = { value: criterionValue, weight, required: rule.required === true };
  }
  return result;
}

export function getE11MatchCriteria(workspaceCriteria) {
  return validateE11MatchCriteria(workspaceCriteria?.matchCriteria);
}

export const DISCOVERY_WORKSPACE_KEYS = Object.freeze(Object.keys(WORKSPACE_PROFILES));

export function getDefaultWorkspaceCriteria(workspaceKey, mode) {
  const normalizedMode = String(mode || "").toUpperCase();
  const profile = WORKSPACE_PROFILES[workspaceKey]?.[normalizedMode];
  if (!profile) throw new Error("Unknown AXIVESTRA workspace or discovery mode.");
  return Object.freeze({
    schemaVersion: 1,
    workspaceKey,
    mode: normalizedMode,
    targetClasses: [...profile.targetClasses],
    requiredFields: [...profile.requiredFields],
    sourceRequiredFields: [],
    matchCriteria: {},
    preferredFields: [...profile.preferredFields],
    matchDimensions: [...profile.matchDimensions],
    sourcePriorities: [...profile.sourcePriorities],
    guardrails: [...profile.guardrails],
    disabledByPolicy: profile.disabledByPolicy === true
  });
}

export function validateWorkspaceCriteria(value, workspaceKey, mode) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Workspace criteria must be a JSON object.");
  const expectedMode = String(mode || "").toUpperCase();
  const defaults = getDefaultWorkspaceCriteria(workspaceKey, expectedMode);
  if (value.schemaVersion !== 1 || value.workspaceKey !== workspaceKey || value.mode !== expectedMode) {
    throw new Error("Criteria workspace, mode or schema version does not match the selected profile.");
  }
  const listKeys = ["targetClasses", "requiredFields", "preferredFields", "matchDimensions", "sourcePriorities", "guardrails"];
  const result = { schemaVersion: 1, workspaceKey, mode: expectedMode };
  for (const key of listKeys) {
    const raw = value[key];
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 60 ||
        raw.some(item => typeof item !== "string" || !item.trim() || item.length > 180)) {
      throw new Error("Criteria " + key + " must contain 1 to 60 non-empty text items.");
    }
    result[key] = [...new Set(raw.map(item => item.trim()))];
  }
  const sourceRequiredFields = value.sourceRequiredFields === undefined ? [] : value.sourceRequiredFields;
  if (!Array.isArray(sourceRequiredFields) || sourceRequiredFields.length > 40 ||
      sourceRequiredFields.some(item => typeof item !== "string" || !item.trim() || item.length > 180)) {
    throw new Error("Criteria sourceRequiredFields must contain 0 to 40 non-empty text items.");
  }
  result.sourceRequiredFields = [...new Set(sourceRequiredFields.map(item => item.trim()))];
  if (result.sourceRequiredFields.some(field => !result.requiredFields.includes(field) && !result.preferredFields.includes(field))) {
    throw new Error("Every source-required field must also be a final required or preferred workspace field.");
  }
  result.matchCriteria = validateE11MatchCriteria(value.matchCriteria);
  if (expectedMode === "CUSTOMER" && workspaceKey === "personal_loan") {
    result.disabledByPolicy = true;
  } else {
    result.disabledByPolicy = value.disabledByPolicy === true || defaults.disabledByPolicy === true;
  }
  if (workspaceKey === "litigation" && expectedMode === "LENDER") result.disabledByPolicy = true;
  return result;
}

export function buildDiscoveryQueryHints(criteria, filters = {}) {
  const safe = criteria && typeof criteria === "object" ? criteria : {};
  const terms = [...(Array.isArray(safe.targetClasses) ? safe.targetClasses : [])]
    .slice(0, 20).map(value => String(value).replaceAll("_", " "));
  const location = typeof filters.location === "string" ? filters.location.trim().slice(0, 120) : "";
  const sector = typeof filters.sector === "string" ? filters.sector.trim().slice(0, 100) : "";
  const product = typeof filters.product === "string" ? filters.product.trim().slice(0, 100) : "";
  const extra = [location, sector, product].filter(Boolean);
  return terms.slice(0, 12).map(term => [term, ...extra].filter(Boolean).join(" "));
}
