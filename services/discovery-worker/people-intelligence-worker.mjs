import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { buildPublicPersonRoleCandidates } from "./people-intelligence.mjs";

const ROLE_FIELDS = [
  "role","role_title","professional_role","designation","designation_in_company",
  "position","position_title","office","job_title","board_position",
  "director_designation","officer_title","public_office"
];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("Missing required E07 worker environment variable: " + name);
  return value;
}

function createAdmin() {
  return createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { "X-AXIVESTRA-Worker": "discovery-public-person-role-worker" } }
  });
}

async function loadInputs(admin, job) {
  const [runResult,evidenceResult,peopleResult,roleFactsResult,assignmentResult] = await Promise.all([
    admin.from("discovery_extraction_runs")
      .select("id,evidence_id,source_id,status,source_content_hash")
      .eq("company_id",job.company_id).eq("id",job.extraction_run_id).maybeSingle(),
    admin.from("discovery_evidence_items")
      .select("id,jurisdiction,content_hash")
      .eq("company_id",job.company_id).eq("id",job.evidence_id).maybeSingle(),
    admin.from("discovery_extracted_entities")
      .select("id,entity_kind,raw_name,normalized_name,source_span,confidence")
      .eq("company_id",job.company_id).eq("extraction_run_id",job.extraction_run_id)
      .eq("entity_kind","person"),
    // Fixed role-field allowlist only. No email, phone, home address, date of birth,
    // personal identifiers or private contact facts are fetched into E07.
    admin.from("discovery_extracted_facts")
      .select("extracted_entity_id,field_name,raw_value,normalized_value,validation_status,source_span")
      .eq("company_id",job.company_id).eq("extraction_run_id",job.extraction_run_id)
      .in("field_name",ROLE_FIELDS).eq("validation_status","valid"),
    admin.from("discovery_entity_assignments")
      .select("extracted_entity_id,canonical_entity_id")
      .eq("company_id",job.company_id).eq("extraction_run_id",job.extraction_run_id)
  ]);
  for (const result of [runResult,evidenceResult,peopleResult,roleFactsResult,assignmentResult]) {
    if (result.error) throw new Error("E07 source input query failed: " + result.error.message);
  }
  const run=runResult.data,evidence=evidenceResult.data;
  if (!run || !evidence || run.evidence_id!==evidence.id ||
    run.source_id!==job.source_id || run.source_content_hash!==evidence.content_hash) {
    throw new Error("E07 E05 run does not match the immutable source evidence.");
  }
  const assignments=assignmentResult.data||[];
  const companyMentionIds=[...new Set(assignments.map(item=>item.extracted_entity_id))];
  const canonicalIds=[...new Set(assignments.map(item=>item.canonical_entity_id))];
  if (!companyMentionIds.length || !canonicalIds.includes(job.canonical_entity_id)) {
    throw new Error("E07 requires an owner-approved E06 company assignment.");
  }
  const [companyMentionsResult,canonicalResult]=await Promise.all([
    admin.from("discovery_extracted_entities")
      .select("id,source_span")
      .eq("company_id",job.company_id).eq("extraction_run_id",job.extraction_run_id)
      .in("id",companyMentionIds),
    admin.from("discovery_canonical_entities")
      .select("id,jurisdiction,status")
      .eq("company_id",job.company_id).in("id",canonicalIds).eq("status","active")
  ]);
  if (companyMentionsResult.error) throw new Error("E07 company evidence locators could not be loaded: "+companyMentionsResult.error.message);
  if (canonicalResult.error) throw new Error("E07 canonical company records could not be loaded: "+canonicalResult.error.message);

  const entitySpans=new Map((companyMentionsResult.data||[]).map(item=>[item.id,item.source_span]));
  const jurisdictions=new Map((canonicalResult.data||[]).map(item=>[item.id,item.jurisdiction]));
  const companyAssignments=assignments.map(item=>({
    ...item,
    source_span:entitySpans.get(item.extracted_entity_id)||{},
    jurisdiction:jurisdictions.get(item.canonical_entity_id)||evidence.jurisdiction
  }));
  return {
    candidates:buildPublicPersonRoleCandidates({
      personMentions:peopleResult.data||[],
      extractedFacts:roleFactsResult.data||[],
      companyAssignments,
      targetCanonicalEntityId:job.canonical_entity_id
    })
  };
}

