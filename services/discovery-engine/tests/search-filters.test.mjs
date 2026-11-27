import test from "node:test";
import assert from "node:assert/strict";
import {
  DISCOVERY_WORKSPACE_KEYS,
  getDefaultWorkspaceCriteria
} from "../../../src/lib/discovery-profiles.mjs";
import {
  INDIA_STATES_AND_UTS,
  createDefaultDiscoverySearchFilters,
  getWorkspaceSearchFilterFields,
  normalizeDiscoverySearchFilters
} from "../../../src/lib/discovery-search-filters.mjs";
import { buildSearxngQueries } from "../../../supabase/functions/_shared/discovery-search-connectors.mjs";

test("every AXIVESTRA workspace has separate LENDER and CUSTOMER filter definitions", () => {
  assert.equal(DISCOVERY_WORKSPACE_KEYS.length, 16);
  for (const workspaceKey of DISCOVERY_WORKSPACE_KEYS) {
    for (const mode of ["LENDER", "CUSTOMER"]) {
      const fields = getWorkspaceSearchFilterFields(workspaceKey, mode);
      assert.ok(fields.length >= 3, workspaceKey + "/" + mode + " must expose module filters");
      assert.equal(new Set(fields.map(field => field.key)).size, fields.length);
      assert.ok(fields.every(field => field.label && ["text", "number", "select"].includes(field.type)));
    }
  }
});

test("India geographic scope covers 28 states and 8 Union Territories", () => {
  assert.equal(INDIA_STATES_AND_UTS.length, 36);
  assert.ok(INDIA_STATES_AND_UTS.includes("Karnataka"));
  assert.ok(INDIA_STATES_AND_UTS.includes("Delhi"));
  assert.ok(INDIA_STATES_AND_UTS.includes("Dadra and Nagar Haveli and Daman and Diu"));
});

test("State, All India and International scopes become real search query location constraints", () => {
  const base = createDefaultDiscoverySearchFilters();
  const state = normalizeDiscoverySearchFilters("property_loans", "LENDER", {
    ...base, coverageScope: "state", state: "Karnataka"
  });
  assert.equal(state.location, "Karnataka, India");
  const india = normalizeDiscoverySearchFilters("housing_loan", "CUSTOMER", {
    ...base, coverageScope: "india"
  });
  assert.equal(india.location, "India");
  const country = normalizeDiscoverySearchFilters("housing_loan", "LENDER", {
    ...base, coverageScope: "international", country: "United Arab Emirates"
  });
  assert.equal(country.location, "United Arab Emirates");
  const global = normalizeDiscoverySearchFilters("startup", "CUSTOMER", {
    ...base, coverageScope: "international", country: ""
  });
  assert.equal(global.location, "");
});

test("invalid geography and module-specific select values are rejected", () => {
  const base = createDefaultDiscoverySearchFilters();
  assert.throws(() => normalizeDiscoverySearchFilters("property_loans", "LENDER", {
    ...base, coverageScope: "state", state: "Atlantis"
  }), /valid Indian State or Union Territory/);
  assert.throws(() => normalizeDiscoverySearchFilters("property_loans", "LENDER", {
    ...base, coverageScope: "india", country: "India"
  }), /only for International/);
  assert.throws(() => normalizeDiscoverySearchFilters("housing_loan", "CUSTOMER", {
    ...base, fields: { property_type: "Commercial aircraft" }
  }), /Invalid value for Property type/);
  assert.throws(() => normalizeDiscoverySearchFilters("housing_loan", "CUSTOMER", {
    ...base, fields: { loan_min: "-500" }
  }), /non-negative number/);
});

test("Property Loans and Housing Loan present different actionable filter sets in both modes", () => {
  const propertyLender = getWorkspaceSearchFilterFields("property_loans", "LENDER");
  const propertyCustomer = getWorkspaceSearchFilterFields("property_loans", "CUSTOMER");
  const housingLender = getWorkspaceSearchFilterFields("housing_loan", "LENDER");
  const housingCustomer = getWorkspaceSearchFilterFields("housing_loan", "CUSTOMER");
  assert.ok(propertyLender.some(field => field.key === "collateral_type"));
  assert.ok(propertyLender.some(field => field.key === "ltv_max"));
  assert.ok(propertyCustomer.some(field => field.key === "loan_purpose"));
  assert.ok(propertyCustomer.some(field => field.key === "project_stage"));
  assert.ok(housingLender.some(field => field.key === "loan_variant"));
  assert.ok(housingLender.some(field => field.key === "rate_type"));
  assert.ok(housingCustomer.some(field => field.key === "property_value_min"));
  assert.ok(housingCustomer.some(field => field.key === "purchase_stage"));
});

test("selected module filters and region are included in the actual SearXNG query terms", () => {
  const criteria = getDefaultWorkspaceCriteria("property_loans", "LENDER");
  const filters = normalizeDiscoverySearchFilters("property_loans", "LENDER", {
    ...createDefaultDiscoverySearchFilters(),
    coverageScope: "state",
    state: "Karnataka",
    fields: {
      loan_product: "Loan against property",
      collateral_type: "Commercial property",
      ticket_min: "5000000",
      ticket_max: "50000000"
    }
  });
  const queries = buildSearxngQueries(criteria, filters);
  assert.ok(queries.length > 0);
  assert.ok(queries.every(query => query.includes("Karnataka, India")));
  assert.ok(queries.some(query => query.includes("Loan product: Loan against property")));
  assert.ok(queries.some(query => query.includes("Collateral type: Commercial property")));
  assert.ok(queries.some(query => query.includes("Minimum loan amount: 5000000 INR")));
});


test("each LENDER and CUSTOMER mode has its own filter field set and currency-aware amount terms", () => {
  const lenderFields = getWorkspaceSearchFilterFields("housing_loan", "LENDER");
  const customerFields = getWorkspaceSearchFilterFields("housing_loan", "CUSTOMER");
  assert.notDeepEqual(lenderFields.map(field => field.key), customerFields.map(field => field.key));
  const filters = normalizeDiscoverySearchFilters("housing_loan", "CUSTOMER", {
    ...createDefaultDiscoverySearchFilters(),
    coverageScope: "international",
    country: "United Arab Emirates",
    currency: "AED",
    fields: { loan_min: "100000", loan_max: "500000" }
  });
  assert.equal(filters.location, "United Arab Emirates");
  assert.match(filters.searchTerms, /Minimum loan requirement: 100000 AED/);
  assert.match(filters.searchTerms, /Maximum loan requirement: 500000 AED/);
});
