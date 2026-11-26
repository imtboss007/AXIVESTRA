import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEnrichmentCandidates, detectPotentialEnrichmentConflicts, getEnrichmentAttribute
} from "./enrichment.mjs";

const entities=[
  {id:"mention-1",entity_kind:"organization",raw_name:"Acme Holdings",source_span:{kind:"json-pointer",locator:"$/company"}},
  {id:"person-1",entity_kind:"person",raw_name:"Asha Rao",source_span:{kind:"json-pointer",locator:"$/person"}}
];
const canonical=[{id:"canonical-1",entity_kind:"organization",status:"active",legal_name:"Acme Holdings"}];
const assignments=[{extracted_entity_id:"mention-1",canonical_entity_id:"canonical-1"}];
const fields=[
  {id:"fact-1",extracted_entity_id:"mention-1",field_name:"annual_revenue",value_type:"currency",
    raw_value:"₹12 crore",normalized_value:{amount:120000000,currency:"INR"},validation_status:"valid",
    confidence:0.97,source_span:{kind:"json-pointer",locator:"$/annual_revenue"}},
  {id:"fact-2",extracted_entity_id:"mention-1",field_name:"employee_count",value_type:"number",
    raw_value:"420",normalized_value:420,validation_status:"valid",confidence:0.93,
    source_span:{kind:"json-pointer",locator:"$/employees"}},
  {id:"fact-3",extracted_entity_id:"person-1",field_name:"annual_revenue",value_type:"currency",
    raw_value:"₹1 crore",normalized_value:{amount:10000000,currency:"INR"},validation_status:"valid",
    confidence:0.9,source_span:{kind:"json-pointer",locator:"$/person/revenue"}},
  {id:"fact-4",extracted_entity_id:"mention-1",field_name:"work_email",value_type:"email",
    raw_value:"finance@acme.example",normalized_value:"finance@acme.example",validation_status:"valid",
    confidence:0.99,source_span:{kind:"json-pointer",locator:"$/email"}},
  {id:"fact-5",extracted_entity_id:"mention-1",field_name:"private_estimate",value_type:"currency",
    raw_value:"100",normalized_value:100,validation_status:"valid",confidence:0.9,
    source_span:{kind:"json-pointer",locator:"$/private"}}
];
const schema={
  annual_revenue:{type:"currency",unit:"INR",currencyCode:"INR"},
  employee_count:{type:"number"},
  work_email:{type:"email"},
  private_estimate:{type:"currency"}
};
const base={
  extractedEntities:entities,extractedFacts:fields,assignments,canonicalEntities:canonical,
  allowedFields:Object.keys(schema),fieldSchema:schema,evidenceId:"evidence-1",
  sourceId:"source-a",sourceName:"Approved annual report",sourceDomain:"reports.example",
  sourceJurisdiction:"IN",sourceAttribution:"Annual report",sourceLicenseRef:"public disclosure",
  sourcePublishedAt:"2026-01-01T00:00:00Z",evidenceCapturedAt:"2026-01-03T00:00:00Z",
  evidenceContentHash:"a".repeat(64),extractionCompletedAt:"2026-01-03T01:00:00Z"
};

test("E10 extracts only approved, source-backed fields from E06-assigned canonical companies",()=>{
  const result=buildEnrichmentCandidates(base);
  assert.equal(result.length,2);
  assert.deepEqual(result.map(item=>item.attribute_category),["finance","operating"]);
  assert.equal(result[0].canonical_entity_id,"canonical-1");
  assert.deepEqual(result[0].normalized_value,{amount:120000000,currency:"INR"});
  assert.equal(result[0].source_unit,"INR");
  assert.equal(result[0].source_published_at,"2026-01-01T00:00:00Z");
  assert.equal(result[0].evidence_content_hash,"a".repeat(64));
});

test("E10 never reinterprets, converts or selects currency, unit or period values",()=>{
  const result=buildEnrichmentCandidates(base)[0];
  assert.equal(result.raw_value,"₹12 crore");
  assert.equal(result.currency_code,"INR");
  assert.equal(result.normalized_value.amount,120000000);
  assert.equal(result.normalized_value.currency,"INR");
});

test("E10 ignores invalid, unapproved, unregistered, person-level and unassigned facts",()=>{
  const result=buildEnrichmentCandidates({
    ...base,
    assignments:[],
    extractedFacts:fields
  });
  assert.equal(result.length,0);
  const noContact=buildEnrichmentCandidates({
    ...base,
    extractedFacts:[fields[3]]
  });
  assert.equal(noContact.length,0);
  const invalid=buildEnrichmentCandidates({
    ...base,
    extractedFacts:[{...fields[0],validation_status:"invalid"}]
  });
  assert.equal(invalid.length,0);
});

test("E10 attribute taxonomy separates business, finance, property and operating fields",()=>{
  assert.equal(getEnrichmentAttribute("incorporation_date").category,"business");
  assert.equal(getEnrichmentAttribute("annual_revenue").category,"finance");
  assert.equal(getEnrichmentAttribute("plot_area").category,"property");
  assert.equal(getEnrichmentAttribute("employee_count").category,"operating");
  assert.equal(getEnrichmentAttribute("work_email"),null);
  assert.equal(getEnrichmentAttribute("guessed_private_rating"),null);
});

test("E10 taxonomy supports source-backed lender/customer matching attributes without adding personal data", () => {
  for (const field of [
    "sector", "lender_category", "borrower_type", "institution_type",
    "capital_instrument", "funding_instrument", "collateral_type",
    "eligible_collateral", "startup_stage", "project_stage",
    "investment_mandate", "geography", "country", "state", "city", "district",
    "minimum_ticket_size", "maximum_ticket_size",
    "institution_name", "registration_status", "source_as_of_date", "registered_office_address",
    "certificate_status", "legal_name", "registration_id", "registered_state"
  ]) {
    assert.ok(getEnrichmentAttribute(field), field + " must be a registered source-backed business attribute");
  }
  assert.equal(getEnrichmentAttribute("personal_credit_score"), null);
  assert.equal(getEnrichmentAttribute("personal_income"), null);
});

test("E10 records potential disagreements across independent sources without collapsing timestamps",()=>{
  const incoming={
    canonical_entity_id:"canonical-1",attribute_key:"annual_revenue",
    normalized_value:{amount:120000000,currency:"INR"},source_id:"source-b",
    source_published_at:"2026-01-01T00:00:00Z",evidence_captured_at:"2026-01-04T00:00:00Z"
  };
  const previous={
    id:"candidate-a",canonical_entity_id:"canonical-1",attribute_key:"annual_revenue",
    normalized_value:{amount:100000000,currency:"INR"},source_id:"source-a",
    source_published_at:"2025-12-31T00:00:00Z",evidence_captured_at:"2026-01-02T00:00:00Z"
  };
  const conflict=detectPotentialEnrichmentConflicts(incoming,[previous]);
  assert.equal(conflict.length,1);
  assert.equal(conflict[0].conflict_kind,"potential_value_disagreement");
  assert.equal(conflict[0].first_published_at,"2025-12-31T00:00:00Z");
  assert.equal(conflict[0].second_captured_at,"2026-01-04T00:00:00Z");
  assert.equal(detectPotentialEnrichmentConflicts(incoming,[{
    ...previous,source_id:"source-b"
  }]).length,0);
  assert.equal(detectPotentialEnrichmentConflicts({
    ...incoming,normalized_value:{amount:100000000,currency:"INR"}
  },[previous]).length,0);
});
