import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, FileSearch, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { supabase } from "./lib/supabase";

type VerificationCase={
  id:string;company_id:string;subject_kind:string;subject_id:string;status:string;
  opened_at:string;updated_at:string;reviewed_by:string|null;reviewed_at:string|null;
  evidence_count:number;independent_source_count:number;hashed_evidence_count:number;
  supporting_evidence_count:number;contradicting_evidence_count:number;context_evidence_count:number;
  last_evidence_at:string|null;confidence_index:number;confidence_band:string;
};
type VerificationEvidence={
  id:string;case_id:string;provenance_event_id:string;source_id:string|null;
  source_name_snapshot:string|null;source_domain_snapshot:string|null;
  evidence_content_hash:string|null;evidence_captured_at:string|null;
  source_published_at:string|null;provenance_event_type:string;
  default_classification:string;occurred_at:string;
};
type VerificationEvent={
  id:string;case_id:string;event_type:string;previous_status:string|null;new_status:string|null;
  provenance_event_id:string|null;previous_classification:string|null;new_classification:string|null;
  reason:string|null;occurred_at:string;
};
type Props={companyId?:string;companyRole?:string};
const DECISIONS=["in_review","verified","partially_verified","disputed","rejected","insufficient_evidence","pending_review"];
const CLASSIFICATIONS=["supporting","contradicting","context"];
const label=(value:string)=>String(value||"").replaceAll("_"," ").replace(/\b\w/g,c=>c.toUpperCase());
const shortId=(value:string)=>value?value.slice(0,8):"—";
const dateLabel=(value?:string|null)=>value?new Date(value).toLocaleString():"Not recorded";

