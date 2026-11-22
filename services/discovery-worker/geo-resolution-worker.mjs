import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { buildPlaceCandidates } from "./geo-resolution.mjs";
import { createPhotonClient, enrichPlaceWithPhoton } from "./photon-client.mjs";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("Missing E09 worker environment variable: " + name);
  return value;
}

function createAdmin() {
  return createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { "X-AXIVESTRA-Worker": "discovery-geo-resolution-worker" } }
  });
}

export async function loadGeoResolutionInputs(admin, job, photonClient = null) {
  const [runResult,evidenceResult,sourceResult,entitiesResult,factsResult] = await Promise.all([
    admin.from("discovery_extraction_runs")
      .select("id,evidence_id,source_id,status,source_content_hash")
      .eq("company_id",job.company_id).eq("id",job.extraction_run_id).maybeSingle(),
    admin.from("discovery_evidence_items")
      .select("id,content_hash")
      .eq("company_id",job.company_id).eq("id",job.evidence_id).maybeSingle(),
    admin.from("discovery_source_registry")
      .select("id,status,allowed_fields,field_schema,allowed_purposes")
      .eq("company_id",job.company_id).eq("id",job.source_id).maybeSingle(),
    admin.from("discovery_extracted_entities")
      .select("id,entity_kind,raw_name,normalized_name,source_span")
      .eq("company_id",job.company_id).eq("extraction_run_id",job.extraction_run_id)
      .in("entity_kind",["organization","location"]),
    admin.from("discovery_extracted_facts")
      .select("id,extracted_entity_id,field_name,value_type,raw_value,normalized_value,validation_status,source_span,confidence")
      .eq("company_id",job.company_id).eq("extraction_run_id",job.extraction_run_id)
  ]);
  for (const result of [runResult,evidenceResult,sourceResult,entitiesResult,factsResult]) {
    if (result.error) throw new Error("E09 input query failed: "+result.error.message);
  }
  const run=runResult.data, evidence=evidenceResult.data, source=sourceResult.data;
  if (!run || !evidence || !source || run.evidence_id!==evidence.id ||
      run.source_id!==job.source_id || run.source_content_hash!==evidence.content_hash ||
      !["completed","completed_with_warnings"].includes(run.status)) {
    throw new Error("E09 extraction run does not match immutable source evidence.");
  }
  if (source.status!=="approved" ||
      JSON.stringify(source.field_schema||{})!==JSON.stringify(job.field_schema_snapshot||{}) ||
      JSON.stringify(source.allowed_fields||[])!==JSON.stringify(job.allowed_fields_snapshot||[])) {
    throw new Error("E09 source approval or exact location-field schema changed; refusing geo processing.");
  }
  let candidates=buildPlaceCandidates({
    extractedEntities:entitiesResult.data||[],
    extractedFacts:factsResult.data||[],
    allowedFields:job.allowed_fields_snapshot||[],
    fieldSchema:job.field_schema_snapshot||{},
    evidenceId:evidence.id
  });
  const photonPermitted=Boolean(
    photonClient && Array.isArray(source.allowed_purposes) &&
    source.allowed_purposes.some(purpose=>String(purpose).trim().toLowerCase()==="geocoding")
  );
  if (photonPermitted) {
    candidates=[];
    const baseCandidates=buildPlaceCandidates({
      extractedEntities:entitiesResult.data||[],
      extractedFacts:factsResult.data||[],
      allowedFields:job.allowed_fields_snapshot||[],
      fieldSchema:job.field_schema_snapshot||{},
      evidenceId:evidence.id
    });
    for (const candidate of baseCandidates) {
      candidates.push(await enrichPlaceWithPhoton(candidate,photonClient));
    }
  }
  if(candidates.length>500) throw new Error("E09 place candidate count exceeds the approved batch limit.");
  return { candidates, photonUsed:photonPermitted && candidates.some(c=>c.provider==="photon_self_hosted") };
}

