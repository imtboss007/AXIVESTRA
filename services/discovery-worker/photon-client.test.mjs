import test from "node:test";
import assert from "node:assert/strict";
import { createPhotonClient, enrichPlaceWithPhoton, normalizePhotonFeatures } from "./photon-client.mjs";

const geoJson = {
  features:[{
    geometry:{type:"Point",coordinates:[77.5946,12.9716]},
    properties:{
      name:"Bengaluru",street:"Industrial Road",housenumber:"12",postcode:"560001",
      city:"Bengaluru",state:"Karnataka",country:"India",countrycode:"IN",
      osm_type:"W",osm_id:12345,type:"city"
    }
  }]
};

test("E09 Photon client requires an explicit configured endpoint and identifies AXIVESTRA", async () => {
  assert.throws(()=>createPhotonClient({baseUrl:""}),/absolute URL/);
  assert.throws(()=>createPhotonClient({baseUrl:"http://example.com"}),/must use HTTPS/);
  let requested;
  const client=createPhotonClient({
    baseUrl:"http://localhost:2322/",
    fetchImpl:async (url,options)=>{
      requested={url:String(url),options};
      return {ok:true,json:async()=>geoJson};
    }
  });
  const features=await client.search({formatted:"12 Industrial Road, Bengaluru"},99);
  assert.equal(features.length,1);
  assert.match(requested.url,/\/api\?q=/);
  assert.match(requested.url,/limit=5/);
  assert.equal(requested.options.redirect,"error");
  assert.match(requested.options.headers["User-Agent"],/AXIVESTRA/);
});

test("E09 refuses the public Photon demo endpoint", () => {
  assert.throws(()=>createPhotonClient({baseUrl:"https://photon.komoot.io"}),/self-hosted Photon instance/);
});

test("E09 validates reverse coordinates before provider calls", async () => {
  const client=createPhotonClient({baseUrl:"http://localhost:2322/",fetchImpl:async()=>({ok:true,json:async()=>geoJson})});
  await assert.rejects(client.reverse(91,77),/valid latitude and longitude/);
});

test("E09 provider results retain OSM attribution and expose bounded match evidence", () => {
  const results=normalizePhotonFeatures(geoJson.features,{city:"Bengaluru",country:"India"});
  assert.equal(results.length,1);
  assert.equal(results[0].latitude,12.9716);
  assert.equal(results[0].longitude,77.5946);
  assert.equal(results[0].attribution,"© OpenStreetMap contributors");
  assert.equal(results[0].component_match_score,1);
});

test("E09 geocoding is never invoked when source coordinates already exist", async () => {
  let called=false;
  const result=await enrichPlaceWithPhoton({
    source_coordinates:{latitude:12.9,longitude:77.5},
    address:{formatted:"Bengaluru"}
  },{search:async()=>{called=true;return[];}});
  assert.equal(called,false);
  assert.equal(result.source_coordinates.latitude,12.9);
});
