import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabase";
import { CheckCircle2, CircleAlert, Clock3, RefreshCw, ShieldCheck, XCircle } from "lucide-react";

type Run = {
  id:string; source_id:string; evidence_id:string; extractor_version:string; schema_hash:string;
  status:string; extracted_entity_count:number; fact_count:number; invalid_fact_count:number;
  warnings:string[]; source_content_hash:string; completed_at:string;
};
type Fact = {
  id:string; extraction_run_id:string; extracted_entity_id:string|null; field_name:string;
  value_type:string; raw_value:string; normalized_value:unknown; source_span:Record<string,unknown>;
  confidence:number; validation_status:"valid"|"invalid"; validation_message:string|null;
};
type Entity = {
  id:string; extraction_run_id:string; mention_key:string; entity_kind:string;
  raw_name:string; normalized_name:string; source_span:Record<string,unknown>; confidence:number;
};
type Review = {
  id:string; extraction_run_id:string; fact_id:string|null; extracted_entity_id:string|null;
  actor_user_id:string; decision:string; reason:string; corrected_value:unknown; occurred_at:string;
};
type Response = {ok?:boolean;error?:string;runs?:Run[];facts?:Fact[];entities?:Entity[];reviews?:Review[];review?:Review};

function pretty(value:unknown) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}
function dateLabel(value:string) {
  const date=new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export default function DiscoveryExtractionResults({companyId,companyRole,sources}:{
  companyId?:string; companyRole?:string; sources:{id:string;name:string}[];
}) {
  const canReview=companyRole==="owner"||companyRole==="admin";
  const [runs,setRuns]=useState<Run[]>([]);
  const [facts,setFacts]=useState<Fact[]>([]);
  const [entities,setEntities]=useState<Entity[]>([]);
  const [reviews,setReviews]=useState<Review[]>([]);
  const [selectedRunId,setSelectedRunId]=useState("");
  const [loading,setLoading]=useState(false);
  const [busyId,setBusyId]=useState("");
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");

  const invoke=useCallback(async(action:string,payload:Record<string,unknown>={})=>{
    if(!companyId) throw new Error("An authenticated company workspace is required.");
    if(!supabase) throw new Error("AXIVESTRA cloud authentication is not configured.");
    const {data,error:invokeError}=await supabase.functions.invoke("discovery-control",{
      body:{companyId,action,payload}
    });
    if(invokeError) throw new Error(invokeError.message||"The extraction service could not be reached.");
    const response=data as Response|null;
    if(!response?.ok) throw new Error(response?.error||"The extraction request was not accepted.");
    return response;
  },[companyId]);

  const refresh=useCallback(async()=>{
    if(!companyId)return;
    setLoading(true);setError("");
    try{
      const result=await invoke("extractions.list");
      const nextRuns=result.runs||[];
      setRuns(nextRuns);setFacts(result.facts||[]);setEntities(result.entities||[]);setReviews(result.reviews||[]);
      setSelectedRunId(current=>nextRuns.some(run=>run.id===current)?current:(nextRuns[0]?.id||""));
    }catch(reason){setError(reason instanceof Error?reason.message:"Could not load extraction results.");}
    finally{setLoading(false);}
  },[companyId,invoke]);

  useEffect(()=>{void refresh();},[refresh]);

  const selectedRun=runs.find(run=>run.id===selectedRunId);
  const runFacts=useMemo(()=>facts.filter(fact=>fact.extraction_run_id===selectedRunId),[facts,selectedRunId]);
  const runEntities=useMemo(()=>entities.filter(entity=>entity.extraction_run_id===selectedRunId),[entities,selectedRunId]);
  const runReviews=useMemo(()=>reviews.filter(review=>review.extraction_run_id===selectedRunId),[reviews,selectedRunId]);
  const sourceName=(id:string)=>sources.find(source=>source.id===id)?.name||"Registered source";
  const latestReview=(factId:string)=>runReviews.find(review=>review.fact_id===factId);

  const recordReview=async(fact:Fact,decision:"accepted"|"rejected")=>{
    setBusyId(fact.id);setError("");setNotice("");
    try{
      await invoke("extractions.review",{
        runId:fact.extraction_run_id,factId:fact.id,decision,
        reason:decision==="accepted"
          ?"Accepted by company administrator after review of the original evidence span."
          :"Rejected by company administrator after review of the original evidence span."
      });
      setNotice(decision==="accepted"?"Fact review accepted. The original extracted fact remains immutable.":"Fact review rejected. The original extracted fact remains immutable.");
      await refresh();
    }catch(reason){setError(reason instanceof Error?reason.message:"Could not save extraction review.");}
    finally{setBusyId("");}
  };

  return <section className="discovery-extraction-panel">
    <div className="discovery-extraction-head">
      <div>
        <span className="section-kicker">E05 · EXTRACTION & NORMALISATION</span>
        <h2>Evidence-backed extracted facts</h2>
        <p>Deterministic parser output only. Every fact keeps its raw value, typed value, validation result, confidence and source locator. Nothing is promoted to a company, contact or workspace record automatically.</p>
      </div>
      <button type="button" className="text-button" onClick={()=>void refresh()} disabled={loading}><RefreshCw size={14}/> Refresh</button>
    </div>

    {error&&<div className="discovery-feedback discovery-feedback--error" role="alert"><CircleAlert size={16}/>{error}</div>}
    {notice&&<div className="discovery-feedback discovery-feedback--success" role="status"><CheckCircle2 size={16}/>{notice}</div>}

    {!runs.length?<div className="discovery-extraction-empty">
      <Clock3 size={20}/><span>{loading?"Loading extraction runs…":"No extraction output yet. Evidence snapshots will appear here after the deterministic extraction worker is enabled and processes an eligible evidence item."}</span>
    </div>:<>
      <div className="discovery-run-strip">
        {runs.map(run=><button type="button" key={run.id}
          className={"discovery-run-chip "+(run.id===selectedRunId?"is-selected":"")}
          onClick={()=>setSelectedRunId(run.id)}>
          <span>{sourceName(run.source_id)}</span>
          <small>{run.fact_count} facts · {run.invalid_fact_count} invalid · {run.status.replaceAll("_"," ")}</small>
        </button>)}
      </div>
      {selectedRun&&<>
        <div className="discovery-extraction-summary">
          <div><b>Source</b><span>{sourceName(selectedRun.source_id)}</span></div>
          <div><b>Extracted entities</b><span>{selectedRun.extracted_entity_count}</span></div>
          <div><b>Facts</b><span>{selectedRun.fact_count}</span></div>
          <div><b>Completed</b><span>{dateLabel(selectedRun.completed_at)}</span></div>
          <div><b>Parser</b><span>{selectedRun.extractor_version}</span></div>
          <div><b>Evidence SHA-256</b><span className="discovery-hash">{selectedRun.source_content_hash?selectedRun.source_content_hash.slice(0,16)+"…":"—"}</span></div>
        </div>
        {selectedRun.warnings?.length>0&&<div className="discovery-extraction-warnings"><b>Parser warnings</b>{selectedRun.warnings.map((warning,index)=><p key={index}>{warning}</p>)}</div>}
        <div className="discovery-fact-list">
          {runFacts.map(fact=>{
            const review=latestReview(fact.id);
            return <article className="discovery-fact-card" key={fact.id}>
              <div className="discovery-fact-top">
                <div><strong>{fact.field_name.replaceAll("_"," ")}</strong><small>{fact.value_type} · Heuristic parser confidence {(Number(fact.confidence)*100).toFixed(1)}%</small></div>
                <div className="discovery-fact-state">
                  <span className={"discovery-fact-validity "+(fact.validation_status==="valid"?"is-valid":"is-invalid")}>{fact.validation_status}</span>
                  {review&&<span className={"discovery-fact-review review-"+review.decision}>{review.decision.replaceAll("_"," ")}</span>}
                  {!review&&<span className="discovery-fact-review is-pending">Pending review</span>}
                </div>
              </div>
              <div className="discovery-fact-values">
                <div><b>Source text</b><span>{fact.raw_value||"—"}</span></div>
                <div><b>Normalised value</b><span>{pretty(fact.normalized_value)}</span></div>
              </div>
              {fact.validation_message&&<p className="discovery-fact-validation">{fact.validation_message}</p>}
              <div className="discovery-source-span">
                <b>Evidence span</b>
                <code>{pretty(fact.source_span?.locator||fact.source_span?.kind||fact.source_span)}</code>
                {typeof fact.source_span?.quote==="string"&&<blockquote>{fact.source_span.quote}</blockquote>}
                {typeof fact.source_span?.page === "number" && Number.isFinite(fact.source_span.page) && <small>PDF page {fact.source_span.page}</small>}
                {typeof fact.source_span?.line === "number" && Number.isFinite(fact.source_span.line) && <small>Line {fact.source_span.line}</small>}
              </div>
              {review&&<div className="discovery-review-receipt"><b>Last review:</b> {review.decision} — {review.reason} <small>{dateLabel(review.occurred_at)}</small></div>}
              {canReview&&!review&&<div className="discovery-fact-actions">
                <button type="button" className="primary-button" onClick={()=>void recordReview(fact,"accepted")} disabled={busyId===fact.id}><CheckCircle2 size={14}/>Accept fact</button>
                <button type="button" className="secondary-button" onClick={()=>void recordReview(fact,"rejected")} disabled={busyId===fact.id}><XCircle size={14}/>Reject fact</button>
              </div>}
            </article>;
          })}
          {!runFacts.length&&<p className="discovery-empty-inline">No structured facts matched this source's approved extraction schema. No values were inferred.</p>}
        </div>
        {runEntities.length>0&&<details className="discovery-entity-mentions">
          <summary>Unresolved entity mentions ({runEntities.length})</summary>
          <p>These are source mentions only. Canonical company/person resolution belongs to E06/E07.</p>
          {runEntities.map(entity=><div className="discovery-entity-mention" key={entity.id}>
            <strong>{entity.normalized_name}</strong><small>{entity.entity_kind} · {(Number(entity.confidence)*100).toFixed(1)}% confidence</small>
            <code>{pretty(entity.source_span?.locator||entity.source_span?.kind)}</code>
          </div>)}
        </details>}
      </>}
    </>}
    {!canReview&&runs.length>0&&<div className="discovery-extraction-readonly"><ShieldCheck size={15}/>Read-only view. A company owner or admin must record a review decision.</div>}
  </section>;
}
