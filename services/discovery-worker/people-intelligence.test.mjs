import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPublicPersonRoleCandidates,
  isApprovedRoleField,
  normalizePublicRoleTitle,
  sourceRowGroupKey
} from "./people-intelligence.mjs";

const person = {
  id: "person-1",
  entity_kind: "person",
  raw_name: "Jane Example",
  normalized_name: "Jane Example",
  confidence: 0.91,
  source_span: {
    kind: "html-table-cell",
    locator: "table:nth-of-type(1) tr:nth-of-type(4) td:nth-of-type(2)",
    row: 4, column: 2
  }
};
const roleFact = {
  extracted_entity_id: null,
  field_name: "designation",
  raw_value: "Chief Financial Officer",
  normalized_value: "Chief Financial Officer",
  validation_status: "valid",
  source_span: {
    kind: "html-table-cell",
    locator: "table:nth-of-type(1) tr:nth-of-type(4) td:nth-of-type(3)",
    row: 4, column: 3
  }
};

test("E07 normalises explicit public role titles without deriving a role from a name", () => {
  assert.equal(normalizePublicRoleTitle("  Chief   Financial Officer "), "Chief Financial Officer");
  assert.equal(isApprovedRoleField("director_designation"), true);
  assert.equal(isApprovedRoleField("private_phone"), false);
  assert.equal(isApprovedRoleField("date_of_birth"), false);
});

test("E07 recognises a source row only for supported deterministic locators", () => {
  assert.equal(sourceRowGroupKey(person.source_span), "html:1:4");
  assert.equal(sourceRowGroupKey({kind:"csv-cell",row:9,column:2}), "csv:9");
  assert.equal(sourceRowGroupKey({kind:"json-pointer",locator:"$/records/2/directors/0/name"}), "json:$/records/2");
  assert.equal(sourceRowGroupKey({kind:"pdf-text-item",page:1,itemIndex:3}), null);
});

test("E07 links an explicit public role to the one company assigned in the extraction run", () => {
  const result = buildPublicPersonRoleCandidates({
    personMentions: [person],
    extractedFacts: [roleFact],
    companyAssignments: [{
      extracted_entity_id: "company-mention-1",
      canonical_entity_id: "company-1",
      jurisdiction: "IN",
      source_span: {kind:"html-table-cell",locator:"table:nth-of-type(1) tr:nth-of-type(4) th:nth-of-type(1)",row:4,column:1}
    }],
    targetCanonicalEntityId: "company-1"
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].person_name, "Jane Example");
  assert.equal(result[0].role_title, "Chief Financial Officer");
  assert.equal(result[0].association_method, "same_source_row");
  assert.equal(result[0].rationale.auto_link_permitted, false);
  assert.equal(result[0].rationale.human_review_required, true);
  assert.equal(result[0].rationale.personal_contact_details_collected, false);
});

test("E07 does not associate a person from a different source row", () => {
  const result = buildPublicPersonRoleCandidates({
    personMentions: [person],
    extractedFacts: [roleFact],
    companyAssignments: [{
      extracted_entity_id: "company-mention-2",
      canonical_entity_id: "company-1",
      jurisdiction: "IN",
      source_span: {kind:"html-table-cell",locator:"table:nth-of-type(1) tr:nth-of-type(3) th:nth-of-type(1)",row:3,column:1}
    }],
    targetCanonicalEntityId: "company-1"
  });
  assert.deepEqual(result, []);
});

test("E07 refuses ambiguous same-row people and multi-company run associations", () => {
  const secondPerson = {...person,id:"person-2",raw_name:"John Example"};
  const ambiguousPeople = buildPublicPersonRoleCandidates({
    personMentions: [person,secondPerson],
    extractedFacts: [roleFact],
    companyAssignments: [{
      extracted_entity_id:"company-1",canonical_entity_id:"company-1",jurisdiction:"IN",
      source_span:{kind:"html-table-cell",locator:"table:nth-of-type(1) tr:nth-of-type(4) th:nth-of-type(1)",row:4,column:1}
    }],
    targetCanonicalEntityId:"company-1"
  });
  assert.deepEqual(ambiguousPeople, []);

  const multiCompany = buildPublicPersonRoleCandidates({
    personMentions: [{...person,source_span:{kind:"pdf-text-item",page:1,itemIndex:2}}],
    extractedFacts: [{...roleFact,source_span:{kind:"pdf-text-item",page:1,itemIndex:3}}],
    companyAssignments: [
      {canonical_entity_id:"company-1",jurisdiction:"IN",source_span:{}},
      {canonical_entity_id:"company-2",jurisdiction:"IN",source_span:{}}
    ],
    targetCanonicalEntityId:"company-1"
  });
  assert.deepEqual(multiCompany, []);
});

test("E07 ignores non-person mentions and never reads private contact fields", () => {
  const result = buildPublicPersonRoleCandidates({
    personMentions: [{...person,entity_kind:"organization"}],
    extractedFacts: [
      roleFact,
      {...roleFact,field_name:"private_email",raw_value:"private@example.test",normalized_value:"private@example.test"}
    ],
    companyAssignments:[{
      canonical_entity_id:"company-1",jurisdiction:"IN",source_span:person.source_span
    }],
    targetCanonicalEntityId:"company-1"
  });
  assert.equal(result.length,0);
});

test("E07 emits no candidate without an explicit public role field", () => {
  const result = buildPublicPersonRoleCandidates({
    personMentions:[person],
    extractedFacts:[{...roleFact,field_name:"private_note"}],
    companyAssignments:[{
      canonical_entity_id:"company-1",jurisdiction:"IN",source_span:person.source_span
    }],
    targetCanonicalEntityId:"company-1"
  });
  assert.deepEqual(result,[]);
});
