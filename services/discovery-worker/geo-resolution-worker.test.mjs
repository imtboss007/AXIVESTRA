import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadGeoResolutionInputs } from "./geo-resolution-worker.mjs";

const worker=await readFile(new URL("./geo-resolution-worker.mjs",import.meta.url),"utf8");

function mockAdmin({run,evidence,source,entities,facts}) {
  return {
    from(table) {
      const query={
        select(){return query;},eq(){return query;},in(){return query;},
        async maybeSingle(){
          return {data:table==="discovery_extraction_runs"?run:
            table==="discovery_evidence_items"?evidence:source,error:null};
        },
        then(resolve){
          return Promise.resolve({data:table==="discovery_extracted_entities"?entities:facts,error:null}).then(resolve);
        }
      };
      return query;
    }
  };
}
const job={
  company_id:"company-1",extraction_run_id:"run-1",evidence_id:"evidence-1",source_id:"source-1",
  field_schema_snapshot:{city:{type:"string",aliases:["city"]}},
  allowed_fields_snapshot:["city"]
};
const run={id:"run-1",evidence_id:"evidence-1",source_id:"source-1",status:"completed",source_content_hash:"a".repeat(64)};
const evidence={id:"evidence-1",content_hash:"a".repeat(64)};
const source={id:"source-1",status:"approved",allowed_fields:["city"],field_schema:job.field_schema_snapshot,allowed_purposes:["company location normalization"]};
const entities=[{id:"entity-1",entity_kind:"organization",raw_name:"Acme",source_span:{kind:"html"}}];
const facts=[{id:"fact-1",extracted_entity_id:"entity-1",field_name:"city",value_type:"string",raw_value:"Bengaluru",validation_status:"valid",source_span:{kind:"json-pointer",locator:"$/city"},confidence:0.95}];

test("E09 worker normalizes only source-approved, source-backed company/location facts",async()=>{
 const result=await loadGeoResolutionInputs(mockAdmin({run,evidence,source,entities,facts}),job);
 assert.equal(result.candidates.length,1);
 assert.equal(result.candidates[0].address.city,"Bengaluru");
 assert.equal(result.photonUsed,false);
});

test("E09 worker fails closed on source pause or schema change",async()=>{
 await assert.rejects(loadGeoResolutionInputs(mockAdmin({
   run,evidence,source:{...source,status:"paused"},entities,facts
 }),job),/source approval or exact location-field schema changed/);
 await assert.rejects(loadGeoResolutionInputs(mockAdmin({
   run,evidence,source:{...source,field_schema:{}},entities,facts
 }),job),/source approval or exact location-field schema changed/);
});

test("E09 will not call Photon unless source purpose explicitly includes geocoding",async()=>{
 let called=false;
 const photon={search:async()=>{called=true;return[];}};
 const result=await loadGeoResolutionInputs(mockAdmin({run,evidence,source,entities,facts}),job,photon);
 assert.equal(called,false);
 assert.equal(result.photonUsed,false);
});

test("E09 may call Photon only when both switches and source purpose are explicit",async()=>{
 let called=false;
 const geocodingSource={...source,allowed_purposes:["company location normalization","geocoding"]};
 const photon={search:async address=>{
   called=true;
   assert.equal(address.formatted,"Bengaluru");
   return [];
 }};
 const result=await loadGeoResolutionInputs(mockAdmin({
   run,evidence,source:geocodingSource,entities,facts
 }),job,photon);
 assert.equal(called,true);
 assert.equal(result.photonUsed,true);
 assert.equal(result.candidates[0].provider,"photon_self_hosted");
 assert.equal(result.candidates[0].candidate_state,"geocoder_no_match");
});

test("E09 worker has no unrestricted URL crawling or person address enrichment",()=>{
 assert.doesNotMatch(worker,/fetch\s*\(/);
 assert.doesNotMatch(worker,/person-level|person.*geocod/i);
});