export default function DiscoveryVerificationWorkspace({companyId,companyRole}:Props){
  const canManage=companyRole==="owner"||companyRole==="admin";
  const [cases,setCases]=useState<VerificationCase[]>([]);
  const [evidence,setEvidence]=useState<VerificationEvidence[]>([]);
  const [events,setEvents]=useState<VerificationEvent[]>([]);
  const [decisionDrafts,setDecisionDrafts]=useState<Record<string,string>>({});
  const [reasonDrafts,setReasonDrafts]=useState<Record<string,string>>({});
  const [classificationDrafts,setClassificationDrafts]=useState<Record<string,string>>({});
  const [classificationReasons,setClassificationReasons]=useState<Record<string,string>>({});
  const [filter,setFilter]=useState("open");
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState("");
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");

  const load=useCallback(async()=>{
    if(!companyId||!supabase){setCases([]);setEvidence([]);setEvents([]);return;}
    setLoading(true);setError("");
    try{
      const inbox=await supabase.from("discovery_verification_inbox").select("*")
        .eq("company_id",companyId).order("updated_at",{ascending:false}).limit(500);
      if(inbox.error)throw inbox.error;
      const nextCases=(inbox.data||[]) as VerificationCase[];
      setCases(nextCases);
      const ids=nextCases.map(item=>item.id);
      if(!ids.length){setEvidence([]);setEvents([]);return;}
      const [evidenceResult,eventResult]=await Promise.all([
        supabase.from("discovery_verification_evidence").select("*")
          .eq("company_id",companyId).in("case_id",ids).order("occurred_at",{ascending:false}).limit(3000),
        supabase.from("discovery_verification_events").select("*")
          .eq("company_id",companyId).in("case_id",ids).order("occurred_at",{ascending:false}).limit(3000)
      ]);
      if(evidenceResult.error)throw evidenceResult.error;
      if(eventResult.error)throw eventResult.error;
      setEvidence((evidenceResult.data||[]) as VerificationEvidence[]);
      setEvents((eventResult.data||[]) as VerificationEvent[]);
    }catch(reason){setError(reason instanceof Error?reason.message:"Could not load verification cases.");}
    finally{setLoading(false);}
  },[companyId]);
  useEffect(()=>{void load();},[load]);

  const visibleCases=useMemo(()=>filter==="all"?cases:filter==="open"
    ?cases.filter(item=>["pending_review","in_review","disputed","insufficient_evidence"].includes(item.status))
    :cases.filter(item=>item.status===filter),[cases,filter]);
  const evidenceByCase=useMemo(()=>{
    const result=new Map<string,VerificationEvidence[]>();
    for(const item of evidence){const list=result.get(item.case_id)||[];list.push(item);result.set(item.case_id,list);}
    return result;
  },[evidence]);
  const latestClassification=useMemo(()=>{
    const result=new Map<string,string>();
    for(const event of [...events].reverse()){
      if(event.event_type==="evidence_classified"&&event.provenance_event_id&&event.new_classification)
        result.set(event.provenance_event_id,event.new_classification);
    }
    return result;
  },[events]);

  const recordDecision=async(item:VerificationCase)=>{
    if(!companyId||!supabase)return;
    const decision=decisionDrafts[item.id]||"in_review";
    const reason=reasonDrafts[item.id]||"";
    setBusy("review-"+item.id);setError("");setNotice("");
    try{
      const {error:rpcError}=await supabase.rpc("record_discovery_verification_review",{
        p_company_id:companyId,p_case_id:item.id,p_decision:decision,p_reason:reason
      });
      if(rpcError)throw rpcError;
      setNotice("Verification decision and immutable reviewer receipt saved.");
      await load();
    }catch(cause){setError(cause instanceof Error?cause.message:"Verification review was rejected.");}
    finally{setBusy("");}
  };

  const classifyEvidence=async(item:VerificationCase,ref:VerificationEvidence)=>{
    if(!companyId||!supabase)return;
    const classification=classificationDrafts[ref.id]||latestClassification.get(ref.provenance_event_id)||ref.default_classification;
    const reason=classificationReasons[ref.id]||"";
    setBusy("evidence-"+ref.id);setError("");setNotice("");
    try{
      const {error:rpcError}=await supabase.rpc("record_discovery_verification_evidence_classification",{
        p_company_id:companyId,p_case_id:item.id,p_provenance_event_id:ref.provenance_event_id,
        p_classification:classification,p_reason:reason
      });
      if(rpcError)throw rpcError;
      setNotice("Evidence classification and reviewer receipt saved.");
      await load();
    }catch(cause){setError(cause instanceof Error?cause.message:"Evidence classification was rejected.");}
    finally{setBusy("");}
  };

  if(!companyId)return null;
  return <section className="data-panel discovery-verification" aria-label="Verification and confidence workspace">
    <div className="section-heading">
      <div><span className="section-kicker">E19 · REVISED ROADMAP E13</span><h2>Verification & confidence</h2>
        <p>Cross-stage evidence review for extracted facts, company identity, professional roles, contacts, locations and enrichment observations. Confidence is an evidence-coverage index, not a probability or automatic truth decision.</p></div>
      <button type="button" className="secondary-button" onClick={()=>void load()} disabled={loading}><RefreshCw size={14}/>Refresh</button>
    </div>
    {error&&<div className="discovery-lead-message is-error" role="alert"><CircleAlert size={15}/>{error}</div>}
    {notice&&<div className="discovery-lead-message" role="status"><CheckCircle2 size={15}/>{notice}</div>}
    {!canManage&&<div className="discovery-readonly"><ShieldCheck size={14}/>Read-only. Only company owners/admins can classify evidence or record verification decisions.</div>}
    <div className="discovery-verification-toolbar">
      <div><strong>{cases.length}</strong><small>Total cases</small></div>
      <div><strong>{cases.filter(item=>["pending_review","in_review"].includes(item.status)).length}</strong><small>Awaiting review</small></div>
      <div><strong>{cases.filter(item=>item.status==="verified").length}</strong><small>Verified</small></div>
      <div><strong>{cases.filter(item=>item.status==="disputed").length}</strong><small>Disputed</small></div>
      <label>Show<select value={filter} onChange={event=>setFilter(event.target.value)}>
        <option value="open">Open / needs review</option><option value="all">All cases</option>
        {["verified","partially_verified","disputed","rejected","insufficient_evidence"].map(value=><option key={value} value={value}>{label(value)}</option>)}
      </select></label>
    </div>
    {loading&&!cases.length?<div className="discovery-loading"><LoaderCircle size={15}/>Loading verification cases…</div>:
      visibleCases.length?<div className="discovery-verification-list">{visibleCases.map(item=>{
        const refs=evidenceByCase.get(item.id)||[];
        const score=Number(item.confidence_index||0);
        const history=events.filter(event=>event.case_id===item.id).slice(0,4);
        return <article className="discovery-verification-card" key={item.id}>
          <div className="discovery-verification-card-head">
            <div><span className="section-kicker">{label(item.subject_kind)}</span><strong>Record {shortId(item.subject_id)}</strong><small>Opened {dateLabel(item.opened_at)} · Updated {dateLabel(item.updated_at)}</small></div>
            <span className={"discovery-status discovery-status--"+item.status}>{label(item.status)}</span>
          </div>
          <div className="discovery-verification-metrics">
            <div><strong>{score.toFixed(1)}</strong><small>Confidence index / 100 · {label(item.confidence_band)}</small></div>
            <div><strong>{item.independent_source_count}</strong><small>Independent source domains</small></div>
            <div><strong>{item.evidence_count}</strong><small>Provenance references</small></div>
            <div><strong>{item.contradicting_evidence_count}</strong><small>Contradicting references</small></div>
          </div>
          <details className="discovery-verification-evidence">
            <summary><FileSearch size={14}/>Inspect evidence references ({refs.length})</summary>
            {refs.length?refs.map(ref=>{
              const classification=latestClassification.get(ref.provenance_event_id)||ref.default_classification;
              return <div className="discovery-verification-evidence-row" key={ref.id}>
                <div><strong>{ref.source_name_snapshot||ref.source_domain_snapshot||"Recorded provenance"}</strong>
                  <small>{ref.source_domain_snapshot||"No source domain"} · {label(ref.provenance_event_type)} · {dateLabel(ref.evidence_captured_at||ref.occurred_at)}</small>
                  <small>Evidence hash: {ref.evidence_content_hash?ref.evidence_content_hash.slice(0,16)+"…":"Not attached"} · Provenance {shortId(ref.provenance_event_id)}</small>
                  <span className={"discovery-verification-classification classification-"+classification}>{label(classification)}</span>
                </div>
                {canManage&&<div className="discovery-verification-classify">
                  <label>Classify<select value={classificationDrafts[ref.id]||classification}
                    onChange={event=>setClassificationDrafts(old=>({...old,[ref.id]:event.target.value}))}>
                    {CLASSIFICATIONS.map(value=><option key={value} value={value}>{label(value)}</option>)}
                  </select></label>
                  <label>Reason<input maxLength={1000} value={classificationReasons[ref.id]||""}
                    onChange={event=>setClassificationReasons(old=>({...old,[ref.id]:event.target.value}))}
                    placeholder="Why does this evidence support or conflict?"/></label>
                  <button type="button" className="secondary-button" disabled={busy==="evidence-"+ref.id}
                    onClick={()=>void classifyEvidence(item,ref)}>{busy==="evidence-"+ref.id?<LoaderCircle size={13}/>:<CheckCircle2 size={13}/>}Save classification</button>
                </div>}
              </div>;
            }):<p className="discovery-empty-state">No provenance references are linked to this case yet.</p>}
          </details>
          {canManage&&<div className="discovery-verification-review">
            <label>Decision<select value={decisionDrafts[item.id]||"in_review"}
              onChange={event=>setDecisionDrafts(old=>({...old,[item.id]:event.target.value}))}>
              {DECISIONS.map(value=><option key={value} value={value}>{label(value)}</option>)}
            </select></label>
            <label>Reviewer reason<textarea rows={2} maxLength={1000} value={reasonDrafts[item.id]||""}
              onChange={event=>setReasonDrafts(old=>({...old,[item.id]:event.target.value}))}
              placeholder="Record the evidence basis, unresolved gaps or reason for the decision."/></label>
            <button type="button" className="primary-button" disabled={busy==="review-"+item.id}
              onClick={()=>void recordDecision(item)}>{busy==="review-"+item.id?<LoaderCircle size={13}/>:<ShieldCheck size={13}/>}Record decision</button>
          </div>}
          {!!history.length&&<div className="discovery-verification-history"><b>Recent history</b>
            {history.map(event=><span key={event.id}>{label(event.event_type)} · {event.new_status?label(event.new_status):event.new_classification?label(event.new_classification):"Evidence updated"} · {dateLabel(event.occurred_at)}</span>)}
          </div>}
        </article>;
      })}</div>:<p className="discovery-empty-state">No verification cases match this filter. Cases open automatically as upstream stages emit source-backed provenance.</p>}
    <p className="ax-relationship-footnote">The index uses independent source-domain count, content-hash coverage and supporting-versus-contradicting evidence. It is not a statistical probability. No case is marked verified automatically. New evidence reopens a prior decision for review. Raw source text, URLs, contact values and ciphertext are not displayed here.</p>
  </section>;
}