export async function runPublicPersonRoleWorkerOnce(admin,workerId) {
  const {data:claimed,error:claimError}=await admin.rpc("claim_discovery_public_person_role_job",{
    p_worker_id:workerId,p_lease_seconds:90
  });
  if(claimError) throw new Error("Could not claim E07 work: "+claimError.message);
  const job=Array.isArray(claimed)?claimed[0]:claimed;
  if(!job) return false;

  const controller=new AbortController();
  let heartbeatBusy=false;
  const heartbeatTimer=setInterval(async()=>{
    if(heartbeatBusy||controller.signal.aborted) return;
    heartbeatBusy=true;
    try{
      const {data,error}=await admin.rpc("heartbeat_discovery_public_person_role_job",{
        p_job_id:job.id,p_worker_id:workerId,p_lease_seconds:90
      });
      if(error||data!==true) controller.abort(new Error("E07 lease, source approval or company assignment was revoked."));
    }catch{
      controller.abort(new Error("E07 heartbeat failed; stopping this job."));
    }finally{heartbeatBusy=false;}
  },20_000);

  try{
    const input=await loadInputs(admin,job);
    if(controller.signal.aborted) throw new Error("E07 lease was lost before completion.");
    const {data,error}=await admin.rpc("complete_discovery_public_person_roles",{
      p_job_id:job.id,p_worker_id:workerId,p_candidates:input.candidates
    });
    if(error) throw new Error("E07 candidate commit failed: "+error.message);
    if(controller.signal.aborted) throw new Error("E07 lease was lost before completion.");
    console.info("AXIVESTRA E07 public role extraction completed:",JSON.stringify({
      jobId:job.id,companyEntityId:job.canonical_entity_id,
      candidates:input.candidates.length,committedCandidates:data
    }));
  }catch(error){
    const {error:failError}=await admin.rpc("fail_discovery_public_person_role_job",{
      p_job_id:job.id,p_worker_id:workerId,
      p_error_code:String(error?.code||"PUBLIC_PERSON_ROLE_FAILED").slice(0,100),
      p_error_message:String(error?.message||"E07 processing failed.").slice(0,1000)
    });
    if(failError) console.error("Could not record E07 failure against its lease:",failError.message);
  }finally{clearInterval(heartbeatTimer);}
  return true;
}

export async function runPublicPersonRoleWorker() {
  if(process.env.DISCOVERY_PUBLIC_PERSON_ROLE_WORKER_ENABLED!=="true"){
    console.info("AXIVESTRA E07 worker disabled by default.");
    return;
  }
  const admin=createAdmin();
  const workerId=process.env.AXIVESTRA_PUBLIC_PERSON_ROLE_WORKER_ID||("axivestra-public-role-"+randomUUID());
  const pollMs=Math.max(1000,Math.min(30_000,Number(process.env.DISCOVERY_PUBLIC_PERSON_ROLE_POLL_MS||5000)));
  let stopping=false;
  process.once("SIGINT",()=>{stopping=true;});
  process.once("SIGTERM",()=>{stopping=true;});
  console.info("AXIVESTRA E07 public professional-role worker started. No personal contacts or external network data are collected.");
  while(!stopping){
    try{
      const worked=await runPublicPersonRoleWorkerOnce(admin,workerId);
      if(!worked) await sleep(pollMs);
    }catch(error){
      console.error("AXIVESTRA E07 worker failed closed:",String(error?.message||error));
      await sleep(pollMs);
    }
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  runPublicPersonRoleWorker().catch(error=>{
    console.error("AXIVESTRA E07 worker stopped:",error);
    process.exitCode=1;
  });
}
