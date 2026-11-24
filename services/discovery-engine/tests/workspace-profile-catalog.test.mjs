import test from "node:test";
import assert from "node:assert/strict";
import {
  DISCOVERY_WORKSPACE_KEYS,
  getDefaultWorkspaceCriteria,
  validateWorkspaceCriteria,
  buildDiscoveryQueryHints
} from "../../../src/lib/discovery-profiles.mjs";

test("the lender/customer profile catalogue covers all 16 existing AXIVESTRA workspaces", () => {
  assert.equal(DISCOVERY_WORKSPACE_KEYS.length, 16);
  for (const workspaceKey of DISCOVERY_WORKSPACE_KEYS) {
    for (const mode of ["LENDER", "CUSTOMER"]) {
      const criteria = getDefaultWorkspaceCriteria(workspaceKey, mode);
      assert.equal(criteria.workspaceKey, workspaceKey);
      assert.equal(criteria.mode, mode);
      assert.ok(criteria.targetClasses.length, workspaceKey + "/" + mode + " targets");
      assert.ok(criteria.requiredFields.length, workspaceKey + "/" + mode + " required fields");
      assert.deepEqual(criteria.sourceRequiredFields, [], workspaceKey + "/" + mode + " starts with no source-specific mandatory fields");
      assert.ok(criteria.guardrails.length, workspaceKey + "/" + mode + " guardrails");
      assert.deepEqual(validateWorkspaceCriteria(criteria, workspaceKey, mode), criteria);
    }
  }
});

test("debt and equity provider classes remain distinct", () => {
  const equity = getDefaultWorkspaceCriteria("equity", "LENDER");
  const property = getDefaultWorkspaceCriteria("property_loans", "LENDER");
  assert.ok(equity.targetClasses.includes("venture_capital_fund"));
  assert.ok(equity.guardrails.some(value => /never debt lenders/i.test(value)));
  assert.ok(!property.targetClasses.includes("venture_capital_fund"));
});

test("Personal Loan customer discovery is locked to inbound/referral/consented intake", () => {
  const criteria = getDefaultWorkspaceCriteria("personal_loan", "CUSTOMER");
  assert.equal(criteria.disabledByPolicy, true);
  assert.ok(criteria.guardrails.some(value => /no internet scraping of private individuals/i.test(value)));
  assert.equal(validateWorkspaceCriteria({ ...criteria, disabledByPolicy: false }, "personal_loan", "CUSTOMER").disabledByPolicy, true);
});

test("Litigation lender and optional investor-relations lender profiles remain disabled by policy", () => {
  assert.equal(getDefaultWorkspaceCriteria("litigation", "LENDER").disabledByPolicy, true);
  assert.equal(getDefaultWorkspaceCriteria("investor_relations", "LENDER").disabledByPolicy, true);
});

test("criteria rejects cross-workspace, cross-mode and malformed values", () => {
  const criteria = getDefaultWorkspaceCriteria("property_loans", "LENDER");
  assert.throws(() => validateWorkspaceCriteria(criteria, "commercial_land", "LENDER"), /does not match/);
  assert.throws(() => validateWorkspaceCriteria(criteria, "property_loans", "CUSTOMER"), /does not match/);
  assert.throws(() => validateWorkspaceCriteria({ ...criteria, requiredFields: [] }, "property_loans", "LENDER"), /requiredFields/);
  assert.throws(() => validateWorkspaceCriteria({ ...criteria, preferredFields: "turnover" }, "property_loans", "LENDER"), /preferredFields/);
  assert.throws(() => validateWorkspaceCriteria({ ...criteria, sourceRequiredFields: ["private_credit_score"] }, "property_loans", "LENDER"), /final required or preferred/);
});

test("search hints derive from workspace targets and bounded user filters without generating contacts", () => {
  const criteria = getDefaultWorkspaceCriteria("property_loans", "LENDER");
  assert.deepEqual(buildDiscoveryQueryHints(criteria, { location: "Karnataka", product: "LAP" }).slice(0, 2), [
    "bank Karnataka LAP",
    "nbfc Karnataka LAP"
  ]);
  assert.ok(buildDiscoveryQueryHints(criteria).length <= 12);
});
