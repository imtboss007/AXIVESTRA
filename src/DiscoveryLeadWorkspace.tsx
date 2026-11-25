import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabase";
import { ArrowRight, CalendarClock, CheckCircle2, CircleAlert, ClipboardList, LoaderCircle, RefreshCw, Search, ShieldCheck, UserRound, XCircle } from "lucide-react";

type Candidate = { legal_name?: string; jurisdiction?: string; entity_type?: string } | null;
type Match = {
  id: string; canonical_entity_id: string; workspace_key: string; discovery_mode?: "LENDER" | "CUSTOMER" | null; criteria_version: string;
  score: number; confidence: number; eligible: boolean; positive_factors: unknown[];
  negative_factors: unknown[]; unknown_criteria: string[]; blockers: string[];
  created_at: string; candidate: Candidate;
};
type LeadEvent = {
  id: string; event_type: string; previous_status?: string | null; new_status?: string | null;
  previous_priority?: string | null; new_priority?: string | null; reason_code: string; occurred_at: string;
};
type Lead = {
  id: string; match_result_id: string; workspace_key: string; status: string; priority: string;
  assigned_to: string | null; next_action_code: string; next_action_due_at: string | null;
  updated_at: string; candidate: Candidate; match: { score: number; confidence: number; eligible: boolean; discovery_mode?: "LENDER" | "CUSTOMER" | null } | null;
  events: LeadEvent[];
};
type Member = { user_id: string; role: string };
type Response = { ok?: boolean; error?: string; matches?: Match[]; leads?: Lead[]; members?: Member[]; lead?: Lead; review?: unknown };
const STAGES = ["inbox","reviewing","qualified","due_diligence","proposal","negotiation","on_hold","won","lost","disqualified"];
const PRIORITIES = ["low","normal","high","urgent"];
const NEXT_ACTIONS = [
  ["none","No next action"],
  ["review_company_profile","Review company profile"],
  ["verify_registration","Verify registration"],
  ["review_evidence","Review source evidence"],
  ["request_internal_documents","Request internal documents"],
  ["prepare_internal_brief","Prepare internal brief"],
  ["schedule_internal_review","Schedule internal review"],
  ["confirm_eligibility","Confirm eligibility"]
] as const;
const NEXT_STAGE: Record<string,string[]> = {
  inbox:["reviewing","on_hold","disqualified"],
  reviewing:["qualified","due_diligence","on_hold","disqualified"],
  qualified:["due_diligence","proposal","on_hold","disqualified"],
  due_diligence:["proposal","negotiation","on_hold","disqualified"],
  proposal:["negotiation","won","lost","on_hold"],
  negotiation:["won","lost","on_hold"],
  on_hold:["reviewing","qualified","due_diligence","proposal","negotiation","disqualified"],
  won:["reviewing"], lost:["reviewing"], disqualified:["reviewing"]
};
const label = (value: string) => value.replaceAll("_"," ").replace(/\b\w/g, char=>char.toUpperCase());
const modeLabel = (value?: string | null) => value === "LENDER" ? "Lender" : value === "CUSTOMER" ? "Customer" : "Unclassified";
const localDate = (value?: string | null) => value ? new Date(value).toLocaleDateString() : "Not set";
const dateInput = (value?: string | null) => value ? new Date(value).toISOString().slice(0,10) : "";

