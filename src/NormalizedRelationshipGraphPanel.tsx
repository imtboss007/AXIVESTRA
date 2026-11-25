import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { CheckCircle2, CircleAlert, LoaderCircle, Network, RefreshCw, ShieldCheck, Link2 } from "lucide-react";
import { supabase } from "./lib/supabase";
import type { EChartsOption } from "echarts";

const PortfolioEChart = lazy(() => import("./components/PortfolioEChart"));

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
const EDGE_COLORS:Record<string,string>={verified:"#2f8b69",evidence_supported:"#4e8da4",claimed:"#b58a50",unverified:"#96a394",disputed:"#c65e58",rejected:"#b94747"};

export default function NormalizedRelationshipGraphPanel({companyId,companyRole,contacts,properties}:Props) {
  const canEdit=["owner","admin","manager","staff"].includes(companyRole||"");
  const [graph,setGraph]=useState<GraphResult|null>(null);
  const [evidenceDocs,setEvidenceDocs]=useState<Evidence[]>([]);
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState("");
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [dealKey,setDealKey]=useState("");
  const [partyKey,setPartyKey]=useState("");
  const [role,setRole]=useState("buyer");
  const [responsibility,setResponsibility]=useState("participant");
  const [edits,setEdits]=useState<Record<string,{state:string;evidence:string;endDate:string}>>({});
  const [selectedNodeId,setSelectedNodeId]=useState("");

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
  const selectedNode=graph?.nodes.find(node=>node.id===selectedNodeId);
  const visibleEdges=useMemo(()=>!graph?[]:selectedNodeId
    ? graph.edges.filter(edge=>edge.source===selectedNodeId||edge.target===selectedNodeId)
    : graph.edges,[graph,selectedNodeId]);
  const selectGraphNode=useCallback((nodeId:string)=>{
    if(graph?.nodes.some(node=>node.id===nodeId))setSelectedNodeId(nodeId);
  },[graph]);
  const graphOption=useMemo<EChartsOption>(()=>{
    if(!graph)return {};
    const degree=new Map<string,number>();
    graph.edges.forEach(edge=>{
      degree.set(edge.source,(degree.get(edge.source)||0)+1);
      degree.set(edge.target,(degree.get(edge.target)||0)+1);
    });
    return {
      animationDuration:320,
      backgroundColor:"transparent",
      tooltip:{
        trigger:"item",
        confine:true,
        formatter:(params)=>{
          const item=Array.isArray(params)?params[0]:params;
          const raw=item?.data;
          if(!raw||typeof raw!=="object")return "";
          const data=raw as Record<string,unknown>;
          if("source" in data&&"target" in data){
            const source=nodeLabels.get(String(data.source))||String(data.source);
            const target=nodeLabels.get(String(data.target))||String(data.target);
            return source+" → "+target+"<br/>"+label(String(data.role||data.value||"Relationship"))+"<br/>"+label(String(data.verification_state||"unverified"));
          }
          const name=String(data.label||nodeLabels.get(String(data.id||item?.name))||item?.name||"");
          return name+"<br/>"+(data.kind==="deal"?"Deal / workspace":"Person / contact");
        }
      },
      legend:{
        top:8,right:12,
        data:["Deal / Workspace","Person / Contact"],
        textStyle:{color:"#627469",fontSize:10}
      },
      series:[{
        type:"graph",
        layout:"force",
        roam:true,
        draggable:true,
        data:graph.nodes.map(node=>({
          id:node.id,
          name:node.id,
          kind:node.kind,
          value:node.label,
          label:{show:true,formatter:node.label,color:"#33483a",fontSize:10,position:"right"},
          category:node.kind==="deal"?0:1,
          symbolSize:Math.min(48,26+(degree.get(node.id)||0)*5),
          itemStyle:{color:node.kind==="deal"?"#438f83":"#b58a50",borderColor:"#ffffff",borderWidth:2}
        })),
        links:graph.edges.map(edge=>({
          id:edge.id,
          name:edge.id,
          source:edge.source,
          target:edge.target,
          value:1,
          role:edge.role,
          verification_state:edge.verification_state,
          lineStyle:{
            color:EDGE_COLORS[edge.verification_state]||EDGE_COLORS.unverified,
            opacity:0.76,
            width:edge.verification_state==="verified"?2.2:1.4
          }
        })),
        categories:[
          {name:"Deal / Workspace",itemStyle:{color:"#438f83"}},
          {name:"Person / Contact",itemStyle:{color:"#b58a50"}}
        ],
        force:{repulsion:320,edgeLength:[105,175],gravity:0.08,friction:0.65,layoutAnimation:true},
        edgeSymbol:["none","arrow"],
        edgeSymbolSize:[0,7],
        lineStyle:{opacity:0.72,curveness:0.16},
        edgeLabel:{show:false},
        emphasis:{focus:"adjacency",scale:1.08,lineStyle:{width:2.8,opacity:1},label:{show:true}}
      }]
    };
  },[graph,nodeLabels]);
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
    {graph && graph.edges.length > 0 && <div className="ax-normalized-relationship-visual" aria-label="Interactive relationship network">
      <div className="ax-normalized-relationship-visual-head">
        <div><strong>Relationship network</strong><small>Drag nodes to arrange · scroll or pinch to zoom · select a node to focus its relationships</small></div>
        <label>Focus node<select aria-label="Focus relationship node" value={selectedNodeId} onChange={event=>setSelectedNodeId(event.target.value)}>
          <option value="">All relationships</option>
          {graph.nodes.map(node=><option key={node.id} value={node.id}>{node.label} · {node.kind==="deal"?"Deal":"Person"}</option>)}
        </select></label>
      </div>
      <Suspense fallback={<div className="discovery-loading"><LoaderCircle size={15}/>Loading relationship visualisation…</div>}>
        <PortfolioEChart option={graphOption} ariaLabel="Interactive relationship graph. Nodes represent saved deals and contacts; arrows represent explicitly recorded roles. Use the node selector to focus the evidence register." onSelect={selectGraphNode}/>
      </Suspense>
    </div>}
    {loading&&!graph?<div className="discovery-loading"><LoaderCircle size={15}/>Loading relationship graph…</div>:
      graph?.edges.length?<div className="ax-normalized-relationship-list">
        {selectedNode&&<div className="ax-normalized-relationship-filter-summary">
          <span>Showing {visibleEdges.length} relationship(s) connected to <strong>{selectedNode.label}</strong></span>
          <button type="button" className="text-button" onClick={()=>setSelectedNodeId("")}>Clear focus</button>
        </div>}
        {visibleEdges.map(edge=>{
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
