import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadEnrichmentInputs } from "./enrichment-worker.mjs";

const worker=await readFile(new URL("./enrichment-worker.mjs",import.meta.url),"utf8");
function mockAdmin({run,evidence,source,entities,facts,assignments,canonicalEntities=[]}){
  return {
    from(table){
      const query={
        select(){return query;},eq(){return query;},in(){return query;},
        async maybeSingle(){
          return {data:table==="discovery_extraction_runs"?run:
            table==="discovery_evidence_items"?evidence:source,error:null};
        },
        then(resolve){
          const data=table==="discovery_extracted_entities"?entities:
            table==="discovery_extracted_facts"?facts:
            table==="discovery_entity_assignments"?assignments:canonicalEntities;
          return Promise.resolve({data,error:null}).then(resolve);
        }
      };
      return query;
    }
  };
}
const job={
  company_id:"company-1",extraction_run_id:"run-1",evidence_id:"evidence-1",source_id:"source-1",
  field_schema_snapshot:{annual_revenue:{type:"currency"}},
  allowed_fields_snapshot:["annual_revenue"]
};
const run={id:"run-1",evidence_id:"evidence-1",source_id:"source-1",status:"completed",
  source_content_hash:"a".repeat(64),completed_at:"2026-01-03T01:00:00Z"};
const evidence={id:"evidence-1",content_hash:"a".repeat(64),captured_at:"2026-01-03T00:00:00Z",
  source_published_at:"2026-01-01T00:00:00Z"};
const source={id:"source-1",name:"Annual report",domain:"reports.example",jurisdiction:"IN",
  status:"approved",allowed_fields:["annual_revenue"],field_schema:job.field_schema_snapshot,
  allowed_purposes:["enrichment"],attribution:"Annual report",license_ref:"public disclosure"};
const entities=[{id:"mention-1",entity_kind:"organization",raw_name:"Acme"}];
const facts=[{id:"fact-1",extracted_entity_id:"mention-1",field_name:"annual_revenue",value_type:"currency",
  raw_value:"₹12 crore",normalized_value:{amount:120000000,currency:"INR"},validation_status:"valid",
  source_span:{kind:"json-pointer",locator:"$/annual_revenue"},confidence:0.97}];
const assignments=[{extracted_entity_id:"mention-1",canonical_entity_id:"canonical-1"}];
const canonicalEntities=[{id:"canonical-1",entity_kind:"organization",status:"active",legal_name:"Acme"}];

test("E10 worker requires enrichment purpose, unchanged source schema and E06 assignment",async()=>{
  const result=await loadEnrichmentInputs(mockAdmin({
    run,evidence,source,entities,facts,assignments,canonicalEntities
  }),job);
  assert.equal(result.candidates.length,1);
  assert.equal(result.candidates[0].canonical_entity_id,"canonical-1");
  assert.equal(result.candidates[0].source_published_at,evidence.source_published_at);
});

test("E10 worker fails closed when source is paused or field schema changes",async()=>{
  await assert.rejects(loadEnrichmentInputs(mockAdmin({
    run,evidence,source:{...source,status:"paused"},entities,facts,assignments,canonicalEntities
  }),job),/source approval, enrichment purpose or exact field schema changed/);
  await assert.rejects(loadEnrichmentInputs(mockAdmin({
    run,evidence,source:{...source,field_schema:{}},entities,facts,assignments,canonicalEntities
  }),job),/source approval, enrichment purpose or exact field schema changed/);
  await assert.rejects(loadEnrichmentInputs(mockAdmin({
    run,evidence,source:{...source,allowed_purposes:["company identity verification"]},
    entities,facts,assignments,canonicalEntities
  }),job),/source approval, enrichment purpose or exact field schema changed/);
});

test("E10 worker creates no observations without owner-reviewed E06 canonical assignment",async()=>{
  const result=await loadEnrichmentInputs(mockAdmin({
    run,evidence,source,entities,facts,assignments:[],canonicalEntities
  }),job);
  assert.equal(result.candidates.length,0);
});

test("E10 worker makes no provider/network calls and does not handle contact fields",()=>{
  assert.doesNotMatch(worker,/fetch\s*\(/);
  assert.doesNotMatch(worker,/axios|got\(|https?\.request/);
  assert.doesNotMatch(worker,/email|phone|consent_state/i);
});