export default function DiscoveryLeadWorkspace({companyId,companyRole}:{companyId?:string;companyRole?:string}) {
  const canManage = companyRole === "owner" || companyRole === "admin";
  const [matches,setMatches] = useState<Match[]>([]);
  const [leads,setLeads] = useState<Lead[]>([]);
  const [members,setMembers] = useState<Member[]>([]);
  const [filter,setFilter] = useState("active");
  const [modeFilter,setModeFilter] = useState<"all"|"LENDER"|"CUSTOMER">("all");
  const [searchQuery,setSearchQuery] = useState("");
  const [rejectReasons,setRejectReasons] = useState<Record<string,string>>({});
  const [nextDrafts,setNextDrafts] = useState<Record<string,{code:string;date:string}>>({});
  const [busy,setBusy] = useState("");
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");

  const invoke = useCallback(async(action:string,payload:Record<string,unknown>={})=>{
    if(!companyId) throw new Error("Open an authenticated company workspace first.");
    if(!supabase) throw new Error("Cloud authentication is not configured for this workspace.");
    const {data,error:invokeError}=await supabase.functions.invoke("discovery-control",{body:{companyId,action,payload}});
    if(invokeError) throw new Error(invokeError.message||"The discovery service could not be reached.");
    const result=data as Response|null;
    if(!result?.ok) throw new Error(result?.error||"The lead workflow action was not accepted.");
    return result;
  },[companyId]);

  const refresh=useCallback(async()=>{
    if(!companyId)return;
    setLoading(true);setError("");
    try{
      const [matchResult,leadResult,memberResult]=await Promise.all([
        invoke("matches.list"),invoke("leads.list"),invoke("members.list")
      ]);
      setMatches(matchResult.matches||[]);
      setLeads(leadResult.leads||[]);
      setMembers(memberResult.members||[]);
    }catch(reason){setError(reason instanceof Error?reason.message:"Could not load the lead workspace.");}
    finally{setLoading(false);}
  },[companyId,invoke]);
  useEffect(()=>{void refresh();},[refresh]);

  const normalizedSearch=searchQuery.trim().toLocaleLowerCase();
  const scopedMatches=useMemo(()=>modeFilter==="all"?matches:matches.filter(match=>match.discovery_mode===modeFilter),[matches,modeFilter]);
  const scopedLeads=useMemo(()=>modeFilter==="all"?leads:leads.filter(lead=>lead.match?.discovery_mode===modeFilter),[leads,modeFilter]);
  const visibleMatches=useMemo(()=>scopedMatches.filter(match=>{
    if(!normalizedSearch)return true;
    return [match.candidate?.legal_name,match.candidate?.jurisdiction,match.candidate?.entity_type,match.workspace_key,match.discovery_mode]
      .some(value=>String(value||"").toLocaleLowerCase().includes(normalizedSearch));
  }),[scopedMatches,normalizedSearch]);
  const visibleLeads=useMemo(()=>{
    const byStage=filter==="all"?scopedLeads:filter==="active"
      ?scopedLeads.filter(lead=>!["won","lost","disqualified"].includes(lead.status))
      :scopedLeads.filter(lead=>lead.status===filter);
    return byStage.filter(lead=>{
      if(!normalizedSearch)return true;
      return [lead.candidate?.legal_name,lead.workspace_key,lead.match?.discovery_mode,lead.status,lead.priority]
        .some(value=>String(value||"").toLocaleLowerCase().includes(normalizedSearch));
    });
  },[filter,scopedLeads,normalizedSearch]);

  const runAction=async(key:string,action:string,payload:Record<string,unknown>,success:string)=>{
    setBusy(key);setError("");setNotice("");
    try{await invoke(action,payload);setNotice(success);await refresh();}
    catch(reason){setError(reason instanceof Error?reason.message:"The lead workflow action failed.");}
    finally{setBusy("");}
  };

  const reviewMatch=(match:Match,decision:"accepted_for_review"|"rejected")=>{
    const reasonCode=decision==="accepted_for_review"?"match_confirmed":(rejectReasons[match.id]||"insufficient_evidence");
    void runAction("match-"+match.id,"matches.review",{matchResultId:match.id,decision,reasonCode},
      decision==="accepted_for_review"?"Match accepted into the human-reviewed lead inbox.":"Match rejected with an immutable review receipt.");
  };
  const assign=(lead:Lead,assigneeId:string)=>{
    const reasonCode=!assigneeId?"unassigned":lead.assigned_to?"reassignment":"assignment_change";
    void runAction("assign-"+lead.id,"leads.assign",{leadId:lead.id,assigneeId:assigneeId||null,reasonCode},
      assigneeId?"Lead assignment updated.":"Lead unassigned.");
  };
  const transition=(lead:Lead,status:string)=>{
    const reasonCode=status==="won"?"deal_won":status==="lost"?"deal_lost":status==="disqualified"?"not_a_fit"
      :status==="on_hold"?"awaiting_information":["won","lost","disqualified"].includes(lead.status)?"reopened":"stage_progress";
    void runAction("stage-"+lead.id,"leads.transition",{leadId:lead.id,status,reasonCode},
      "Lead stage updated.");
  };
  const priority=(lead:Lead,value:string)=>{
    void runAction("priority-"+lead.id,"leads.priority",{leadId:lead.id,priority:value},"Lead priority updated.");
  };
  const saveNextAction=(lead:Lead)=>{
    const draft=nextDrafts[lead.id]||{code:lead.next_action_code,date:dateInput(lead.next_action_due_at)};
    const dueAt=draft.code==="none"||!draft.date?null:new Date(draft.date+"T17:00:00").toISOString();
    void runAction("next-"+lead.id,"leads.next-action",{leadId:lead.id,nextActionCode:draft.code,dueAt},
      "Next action and due date saved.");
  };

  if(!companyId) return <section className="discovery-lead-panel"><div className="discovery-empty-inline"><ShieldCheck size={16}/>A company workspace is required to view discovery leads.</div></section>;

  return <section className="discovery-lead-panel">
    <div className="discovery-lead-heading">
      <div><span className="section-kicker">E15 · HUMAN REVIEW WORKFLOW</span><h2>Lead review & workspace pipeline</h2>
        <p>Only owner/admin-accepted E11 matches become leads. Assignment, stage and next actions are internal workflow records; no outreach or financial decision is automated.</p></div>
      <button type="button" className="secondary-button" onClick={()=>void refresh()} disabled={loading}><RefreshCw size={14}/>Refresh</button>
    </div>
    {error&&<div className="discovery-lead-message is-error"><CircleAlert size={15}/>{error}</div>}
    {notice&&<div className="discovery-lead-message"><CheckCircle2 size={15}/>{notice}</div>}
    {!canManage&&<div className="discovery-readonly"><ShieldCheck size={14}/>Read-only workspace. A company owner or admin must review matches and update lead workflow.</div>}

    <div className="discovery-lead-filters" role="toolbar" aria-label="Lender and customer workspace filters">
      <div className="discovery-mode-switch" role="group" aria-label="Workspace mode">
        <button type="button" className={modeFilter==="all"?"is-active":""} aria-pressed={modeFilter==="all"} onClick={()=>setModeFilter("all")}>All workspaces</button>
        <button type="button" className={modeFilter==="LENDER"?"is-active":""} aria-pressed={modeFilter==="LENDER"} onClick={()=>setModeFilter("LENDER")}>Lender</button>
        <button type="button" className={modeFilter==="CUSTOMER"?"is-active":""} aria-pressed={modeFilter==="CUSTOMER"} onClick={()=>setModeFilter("CUSTOMER")}>Customer</button>
      </div>
      <label className="discovery-lead-search">
        <Search size={15} aria-hidden="true"/>
        <input type="search" value={searchQuery} onChange={event=>setSearchQuery(event.target.value)} placeholder="Search companies, workspace or stage" aria-label="Search lender and customer records"/>
        {searchQuery&&<button type="button" onClick={()=>setSearchQuery("")} aria-label="Clear search">Clear</button>}
      </label>
    </div>

    <div className="discovery-lead-stats">
      <div><strong>{scopedMatches.length}</strong><span>Matches awaiting review</span></div>
      <div><strong>{scopedLeads.filter(x=>!["won","lost","disqualified"].includes(x.status)).length}</strong><span>Active leads</span></div>
      <div><strong>{scopedLeads.filter(x=>x.status==="won").length}</strong><span>Won</span></div>
      <div><strong>{scopedLeads.filter(x=>x.status==="lost"||x.status==="disqualified").length}</strong><span>Closed / disqualified</span></div>
    </div>

    <div className="discovery-lead-section-head"><div><span className="section-kicker">E11 → E15</span><h3>Workspace matches awaiting human review</h3><small className="discovery-result-count">Showing {visibleMatches.length} of {scopedMatches.length} pending matches</small></div></div>
    {loading&&!matches.length?<div className="discovery-loading"><LoaderCircle size={15}/>Loading match review queue…</div>:
      visibleMatches.length?<div className="discovery-match-list">{visibleMatches.map(match=><article className="discovery-match-card" key={match.id}>
        <div className="discovery-match-top">
          <div><strong>{match.candidate?.legal_name||"Canonical company record"}</strong><small>{label(match.workspace_key)} · {modeLabel(match.discovery_mode)} · {match.candidate?.jurisdiction||"Jurisdiction not recorded"} · {match.candidate?.entity_type||"Entity type not recorded"}</small><span className={"discovery-mode-pill mode-"+(match.discovery_mode||"unknown").toLowerCase()}>{modeLabel(match.discovery_mode)} workspace</span></div>
          <div className="discovery-match-score"><b>{Number(match.score).toFixed(1)}%</b><small>{Math.round(Number(match.confidence)*100)}% confidence</small><div className="discovery-match-meter" role="img" aria-label={"Match score "+Number(match.score).toFixed(1)+" percent"}><span style={{width:`${Math.min(100,Math.max(0,Number(match.score)||0))}%`}}/></div></div>
        </div>
        <div className="discovery-match-factors">
          <span className={match.eligible?"is-eligible":"is-blocked"}>{match.eligible?"Eligible for review":"Required blocker present"}</span>
          <span>{match.positive_factors?.length||0} positive factors</span>
          <span>{match.unknown_criteria?.length||0} unknown criteria</span>
          {match.blockers?.length>0&&<span>Blockers: {match.blockers.map(label).join(", ")}</span>}
        </div>
        {match.negative_factors?.length>0&&<p className="discovery-match-note">Negative factors: {match.negative_factors.map((item:any)=>typeof item==="string"?label(item):label(String(item.criterion||"criterion"))).join(" · ")}</p>}
        {canManage&&<div className="discovery-match-actions">
          <label>Rejection reason<select value={rejectReasons[match.id]||"insufficient_evidence"} onChange={e=>setRejectReasons(current=>({...current,[match.id]:e.target.value}))}>
            <option value="insufficient_evidence">Insufficient evidence</option><option value="policy_mismatch">Policy mismatch</option>
            <option value="duplicate_candidate">Duplicate candidate</option><option value="out_of_scope">Out of scope</option><option value="other_review">Other review reason</option>
          </select></label>
          <div className="discovery-action-row">
            <button type="button" className="primary-button" onClick={()=>reviewMatch(match,"accepted_for_review")} disabled={!match.eligible||busy==="match-"+match.id}>
              {busy==="match-"+match.id?<LoaderCircle size={14}/>:<CheckCircle2 size={14}/>}Accept for lead review
            </button>
            <button type="button" className="secondary-button" onClick={()=>reviewMatch(match,"rejected")} disabled={busy==="match-"+match.id}><XCircle size={14}/>Reject</button>
          </div>
        </div>}
      </article>)}</div>:<div className="discovery-empty-inline"><ClipboardList size={15}/>{matches.length?"No pending matches match this workspace/search filter.":"No E11 matches are awaiting review. Pending matches will appear here when the matching engine records them."}</div>}

    <div className="discovery-lead-section-head discovery-lead-pipeline-head">
      <div><span className="section-kicker">COMPANY WORKSPACE</span><h3>Lead pipeline</h3></div>
      <select value={filter} onChange={e=>setFilter(e.target.value)} aria-label="Filter leads">
        <option value="active">Active leads</option><option value="all">All leads</option>
        {STAGES.map(stage=><option key={stage} value={stage}>{label(stage)}</option>)}
      </select>
    </div>
    {visibleLeads.length?<div className="discovery-lead-list">{visibleLeads.map(lead=>{
      const draft=nextDrafts[lead.id]||{code:lead.next_action_code,date:dateInput(lead.next_action_due_at)};
      const nextOptions=NEXT_STAGE[lead.status]||[];
      const assignee=members.find(member=>member.user_id===lead.assigned_to);
      return <article className="discovery-lead-card" key={lead.id}>
        <div className="discovery-lead-card-head">
          <div><strong>{lead.candidate?.legal_name||"Canonical company record"}</strong><small>{label(lead.workspace_key)} · {modeLabel(lead.match?.discovery_mode)} · Match {lead.match?Number(lead.match.score).toFixed(1)+"%":"—"} · Updated {localDate(lead.updated_at)}</small><span className={"discovery-mode-pill mode-"+(lead.match?.discovery_mode||"unknown").toLowerCase()}>{modeLabel(lead.match?.discovery_mode)} workspace</span></div>
          <span className={"discovery-lead-stage stage-"+lead.status+" priority-"+lead.priority}>{label(lead.status)}</span>
        </div>
        <div className="discovery-lead-controls">
          <label><span><UserRound size={12}/>Assigned member</span><select value={lead.assigned_to||""} disabled={!canManage||busy==="assign-"+lead.id} onChange={e=>assign(lead,e.target.value)}>
            <option value="">Unassigned</option>{members.map(member=><option key={member.user_id} value={member.user_id}>{label(member.role)} · {member.user_id.slice(0,8)}</option>)}
          </select></label>
          <label>Priority<select value={lead.priority} disabled={!canManage||busy==="priority-"+lead.id} onChange={e=>priority(lead,e.target.value)}>{PRIORITIES.map(item=><option key={item} value={item}>{label(item)}</option>)}</select></label>
          <label>Move stage<select value={lead.status} disabled={!canManage||!nextOptions.length||busy==="stage-"+lead.id} onChange={e=>transition(lead,e.target.value)}>
            <option value={lead.status}>{label(lead.status)}</option>{nextOptions.map(stage=><option key={stage} value={stage}>{label(stage)}</option>)}
          </select></label>
        </div>
        <div className="discovery-lead-next">
          <label>Next internal action<select value={draft.code} disabled={!canManage} onChange={e=>setNextDrafts(current=>({...current,[lead.id]:{...draft,code:e.target.value}}))}>
            {NEXT_ACTIONS.map(([value,text])=><option key={value} value={value}>{text}</option>)}
          </select></label>
          <label><span><CalendarClock size={12}/>Due date</span><input type="date" value={draft.date} disabled={!canManage||draft.code==="none"} onChange={e=>setNextDrafts(current=>({...current,[lead.id]:{...draft,date:e.target.value}}))}/></label>
          {canManage&&<button type="button" className="secondary-button" onClick={()=>saveNextAction(lead)} disabled={busy==="next-"+lead.id}><ArrowRight size={13}/>Save action</button>}
        </div>
        {lead.events?.length>0&&<div className="discovery-lead-history"><b>Recent activity</b>{lead.events.slice(0,3).map(event=><span key={event.id}>{label(event.event_type)}{event.new_status?" · "+label(event.new_status):""} · {localDate(event.occurred_at)}</span>)}</div>}
        {assignee&&<small className="discovery-lead-assignee">Assigned to {label(assignee.role)} member {assignee.user_id.slice(0,8)}</small>}
      </article>;
    })}</div>:<div className="discovery-empty-inline"><ClipboardList size={15}/>No leads match this pipeline filter.</div>}
    <div className="discovery-lead-footer"><ShieldCheck size={14}/>All review and workflow changes create immutable event and provenance receipts. No email, phone, WhatsApp, underwriting or external outreach is triggered.</div>
  </section>;
}
