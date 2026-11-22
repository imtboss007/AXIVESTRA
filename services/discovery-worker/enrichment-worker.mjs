import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { buildEnrichmentCandidates } from "./enrichment.mjs";

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function requiredEnv(name){
  const value=process.env[name]?.trim();
  if(!value) throw new Error("Missing E10 worker environment variable: "+name);
  return value;
}
function createAdmin(){
  return createClient(requiredEnv("SUPABASE_URL"),requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),{
    auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false},
    global:{headers:{"X-AXIVESTRA-Worker":"discovery-enrichment-worker"}}
  });
}

export async function loadEnrichmentInputs(admin,job){
  const [runResult,evidenceResult,sourceResult,entitiesResult,factsResult,assignmentsResult]=await Promise.all([
    admin.from("discovery_extraction_runs")
      .select("id,evidence_id,source_id,status,source_content_hash,completed_at")
      .eq("company_id",job.company_id).eq("id",job.extraction_run_id).maybeSingle(),
    admin.from("discovery_evidence_items")
      .select("id,content_hash,captured_at,source_published_at")
      .eq("company_id",job.company_id).eq("id",job.evidence_id).maybeSingle(),
    admin.from("discovery_source_registry")
      .select("id,name,domain,jurisdiction,status,allowed_fields,field_schema,allowed_purposes,attribution,license_ref")
      .eq("company_id",job.company_id).eq("id",job.source_id).maybeSingle(),
    admin.from("discovery_extracted_entities")
      .select("id,entity_kind,raw_name,normalized_name,source_span,confidence")
      .eq("company_id",job.company_id).eq("extraction_run_id",job.extraction_run_id)
      .eq("entity_kind","organization"),
    admin.from("discovery_extracted_facts")
      .select("id,extracted_entity_id,field_name,value_type,raw_value,normalized_value,validation_status,source_span,confidence")
      .eq("company_id",job.company_id).eq("extraction_run_id",job.extraction_run_id),
    admin.from("discovery_entity_assignments")
      .select("extracted_entity_id,canonical_entity_id")
      .eq("company_id",job.company_id).eq("extraction_run_id",job.extraction_run_id)
  ]);
  for(const result of [runResult,evidenceResult,sourceResult,entitiesResult,factsResult,assignmentsResult]){
    if(result.error) throw new Error("E10 input query failed: "+result.error.message);
  }
  const run=runResult.data,evidence=evidenceResult.data,source=sourceResult.data;
  if(!run||!evidence||!source||run.evidence_id!==evidence.id||
     run.source_id!==job.source_id||run.source_content_hash!==evidence.content_hash||
     !["completed","completed_with_warnings"].includes(run.status)){
    throw new Error("E10 extraction run does not match immutable source evidence.");
  }
  if(source.status!=="approved"||
     !Array.isArray(source.allowed_purposes)||!source.allowed_purposes.includes("enrichment")||
     JSON.stringify(source.field_schema||{})!==JSON.stringify(job.field_schema_snapshot||{})||
     JSON.stringify(source.allowed_fields||[])!==JSON.stringify(job.allowed_fields_snapshot||[])){
    throw new Error("E10 source approval, enrichment purpose or exact field schema changed; refusing enrichment.");
  }
  const canonicalIds=[...new Set((assignmentsResult.data||[]).map(item=>item.canonical_entity_id).filter(Boolean))];
  let canonicalEntities=[];
  if(canonicalIds.length){
    const canonicalResult=await admin.from("discovery_canonical_entities")
      .select("id,entity_kind,status,legal_name,normalized_name,jurisdiction")
      .eq("company_id",job.company_id).in("id",canonicalIds).eq("entity_kind","organization").eq("status","active");
    if(canonicalResult.error) throw new Error("E10 canonical entity query failed: "+canonicalResult.error.message);
    canonicalEntities=canonicalResult.data||[];
  }
  const candidates=buildEnrichmentCandidates({
    extractedEntities:entitiesResult.data||[],
    extractedFacts:factsResult.data||[],
    assignments:assignmentsResult.data||[],
    canonicalEntities,
    allowedFields:job.allowed_fields_snapshot||[],
    fieldSchema:job.field_schema_snapshot||{},
    evidenceId:evidence.id,
    sourceId:source.id,
    sourceName:source.name,
    sourceDomain:source.domain,
    sourceJurisdiction:source.jurisdiction,
    sourceAttribution:source.attribution,
    sourceLicenseRef:source.license_ref,
    sourcePublishedAt:evidence.source_published_at,
    evidenceCapturedAt:evidence.captured_at,
    evidenceContentHash:evidence.content_hash,
    extractionCompletedAt:run.completed_at
  });
  if(candidates.length>500) throw new Error("E10 enrichment batch exceeds the 500-observation limit.");
  return {candidates};
}

