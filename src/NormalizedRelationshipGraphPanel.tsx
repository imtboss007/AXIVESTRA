import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { CheckCircle2, CircleAlert, LoaderCircle, Network, RefreshCw, ShieldCheck, Link2 } from "lucide-react";
import { supabase } from "./lib/supabase";

type Contact = { id:string; name:string; role?:string };
type Deal = { id:string; title:string; module:string };
type Evidence = { id:string; name:string };
type GraphNode = { id:string; kind:string; label:string; record_key:string };
type GraphEdge = {
  id:string; source:string; target:string; role:string; responsibility:string;
  authority_scope:string; verification_state:string; effective_from:string;
  effective_to:string|null; evidence_record_key:string|null; evidence_label:string|null;
};
type GraphResult = {
  company_id:string; as_of_date:string; nodes:GraphNode[]; edges:GraphEdge[];
  counts:{relationship_count:number;verified_count:number;evidence_supported_count:number;unverified_count:number;disputed_count:number};
};
type Props = {companyId?:string;companyRole?:string;contacts:Contact[];properties:Deal[]};

const ROLES=["owner","co_owner","buyer","seller","borrower","lender","guarantor","investor","investee","fund_manager","advisor","broker","agent","tenant","developer","contractor","advocate","mediator","introducer","partner","other"];
const RESPONSIBILITIES=["participant","decision_maker","authorized_signatory","beneficial_owner","representative","originator","reviewer","other"];
const VERIFICATION=["unverified","claimed","evidence_supported","verified","disputed","rejected"];
const label=(value:string)=>String(value||"").replaceAll("_"," ").replace(/\b\w/g,c=>c.toUpperCase());