export async function runGeoResolutionWorkerOnce(admin,workerId,photonClient=null) {
  const {data:claimed,error:claimError}=await admin.rpc("claim_discovery_geo_resolution_job",{
    p_worker_id:workerId,p_lease_seconds:90
  });
  if(claimError) throw new Error("Could not claim E09 work: "+claimError.message);
  const job=Array.isArray(claimed)?claimed[0]:claimed;
  if(!job) return false;

  let heartbeatBusy=false,leaseLost=false;
  const heartbeatTimer=setInterval(async()=>{
    if(heartbeatBusy||leaseLost) return;
    heartbeatBusy=true;
    try {
      const {data,error}=await admin.rpc("heartbeat_discovery_geo_resolution_job",{
        p_job_id:job.id,p_worker_id:workerId,p_lease_seconds:90
      });
      if(error||data!==true) leaseLost=true;
    } catch { leaseLost=true; }
    finally { heartbeatBusy=false; }
  },20_000);

  try {
    const input=await loadGeoResolutionInputs(admin,job,photonClient);
    if(leaseLost) throw new Error("E09 lease or source approval was revoked.");
    const {data,error}=await admin.rpc("complete_discovery_geo_resolution_job",{
      p_job_id:job.id,p_worker_id:workerId,p_candidates:input.candidates
    });
    if(error) throw new Error("E09 candidate commit failed: "+error.message);
    if(leaseLost) throw new Error("E09 lease was lost before completion.");
    console.info("AXIVESTRA E09 place candidates recorded:",JSON.stringify({
      jobId:job.id,candidates:input.candidates.length,
      photonCandidates:input.candidates.reduce((total,candidate)=>total+(candidate.provider_candidates?.length||0),0),
      committedCandidates:data
    }));
  } catch(error) {
    const {error:failError}=await admin.rpc("fail_discovery_geo_resolution_job",{
      p_job_id:job.id,p_worker_id:workerId,
      p_error_code:String(error?.code||"GEO_RESOLUTION_FAILED").slice(0,100),
      p_error_message:String(error?.message||"E09 geo resolution failed.").slice(0,1000)
    });
    if(failError) console.error("Could not record E09 failure:",failError.message);
  } finally {
    clearInterval(heartbeatTimer);
  }
  return true;
}

export async function runGeoResolutionWorker() {
  if(process.env.DISCOVERY_GEO_RESOLUTION_WORKER_ENABLED!=="true") {
    console.info("AXIVESTRA E09 geo-resolution worker disabled by default.");
    return;
  }
  let photonClient=null;
  if(process.env.DISCOVERY_PHOTON_ENABLED==="true") {
    photonClient=createPhotonClient({
      baseUrl:requiredEnv("PHOTON_BASE_URL"),
      userAgent:process.env.AXIVESTRA_GEO_USER_AGENT||"AXIVESTRA-GeoResolution/1.0"
    });
  }
  const admin=createAdmin();
  const workerId=process.env.AXIVESTRA_GEO_RESOLUTION_WORKER_ID||
    ("axivestra-geo-resolution-"+randomUUID());
  const pollMs=Math.max(1000,Math.min(30_000,Number(process.env.DISCOVERY_GEO_RESOLUTION_POLL_MS||5000)));
  let stopping=false;
  process.once("SIGINT",()=>{stopping=true;});
  process.once("SIGTERM",()=>{stopping=true;});
  console.info("AXIVESTRA E09 deterministic geo worker started; Photon is",photonClient?"enabled for approved geocoding purpose":"disabled");
  while(!stopping) {
    try {
      const didWork=await runGeoResolutionWorkerOnce(admin,workerId,photonClient);
      if(!didWork) await sleep(pollMs);
    } catch(error) {
      console.error("AXIVESTRA E09 worker failed closed:",String(error?.message||error));
      await sleep(pollMs);
    }
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  runGeoResolutionWorker().catch(error=>{
    console.error("AXIVESTRA E09 worker stopped:",String(error?.message||error));
    process.exitCode=1;
  });
}
