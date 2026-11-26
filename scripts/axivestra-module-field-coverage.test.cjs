const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const workbench = fs.readFileSync(path.join(root, "src", "ModuleWorkbench.tsx"), "utf8");
const moduleFieldsStart = app.indexOf("const moduleFields: Record<string, ModuleField[]> = {");
const moduleFieldsEnd = app.indexOf("\ntype ModuleContactField", moduleFieldsStart);
assert.ok(moduleFieldsStart >= 0 && moduleFieldsEnd > moduleFieldsStart, "Existing module field map must remain in App.tsx");
const source = app.slice(moduleFieldsStart, moduleFieldsEnd);

const requiredByModule = {
  "Property Sale": ["dueDiligenceStatus","paymentMilestones"],
  "Agricultural Land": ["encumbranceStatus","ownershipVerificationStatus"],
  "Commercial Land": ["occupancyStatus","leaseExpiryDate","accessAndUtilities"],
  "JV / JDA / JD": ["otherPartners","requiredApprovals","financialCommitments"],
  "SR Rate Settlement": ["approvalAuthority","actualSettlementDate"],
  "Property Loans": ["collateralDescription","loanTenureMonths","repaymentFrequency","nextRepaymentDate"],
  "Unsecured Company Loan": ["outstandingBalance","nextRepaymentDate","repaymentScheduleReference"],
  "Personal Loan": ["outstandingBalance","maturityDate","repaymentStatus"],
  "Housing Loan": ["collateralDescription","repaymentFrequency","nextRepaymentDate"],
  "House Purchase": ["paymentMilestones","possessionStatus"],
  "Startup": ["useOfFunds","investorCommitmentSummary"],
  "Equity": ["costBasis","valuationSource","valuationAsOfDate","liquidityStatus"],
  "Fund & Portfolio Management": ["paidInCapital","capitalCalls","distributions","navAsOfDate","navSource"],
  "Investor Relations": ["investmentMandate","preferredSectors","targetGeography","minimumTicket","maximumTicket","pastInvestmentSummary","publicSourceUrl","sourceLastVerifiedDate"],
  "Litigation": ["filingDate","latestOrderReference"],
  "Compliance & KYC": ["screeningSource","lastScreenedDate","reviewerRationale","remediationAction"]
};

for (const [moduleName, keys] of Object.entries(requiredByModule)) {
  const marker = '"' + moduleName + '": [';
  const start = source.indexOf(marker);
  assert.ok(start >= 0, "Missing existing workspace: " + moduleName);
  const end = source.indexOf("\n  ]", start);
  assert.ok(end > start, "Malformed module field list: " + moduleName);
  const block = source.slice(start, end);
  const keyMatches = [...block.matchAll(/key:\s*"([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(keyMatches).size, keyMatches.length, "Duplicate field keys in " + moduleName);
  for (const key of keys) assert.ok(keyMatches.includes(key), moduleName + " missing " + key);
}

assert.match(workbench,/moduleData\?\.[\s\S]*?__linkedContactIds|moduleData/, "Existing module workbench must continue to use existing record data.");
assert.match(app,/field\.type===\"number\"[\s\S]*?IndianAmountInput/, "INR module fields must keep Indian amount parsing.");
assert.match(app,/moduleData:\{\.\.\.previous\.moduleData,\[field\.key\]:event\.target\.value\}/, "New optional fields must persist in existing moduleData.");
assert.match(app,/const moduleFields: Record<string, ModuleField\[\]> = \{/, "No replacement form architecture should be introduced.");
console.log("AXIVESTRA 16-workspace field coverage contract passed (52 additive fields).");