export async function runEnrichmentWorkerOnce(admin,workerId){
  const {data:claimed,error:claimError}=await admin.rpc("claim_discovery_enrichment_job",{
    p_worker_id:workerId,p_lease_seconds:90
  });
  if(claimError) throw new Error("Could not claim E10 work: "+claimError.message);
  const job=Array.isArray(claimed)?claimed[0]:claimed;
  if(!job) return false;

  let heartbeatBusy=false,leaseLost=false;
  const heartbeatTimer=setInterval(async()=>{
    if(heartbeatBusy||leaseLost) return;
    heartbeatBusy=true;
    try{
      const {data,error}=await admin.rpc("heartbeat_discovery_enrichment_job",{
        p_job_id:job.id,p_worker_id:workerId,p_lease_seconds:90
      });
      if(error||data!==true) leaseLost=true;
    }catch{leaseLost=true;}
    finally{heartbeatBusy=false;}
  },20_000);

  try{
    const input=await loadEnrichmentInputs(admin,job);
    if(leaseLost) throw new Error("E10 lease or source approval was revoked.");
    const {data,error}=await admin.rpc("complete_discovery_enrichment_job",{
      p_job_id:job.id,p_worker_id:workerId,p_candidates:input.candidates
    });
    if(error) throw new Error("E10 observation commit failed: "+error.message);
    if(leaseLost) throw new Error("E10 lease was lost before completion.");
    console.info("AXIVESTRA E10 source observations recorded:",JSON.stringify({
      jobId:job.id,observations:input.candidates.length,committedObservations:data
    }));
  }catch(error){
    const {error:failError}=await admin.rpc("fail_discovery_enrichment_job",{
      p_job_id:job.id,p_worker_id:workerId,
      p_error_code:String(error?.code||"ENRICHMENT_FAILED").slice(0,100),
      p_error_message:String(error?.message||"E10 enrichment failed.").slice(0,1000)
    });
    if(failError) console.error("Could not record E10 failure:",failError.message);
  }finally{
    clearInterval(heartbeatTimer);
  }
  return true;
}

export async function runEnrichmentWorker(){
  if(process.env.DISCOVERY_ENRICHMENT_WORKER_ENABLED!=="true"){
    console.info("AXIVESTRA E10 enrichment worker disabled by default.");
    return;
  }
  const admin=createAdmin();
  const workerId=process.env.AXIVESTRA_ENRICHMENT_WORKER_ID||
    ("axivestra-enrichment-"+randomUUID());
  const pollMs=Math.max(1000,Math.min(30_000,Number(process.env.DISCOVERY_ENRICHMENT_POLL_MS||5000)));
  let stopping=false;
  process.once("SIGINT",()=>{stopping=true;});
  process.once("SIGTERM",()=>{stopping=true;});
  console.info("AXIVESTRA E10 deterministic enrichment worker started; no external calls.");
  while(!stopping){
    try{
      const didWork=await runEnrichmentWorkerOnce(admin,workerId);
      if(!didWork) await sleep(pollMs);
    }catch(error){
      console.error("AXIVESTRA E10 worker failed closed:",String(error?.message||error));
      await sleep(pollMs);
    }
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  runEnrichmentWorker().catch(error=>{
    console.error("AXIVESTRA E10 worker stopped:",String(error?.message||error));
    process.exitCode=1;
  });
}
