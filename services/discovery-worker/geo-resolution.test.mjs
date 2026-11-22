import test from "node:test";
import assert from "node:assert/strict";
import { buildPlaceCandidates, normalizePlaceAddress, scorePhotonAddressMatch } from "./geo-resolution.mjs";

const entities = [
  { id:"company-1",entity_kind:"organization",raw_name:"AXI Manufacturing Pvt Ltd",source_span:{kind:"json-pointer",locator:"$/company"} },
  { id:"place-1",entity_kind:"location",raw_name:"Registered Office",source_span:{kind:"html-table",row:1} },
  { id:"person-1",entity_kind:"person",raw_name:"Asha Rao",source_span:{kind:"html-table",row:2} }
];
const schema = {
  address_line_1:{type:"string",aliases:["address_line_1"]},
  city:{type:"string",aliases:["city"]},
  state:{type:"string",aliases:["state"]},
  postcode:{type:"string",aliases:["postcode"]},
  country:{type:"string",aliases:["country"]},
  country_code:{type:"string",aliases:["country_code"]},
  latitude:{type:"number",aliases:["latitude"]},
  longitude:{type:"number",aliases:["longitude"]}
};
const facts = [
  {id:"f1",extracted_entity_id:"company-1",field_name:"address_line_1",raw_value:"  12   Industrial Road ",validation_status:"valid",source_span:{kind:"json-pointer",locator:"$/address"}},
  {id:"f2",extracted_entity_id:"company-1",field_name:"city",raw_value:"Bengaluru",validation_status:"valid",source_span:{kind:"json-pointer",locator:"$/city"},confidence:0.98},
  {id:"f3",extracted_entity_id:"company-1",field_name:"state",raw_value:"Karnataka",validation_status:"valid",source_span:{kind:"json-pointer",locator:"$/state"},confidence:0.98},
  {id:"f4",extracted_entity_id:"company-1",field_name:"country",raw_value:"India",validation_status:"valid",source_span:{kind:"json-pointer",locator:"$/country"},confidence:0.97},
  {id:"f5",extracted_entity_id:"company-1",field_name:"country_code",raw_value:"IN",validation_status:"valid",source_span:{kind:"json-pointer",locator:"$/country_code"},confidence:0.97},
  {id:"f6",extracted_entity_id:"company-1",field_name:"latitude",raw_value:"12.9716",validation_status:"valid",source_span:{kind:"json-pointer",locator:"$/lat"},confidence:0.96},
  {id:"f7",extracted_entity_id:"company-1",field_name:"longitude",raw_value:"77.5946",validation_status:"valid",source_span:{kind:"json-pointer",locator:"$/lon"},confidence:0.96},
  {id:"f8",extracted_entity_id:"place-1",field_name:"city",raw_value:"Mysuru",validation_status:"valid",source_span:{kind:"html-table",row:1}}
];

test("E09 normalizes source-backed address components without manufacturing missing parts", () => {
  const address = normalizePlaceAddress({
    line1:"12   Industrial Road",city:" Bengaluru ",state:"Karnataka",country:"India",country_code:"in"
  });
  assert.equal(address.formatted,"12 Industrial Road, Bengaluru, Karnataka, India");
  assert.equal(address.country_code,"IN");
  assert.equal(address.postcode,null);
});

test("E09 uses only approved, source-backed fields and excludes person entities", () => {
  const candidates = buildPlaceCandidates({
    extractedEntities:entities,extractedFacts:facts,
    allowedFields:Object.keys(schema),fieldSchema:schema,evidenceId:"evidence-1"
  });
  assert.equal(candidates.length,2);
  assert.equal(candidates[0].entity_kind,"organization");
  assert.equal(candidates[1].entity_kind,"location");
  assert.equal(candidates.some(item=>item.place_label==="Asha Rao"),false);
});

test("E09 validates coordinate ranges and requires a latitude/longitude pair", () => {
  const candidates = buildPlaceCandidates({
    extractedEntities:[entities[0]],extractedFacts:facts.filter(f=>f.extracted_entity_id==="company-1"),
    allowedFields:Object.keys(schema),fieldSchema:schema,evidenceId:"evidence-1"
  });
  assert.deepEqual(candidates[0].source_coordinates,{latitude:12.9716,longitude:77.5946});
  const incomplete = buildPlaceCandidates({
    extractedEntities:[entities[0]],
    extractedFacts:[{...facts.find(f=>f.field_name==="latitude"),raw_value:"91"}],
    allowedFields:["latitude"],fieldSchema:{latitude:schema.latitude},evidenceId:"evidence-1"
  });
  assert.equal(incomplete[0].coordinate_state,"invalid_or_incomplete_source_coordinates");
  assert.equal(incomplete[0].source_coordinates,null);
});

test("E09 does not infer a country or country code", () => {
  const candidates = buildPlaceCandidates({
    extractedEntities:[entities[1]],
    extractedFacts:[{...facts[7],extracted_entity_id:"place-1"}],
    allowedFields:["city"],fieldSchema:{city:schema.city},evidenceId:"evidence-1"
  });
  assert.equal(candidates[0].address.country,null);
  assert.equal(candidates[0].address.country_code,null);
});

test("E09 exact address component overlap is a transparent ratio, not a probability", () => {
  assert.deepEqual(scorePhotonAddressMatch(
    {city:"Bengaluru",country_code:"IN",postcode:"560001"},
    {city:"Bengaluru",countrycode:"in"}
  ), {score:0.667,matched:2,supplied:3,method:"exact_address_component_overlap_v1"});
});
