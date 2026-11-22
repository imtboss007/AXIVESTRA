import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildPublicPersonRoleCandidates } from "./people-intelligence.mjs";

const worker=await readFile(new URL("./people-intelligence-worker.mjs",import.meta.url),"utf8");
const migration=await readFile(new URL("../../supabase/migrations/20261122210000_discovery_people_intelligence.sql",import.meta.url),"utf8");

test("E07 worker is disabled by default and requires the server-only service role",()=>{
  assert.match(worker,/DISCOVERY_PUBLIC_PERSON_ROLE_WORKER_ENABLED!=="true"/);
  assert.match(worker,/SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(worker,/claim_discovery_public_person_role_job/);
});

test("E07 worker fetches only fixed public role fields, not personal contact details",()=>{
  assert.match(worker,/ROLE_FIELDS/);
  assert.match(worker,/\.in\("field_name",ROLE_FIELDS\)/);
  assert.doesNotMatch(worker,/\.in\("field_name",[^)]*(email|phone|address|dob|birth|pan)/i);
  assert.doesNotMatch(worker,/from\("discovery_extracted_facts"\)[\s\S]{0,240}\.select\("\*"\)/);
});

test("E07 writes pending candidates only and has no canonical person or private-contact write path",()=>{
  assert.match(worker,/complete_discovery_public_person_roles/);
  assert.doesNotMatch(worker,/insert into public\.discovery_canonical_people/i);
  assert.doesNotMatch(worker,/insert into public\.discovery_contacts/i);
  assert.match(migration,/Only a company owner or admin can review public person roles/);
});

test("E07 candidate generation remains evidence-bound and non-automatic",()=>{
  const candidate=buildPublicPersonRoleCandidates({
    personMentions:[{
      id:"person-1",entity_kind:"person",raw_name:"Jane Example",
      source_span:{kind:"html-table-cell",locator:"table:nth-of-type(1) tr:nth-of-type(2) td:nth-of-type(1)"},
      confidence:0.9
    }],
    extractedFacts:[{
      field_name:"designation",raw_value:"Director",normalized_value:"Director",
      validation_status:"valid",source_span:{kind:"html-table-cell",locator:"table:nth-of-type(1) tr:nth-of-type(2) td:nth-of-type(2)"}
    }],
    companyAssignments:[{
      extracted_entity_id:"company-1",canonical_entity_id:"canonical-1",
      source_span:{kind:"html-table-cell",locator:"table:nth-of-type(1) tr:nth-of-type(2) th:nth-of-type(1)"},
      jurisdiction:"IN"
    }],
    targetCanonicalEntityId:"canonical-1"
  })[0];
  assert.ok(candidate);
  assert.equal(candidate.rationale.auto_link_permitted,false);
  assert.equal(candidate.rationale.personal_contact_details_collected,false);
});