export default function NormalizedRelationshipGraphPanel({companyId,companyRole,contacts,properties}:Props) {
  const canEdit=["owner","admin","manager","staff"].includes(companyRole||"");
  const [graph,setGraph]=useState<GraphResult|null>(null);\n  const [evidenceDocs,setEvidenceDocs]=useState<Evidence[]>([]);
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState("");
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [dealKey,setDealKey]=useState("");
  const [partyKey,setPartyKey]=useState("");
  const [role,setRole]=useState("buyer");
  const [responsibility,setResponsibility]=useState("participant");
  const [edits,setEdits]=useState<Record<string,{state:string;evidence:string;endDate:string}>>({});

  const load=useCallback(async()=>{
    if(!companyId||!supabase){setGraph(null);return;}
    setLoading(true);setError("");
    try{
      const [graphResult,evidenceResult]=await Promise.all([
        supabase.rpc("get_company_relationship_graph",{p_company_id:companyId}),
        supabase.from("company_records").select("record_key,payload")
          .eq("company_id",companyId).eq("record_type","document_metadata").is("deleted_at",null)
          .order("record_key").limit(500)
      ]);
      if(graphResult.error)throw graphResult.error;
      if(evidenceResult.error)throw evidenceResult.error;
      setGraph(graphResult.data as GraphResult);
      setEvidenceDocs((evidenceResult.data||[]).map((row:{record_key:string;payload:Record<string,unknown>})=>({
        id:row.record_key,name:String(row.payload?.name||row.payload?.title||row.record_key)
      })));
    }catch(reason){setError(reason instanceof Error?reason.message:"Could not load the normalized relationship graph.");}
    finally{setLoading(false);}
  },[companyId]);
  useEffect(()=>{void load();},[load]);

  const nodeLabels=useMemo(()=>new Map((graph?.nodes||[]).map(node=>[node.id,node.label])),[graph]);
  const createLink=async(event:FormEvent)=>{
    event.preventDefault();if(!companyId||!supabase||!dealKey||!partyKey)return;
    setBusy("create");setError("");setNotice("");
    try{
      const {error:insertError}=await supabase.from("company_deal_parties").insert({
        company_id:companyId,deal_record_key:dealKey,party_record_key:partyKey,
        role_code:role,responsibility_code:responsibility,verification_state:"unverified"
      });
      if(insertError)throw insertError;
      setDealKey("");setPartyKey("");setNotice("Deal-party relationship recorded as unverified. No identity was inferred.");
      await load();
    }catch(reason){setError(reason instanceof Error?reason.message:"Could not create the relationship.");}
    finally{setBusy("");}
  };
  const saveLink=async(edge:GraphEdge)=>{
    if(!companyId||!supabase)return;
    const draft=edits[edge.id]||{state:edge.verification_state,evidence:edge.evidence_record_key||"",endDate:edge.effective_to||""};
    if(["evidence_supported","verified"].includes(draft.state)&&!draft.evidence){
      setError("Attach an existing document record before marking a relationship evidence-supported or verified.");return;
    }
    setBusy(edge.id);setError("");setNotice("");
    try{
      const patch:Record<string,unknown>={
        verification_state:draft.state,
        evidence_record_key:draft.evidence||null
      };
      if(draft.endDate)patch.effective_to=draft.endDate;
      const {error:updateError}=await supabase.from("company_deal_parties").update(patch)
        .eq("company_id",companyId).eq("id",edge.id);
      if(updateError)throw updateError;
      setNotice("Relationship verification/effective period updated with an immutable history event.");
      await load();
    }catch(reason){setError(reason instanceof Error?reason.message:"Could not update the relationship.");}
    finally{setBusy("");}
  };

  if(!companyId)return null;
  return <section className="data-panel ax-normalized-relationship-panel" aria-label="Normalized deal-party relationship graph">
    <div className="section-heading">
      <div><span className="section-kicker">E16 · E17 · CANONICAL RELATIONSHIP GRAPH</span><h2>Deal parties and verified relationships</h2>
        <p>Only explicitly saved deal-to-contact links appear here. Verification requires an existing evidence record; names never create edges.</p></div>
      <button type="button" className="secondary-button" onClick={()=>void load()} disabled={loading}><RefreshCw size={14}/>Refresh</button>
    </div>
    {error&&<div className="discovery-lead-message is-error"><CircleAlert size={15}/>{error}</div>}
    {notice&&<div className="discovery-lead-message"><CheckCircle2 size={15}/>{notice}</div>}
    {graph&&<div className="ax-relationship-metrics">
      <article><Network size={16}/><strong>{graph.counts.relationship_count}</strong><span>Active links</span></article>
      <article><ShieldCheck size={16}/><strong>{graph.counts.verified_count}</strong><span>Verified</span></article>
      <article><Link2 size={16}/><strong>{graph.counts.evidence_supported_count}</strong><span>Evidence supported</span></article>
      <article><CircleAlert size={16}/><strong>{graph.counts.unverified_count+graph.counts.disputed_count}</strong><span>Needs review / disputed</span></article>
    </div>}
    {canEdit&&<form className="ax-normalized-relationship-form" onSubmit={event=>void createLink(event)}>
      <label>Deal / workspace record<select required value={dealKey} onChange={e=>setDealKey(e.target.value)}>
        <option value="">Choose a deal record</option>{properties.map(item=><option key={item.id} value={item.id}>{item.title} · {item.module}</option>)}
      </select></label>
      <label>Contact / party<select required value={partyKey} onChange={e=>setPartyKey(e.target.value)}>
        <option value="">Choose a contact</option>{contacts.map(item=><option key={item.id} value={item.id}>{item.name} · {item.role||"Contact"}</option>)}
      </select></label>
      <label>Role in this deal<select value={role} onChange={e=>setRole(e.target.value)}>{ROLES.map(item=><option key={item} value={item}>{label(item)}</option>)}</select></label>
      <label>Responsibility<select value={responsibility} onChange={e=>setResponsibility(e.target.value)}>{RESPONSIBILITIES.map(item=><option key={item} value={item}>{label(item)}</option>)}</select></label>
      <button type="submit" className="primary-button" disabled={busy==="create"||!dealKey||!partyKey}>{busy==="create"?<LoaderCircle size={14}/>:<Link2 size={14}/>}Add relationship</button>
    </form>}
    {loading&&!graph?<div className="discovery-loading"><LoaderCircle size={15}/>Loading relationship graph…</div>:
      graph?.edges.length?<div className="ax-normalized-relationship-list">{graph.edges.map(edge=>{
        const draft=edits[edge.id]||{state:edge.verification_state,evidence:edge.evidence_record_key||"",endDate:edge.effective_to||""};
        return <article key={edge.id} className="ax-normalized-relationship-card">
          <div><strong>{nodeLabels.get(edge.source)||edge.source} <span>→</span> {nodeLabels.get(edge.target)||edge.target}</strong>
            <small>{label(edge.role)} · {label(edge.responsibility)} · From {edge.effective_from}</small>
            {edge.evidence_label&&<small>Evidence: {edge.evidence_label}</small>}
          </div>
          <span className={"discovery-lead-stage stage-"+edge.verification_state}>{label(edge.verification_state)}</span>
          {canEdit&&<div className="ax-normalized-relationship-controls">
            <label>Verification<select value={draft.state} onChange={e=>setEdits(old=>({...old,[edge.id]:{...draft,state:e.target.value}}))}>
              {VERIFICATION.map(item=><option key={item} value={item}>{label(item)}</option>)}
            </select></label>
            <label>Evidence document<select value={draft.evidence} onChange={e=>setEdits(old=>({...old,[edge.id]:{...draft,evidence:e.target.value}}))}>
              <option value="">No evidence</option>{evidenceDocs.map(doc=><option key={doc.id} value={doc.id}>{doc.name}</option>)}
            </select></label>
            <label>End date<input type="date" value={draft.endDate} onChange={e=>setEdits(old=>({...old,[edge.id]:{...draft,endDate:e.target.value}}))}/></label>
            <button type="button" className="secondary-button" onClick={()=>void saveLink(edge)} disabled={busy===edge.id}>{busy===edge.id?<LoaderCircle size={13}/>:<CheckCircle2 size={13}/>}Save</button>
          </div>}
        </article>;
      })}</div>:<p className="ax-relationship-unlinked">No normalized deal-party relationships have been recorded yet.</p>}
    <p className="ax-relationship-footnote">E16 identity fields are immutable. Corrections are represented by a new relationship or an effective end date; evidence-backed verification requires a linked document metadata record.</p>
  </section>;
}
