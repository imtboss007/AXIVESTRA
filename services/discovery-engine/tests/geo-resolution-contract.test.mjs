import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration=await readFile(new URL("../../../supabase/migrations/20261122230000_discovery_geo_resolution.sql",import.meta.url),"utf8");
const worker=await readFile(new URL("../../discovery-worker/geo-resolution-worker.mjs",import.meta.url),"utf8");
const photon=await readFile(new URL("../../discovery-worker/photon-client.mjs",import.meta.url),"utf8");
const normalizer=await readFile(new URL("../../discovery-worker/geo-resolution.mjs",import.meta.url),"utf8");

test("E09 stores source-backed place candidates and review receipts",()=>{
 for(const table of ["discovery_geo_resolution_jobs","discovery_place_candidates","discovery_place_resolution_events"])
   assert.ok(migration.includes("create table if not exists public."+table),table+" missing");
 assert.match(migration,/after insert on public\.discovery_extraction_runs/);
 assert.match(migration,/source_span jsonb not null/);
 assert.match(migration,/review_state text not null default 'pending_review'/);
 assert.match(migration,/place_resolution_review_recorded/);
});

test("E09 queue requires unchanged source schema, approved source, succeeded profile job and worker grant",()=>{
 assert.match(migration,/s\.field_schema=j\.field_schema_snapshot/);
 assert.match(migration,/s\.allowed_fields=j\.allowed_fields_snapshot/);
 assert.match(migration,/wc\.enabled=true/);
 assert.match(migration,/wc\.expires_at>v_now/);
 assert.match(migration,/dj\.status='succeeded'/);
 assert.match(migration,/p\.enabled=true/);
});

test("E09 stores coordinates separately from provider candidates and ownership evidence",()=>{
 assert.match(migration,/source_coordinates jsonb/);
 assert.match(migration,/provider_candidates jsonb/);
 assert.match(migration,/source_coordinate_confidence numeric/);
 assert.match(migration,/foreign key \(company_id,extraction_run_id,extracted_entity_id\)/);
 assert.match(migration,/on delete set null/);
 assert.match(normalizer,/geocoding_is_not_ownership_evidence: true/);
});

test("E09 person entities are excluded and coordinates require valid ranges and pairs",()=>{
 assert.match(normalizer,/\["organization", "location"\]/);
 assert.match(migration,/v_lat < -90 or v_lat > 90 or v_lon < -180 or v_lon > 180/);
 assert.match(migration,/source coordinate state requires both coordinates/);
});

test("E09 Photon adapter is self-configured, bounded and attribution-aware",()=>{
 assert.match(worker,/DISCOVERY_PHOTON_ENABLED/);
 assert.match(worker,/allowed_purposes/);
 assert.match(photon,/redirect: "error"/);
 assert.match(photon,/https:/);
 assert.match(photon,/boundedLimit/);
 assert.match(photon,/© OpenStreetMap contributors/);
 assert.doesNotMatch(worker,/nominatim\.openstreetmap\.org|photon\.komoot\.io/);
});

test("E09 review is owner/admin-only and does not preserve address text in audit snapshots",()=>{
 assert.match(migration,/Only a company owner or admin can review place candidates/);
 assert.match(migration,/candidate_snapshot/);
 assert.match(migration,/candidateState/);
 assert.match(migration,/coordinateState/);
 assert.doesNotMatch(migration,/candidate_snapshot\s*=\s*.*address_components/is);
});
