import test from "node:test";
import assert from "node:assert/strict";
import {
  DISCOVERY_WORKSPACE_KEYS,
  getDefaultWorkspaceCriteria,
  validateWorkspaceCriteria,
  buildDiscoveryQueryHints,
  getE11MatchCriteria
} from "../../../src/lib/discovery-profiles.mjs";
import { scoreDiscoveryMatch } from "../../discovery-worker/matching.mjs";

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

test("E11 match criteria are optional, typed and limited to the nine supported scorer dimensions", () => {
  const defaults = getDefaultWorkspaceCriteria("property_loans", "LENDER");
  assert.deepEqual(defaults.matchCriteria, {});
  const configured = validateWorkspaceCriteria({
    ...defaults,
    matchCriteria: {
      geography: { value: ["Karnataka", "India"], weight: 2 },
      ticket: { value: { min: 1000000, max: 50000000, currencyCode: "INR" }, weight: 3, required: true },
      evidence_freshness: { maxAgeDays: 90, weight: 1 }
    }
  }, "property_loans", "LENDER");
  assert.equal(configured.matchCriteria.geography.weight, 2);
  assert.equal(configured.matchCriteria.ticket.required, true);
  assert.equal(configured.matchCriteria.ticket.value.currencyCode, "INR");
  assert.equal(configured.matchCriteria.evidence_freshness.maxAgeDays, 90);
  assert.throws(() => validateWorkspaceCriteria({
    ...defaults, matchCriteria: { private_credit_score: { value: 700, weight: 2 } }
  }, "property_loans", "LENDER"), /Unsupported E11 match criterion/);
  assert.throws(() => validateWorkspaceCriteria({
    ...defaults, matchCriteria: { ticket: { value: { min: 100, max: 50 } } }
  }, "property_loans", "LENDER"), /non-negative min\/max range/);
  assert.throws(() => validateWorkspaceCriteria({
    ...defaults, matchCriteria: { evidence_freshness: { maxAgeDays: 99999 } }
  }, "property_loans", "LENDER"), /maxAgeDays must be between/);
});

test("match criteria are not silently generated from target classes or guardrails", () => {
  for (const workspaceKey of DISCOVERY_WORKSPACE_KEYS) {
    for (const mode of ["LENDER", "CUSTOMER"]) {
      assert.deepEqual(getDefaultWorkspaceCriteria(workspaceKey, mode).matchCriteria, {});
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

test("Litigation lender is policy-restricted while Investor Relations lender is optional fund finance", () => {
  assert.equal(getDefaultWorkspaceCriteria("litigation", "LENDER").disabledByPolicy, true);
  const investorRelations = getDefaultWorkspaceCriteria("investor_relations", "LENDER");
  assert.equal(investorRelations.disabledByPolicy, false);
  assert.ok(investorRelations.guardrails.some(value => /optional.*fund-finance workflow/i.test(value)));
  assert.ok(investorRelations.guardrails.some(value => /separate from debt lenders|separate from.*debt/i.test(value)));
});

test("criteria rejects cross-workspace, cross-mode and malformed values", () => {
  const criteria = getDefaultWorkspaceCriteria("property_loans", "LENDER");
  assert.throws(() => validateWorkspaceCriteria(criteria, "commercial_land", "LENDER"), /does not match/);
  assert.throws(() => validateWorkspaceCriteria(criteria, "property_loans", "CUSTOMER"), /does not match/);
  assert.throws(() => validateWorkspaceCriteria({ ...criteria, requiredFields: [] }, "property_loans", "LENDER"), /requiredFields/);
  assert.throws(() => validateWorkspaceCriteria({ ...criteria, preferredFields: "turnover" }, "property_loans", "LENDER"), /preferredFields/);
  assert.throws(() => validateWorkspaceCriteria({ ...criteria, sourceRequiredFields: ["private_credit_score"] }, "property_loans", "LENDER"), /final required or preferred/);
});

test("workspace E11 criteria can be passed directly to the deterministic scorer without invented thresholds", () => {
  const defaults = getDefaultWorkspaceCriteria("property_loans", "LENDER");
  const configured = validateWorkspaceCriteria({
    ...defaults,
    matchCriteria: {
      geography: { value: ["Karnataka"], weight: 2 },
      type: { value: ["bank", "nbfc"], weight: 3, required: true },
      ticket: { value: { min: 5000000, max: 50000000 }, weight: 2 },
      evidence_freshness: { maxAgeDays: 60, weight: 1 }
    }
  }, "property_loans", "LENDER");
  const candidate = {
    geography: ["Karnataka"],
    type: "bank",
    ticket: { min: 10000000, max: 30000000 }
  };
  const evidence = [{
    evidence_id: "evidence-1",
    source_id: "source-1",
    source_published_at: "2026-11-20T00:00:00Z"
  }];
  const result = scoreDiscoveryMatch({
    candidate,
    criteria: getE11MatchCriteria(configured),
    evidence,
    now: "2026-11-24T00:00:00Z"
  });
  assert.equal(result.score, 100);
  assert.equal(result.eligible, true);
  assert.equal(result.components.length, 4);
  assert.equal(scoreDiscoveryMatch({ candidate, criteria: getE11MatchCriteria(defaults), evidence }).components.length, 0);
});

test("search hints derive from workspace targets and bounded user filters without generating contacts", () => {
  const criteria = getDefaultWorkspaceCriteria("property_loans", "LENDER");
  assert.deepEqual(buildDiscoveryQueryHints(criteria, { location: "Karnataka", product: "LAP" }).slice(0, 2), [
    "bank Karnataka LAP",
    "nbfc Karnataka LAP"
  ]);
  assert.ok(buildDiscoveryQueryHints(criteria).length <= 12);
});
