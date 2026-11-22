import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CalendarClock, CheckCircle2, CircleAlert, ClipboardList, LoaderCircle, RefreshCw, ShieldCheck, UserRound } from "lucide-react";
import { supabase } from "./lib/supabase";

type Deal={id:string;title:string;module:string};
type Contact={id:string;name:string;role?:string};
type Member={user_id:string;role:string};
type Commitment={
  id:string;record_key:string;commitment_type:string;title:string;summary:string;status:string;
  priority:string;next_action_code:string;due_at:string|null;responsible_user_id:string|null;
  deal_record_key:string|null;party_record_key:string|null;due_state:string;days_overdue:number;
  deal_label:string|null;party_label:string|null;updated_at:string;
};
type Props={companyId?:string;companyRole?:string;properties:Deal[];contacts:Contact[]};
const TYPES=["task","promise","obligation","milestone"];
const PRIORITIES=["low","normal","high","urgent"];
const ACTIONS=["review_internal","verify_evidence","prepare_document","collect_internal_input","schedule_internal_review","confirm_milestone","none"];
const STATES=["open","in_progress","blocked","completed","cancelled"];
const label=(value:string)=>String(value||"").replaceAll("_"," ").replace(/\b\w/g,c=>c.toUpperCase());
const dateValue=(value?:string|null)=>value?new Date(value).toISOString().slice(0,10):"";
const localDateTime=(value:string)=>value?new Date(value+"T17:00:00").toISOString():null;

export default function CompanyCommitmentWorkspace({companyId,companyRole,properties,contacts}:Props){
  const canEdit=["owner","admin","manager","staff"].includes(companyRole||"");
  const [rows,setRows]=useState<Commitment[]>([]);
  const [members,setMembers]=useState<Member[]>([]);
  const [currentUserId,setCurrentUserId]=useState("");
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState("");
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [kind,setKind]=useState("task");
  const [title,setTitle]=useState("");
  const [dealKey,setDealKey]=useState("");
  const [partyKey,setPartyKey]=useState("");
  const [assignee,setAssignee]=useState("");
  const [priority,setPriority]=useState("normal");
  const [action,setAction]=useState("review_internal");
  const [dueDate,setDueDate]=useState("");
  const [statusDrafts,setStatusDrafts]=useState<Record<string,string>>({});
  const [dueDrafts,setDueDrafts]=useState<Record<string,string>>({});

  const load=useCallback(async()=>{
    if(!companyId||!supabase){setRows([]);return;}
    setLoading(true);setError("");
    try{
      const [items,people,user]=await Promise.all([
        supabase.from("company_commitment_inbox").select("*").eq("company_id",companyId).order("due_at",{ascending:true}).limit(200),
        supabase.from("company_memberships").select("user_id,role").eq("company_id",companyId).order("role"),
        supabase.auth.getUser()
      ]);
      if(items.error)throw items.error;
      if(people.error)throw people.error;
      setRows((items.data||[]) as Commitment[]);
      setMembers((people.data||[]) as Member[]);
      setCurrentUserId(user.data.user?.id||"");
    }catch(reason){setError(reason instanceof Error?reason.message:"Could not load commitments.");}
    finally{setLoading(false);}
  },[companyId]);
  useEffect(()=>{void load();},[load]);

  const create=async(event:FormEvent)=>{
    event.preventDefault();
    if(!companyId||!supabase||!title.trim())return;
    setBusy("create");setError("");setNotice("");
    try{
      const {error:insertError}=await supabase.from("company_action_commitments").insert({
        company_id:companyId,record_key:"commitment-"+crypto.randomUUID(),
        commitment_type:kind,title:title.trim(),status:"open",priority,next_action_code:action,
        due_at:localDateTime(dueDate),responsible_user_id:assignee||null,
        deal_record_key:dealKey||null,party_record_key:partyKey||null
      });
      if(insertError)throw insertError;
      setTitle("");setDealKey("");setPartyKey("");setDueDate("");
      setNotice("Commitment created with an immutable creation event.");await load();
    }catch(reason){setError(reason instanceof Error?reason.message:"Could not create the commitment.");}
    finally{setBusy("");}
  };

  const update=async(id:string,patch:Record<string,unknown>,key:string,success:string)=>{
    if(!companyId||!supabase)return;
    setBusy(key);setError("");setNotice("");
    try{
      const {error:updateError}=await supabase.from("company_action_commitments").update(patch)
        .eq("company_id",companyId).eq("id",id);
      if(updateError)throw updateError;
      setNotice(success);await load();
    }catch(reason){setError(reason instanceof Error?reason.message:"Commitment update was rejected.");}
    finally{setBusy("");}
  };
  const changeStatus=(row:Commitment)=>{
    const next=statusDrafts[row.id]||row.status;
    if(next===row.status)return;
    const reason=next==="completed"?"completed":next==="cancelled"?"cancelled":
      row.status==="completed"&&next==="in_progress"?"reopened":next==="blocked"?"blocked":"progress";
    void update(row.id,{status:next,change_reason_code:reason},"status-"+row.id,"Commitment status and history updated.");
  };
  const changeDue=(row:Commitment)=>{
    const next=dueDrafts[row.id]??dateValue(row.due_at);
    if(next===dateValue(row.due_at))return;
    void update(row.id,{due_at:localDateTime(next),change_reason_code:"due_date_changed"},"due-"+row.id,"Commitment due date and history updated.");
  };
  const changeAssignee=(row:Commitment,next:string)=>{
    if((row.responsible_user_id||"")===next)return;
    void update(row.id,{responsible_user_id:next||null,change_reason_code:"reassigned"},"assignee-"+row.id,"Responsible member updated.");
  };
  const changePriority=(row:Commitment,next:string)=>{
    if(row.priority===next)return;
    void update(row.id,{priority:next,change_reason_code:"details_updated"},"priority-"+row.id,"Commitment priority updated.");
  };
  if(!companyId)return null;

  return <section className="data-panel ax-commitment-workspace" aria-label="Commitments and operational actions">
    <div className="section-heading">
      <div><span className="section-kicker">E18 · OPERATIONAL EXECUTION</span><h2>Commitments and action register</h2>
        <p>Structured tasks, promises, obligations and milestones linked to company deals and parties. Due status is calculated from the saved date; no reminder or external message is sent.</p></div>
      <button type="button" className="secondary-button" onClick={()=>void load()} disabled={loading}><RefreshCw size={14}/>Refresh</button>
    </div>
    {error&&<div className="discovery-lead-message is-error"><CircleAlert size={15}/>{error}</div>}
    {notice&&<div className="discovery-lead-message"><CheckCircle2 size={15}/>{notice}</div>}
    {!canEdit&&<div className="discovery-readonly"><ShieldCheck size={14}/>Read-only. An owner, admin, manager or staff member must manage commitments.</div>}
    {canEdit&&<form className="ax-commitment-create" onSubmit={event=>void create(event)}>
      <label>Type<select value={kind} onChange={e=>setKind(e.target.value)}>{TYPES.map(item=><option key={item} value={item}>{label(item)}</option>)}</select></label>
      <label className="ax-commitment-title">Title<input required maxLength={200} value={title} onChange={e=>setTitle(e.target.value)} placeholder="What needs to be done or honoured?"/></label>
      <label>Priority<select value={priority} onChange={e=>setPriority(e.target.value)}>{PRIORITIES.map(item=><option key={item} value={item}>{label(item)}</option>)}</select></label>
      <label>Next internal action<select value={action} onChange={e=>setAction(e.target.value)}>{ACTIONS.map(item=><option key={item} value={item}>{label(item)}</option>)}</select></label>
      <label>Due date<input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)} required={kind==="milestone"}/></label>
      <label>Responsible member<select value={assignee} onChange={e=>setAssignee(e.target.value)}>
        <option value="">Unassigned</option>{members.filter(m=>companyRole!=="staff"||m.user_id===currentUserId).map(m=><option key={m.user_id} value={m.user_id}>{label(m.role)} · {m.user_id.slice(0,8)}</option>)}
      </select></label>
      <label>Linked deal<select value={dealKey} onChange={e=>setDealKey(e.target.value)}><option value="">No deal link</option>{properties.map(item=><option key={item.id} value={item.id}>{item.title} · {item.module}</option>)}</select></label>
      <label>Linked party<select value={partyKey} onChange={e=>setPartyKey(e.target.value)}><option value="">No party link</option>{contacts.map(item=><option key={item.id} value={item.id}>{item.name} · {item.role||"Contact"}</option>)}</select></label>
      <button type="submit" className="primary-button" disabled={busy==="create"||!title.trim()}>{busy==="create"?<LoaderCircle size={14}/>:<ClipboardList size={14}/>}Create action</button>
    </form>}
    <div className="ax-commitment-summary">
      <article><strong>{rows.filter(r=>!["completed","cancelled"].includes(r.status)).length}</strong><span>Open</span></article>
      <article><strong>{rows.filter(r=>r.due_state==="overdue").length}</strong><span>Overdue</span></article>
      <article><strong>{rows.filter(r=>r.due_state==="due_today").length}</strong><span>Due today</span></article>
      <article><strong>{rows.filter(r=>r.status==="completed").length}</strong><span>Completed</span></article>
    </div>
    {loading&&!rows.length?<div className="discovery-loading"><LoaderCircle size={15}/>Loading commitments…</div>:
      rows.length?<div className="ax-commitment-list">{rows.map(row=><article key={row.id} className="ax-commitment-card">
        <div className="ax-commitment-card-head"><div><strong>{row.title}</strong><small>{label(row.commitment_type)}{row.deal_label?" · "+row.deal_label:""}{row.party_label?" · "+row.party_label:""}</small></div>
          <span className={"discovery-lead-stage stage-"+row.due_state}>{label(row.due_state)}</span></div>
        {row.summary&&<p>{row.summary}</p>}
        <div className="ax-commitment-card-meta"><span>{label(row.status)}</span><span>{label(row.priority)}</span><span>Due {row.due_at?new Date(row.due_at).toLocaleString():"Not set"}</span>{row.due_state==="overdue"&&<span>{row.days_overdue} days overdue</span>}</div>
        {canEdit&&<div className="ax-commitment-card-controls">
          <label>Status<select value={statusDrafts[row.id]||row.status} disabled={["cancelled"].includes(row.status)||busy==="status-"+row.id}
            onChange={e=>setStatusDrafts(old=>({...old,[row.id]:e.target.value}))}>
            <option value={row.status}>{label(row.status)}</option>
            {(row.status==="completed"?["in_progress"]:STATES.filter(s=>s!==row.status&&!(row.status==="cancelled"))).map(s=><option key={s} value={s}>{label(s)}</option>)}
          </select></label>
          <button type="button" className="secondary-button" onClick={()=>changeStatus(row)} disabled={busy==="status-"+row.id||!(statusDrafts[row.id]&&statusDrafts[row.id]!==row.status)}>Save status</button>
          <label><span><CalendarClock size={12}/>Due date</span><input type="date" value={dueDrafts[row.id]??dateValue(row.due_at)} disabled={["completed","cancelled"].includes(row.status)} onChange={e=>setDueDrafts(old=>({...old,[row.id]:e.target.value}))}/></label>
          <button type="button" className="secondary-button" onClick={()=>changeDue(row)} disabled={busy==="due-"+row.id}>Save date</button>
          <label><span><UserRound size={12}/>Responsible member</span><select value={row.responsible_user_id||""} disabled={busy==="assignee-"+row.id} onChange={e=>changeAssignee(row,e.target.value)}>
            <option value="">Unassigned</option>{members.filter(m=>companyRole!=="staff"||m.user_id===currentUserId).map(m=><option key={m.user_id} value={m.user_id}>{label(m.role)} · {m.user_id.slice(0,8)}</option>)}
          </select></label>
          <label>Priority<select value={row.priority} disabled={busy==="priority-"+row.id} onChange={e=>changePriority(row,e.target.value)}>
            {PRIORITIES.map(value=><option key={value} value={value}>{label(value)}</option>)}
          </select></label>
        </div>}
      </article>)}</div>:<p className="ax-relationship-unlinked">No structured commitments have been added in this company workspace yet.</p>}
    <p className="ax-relationship-footnote">Commitments are retained as auditable records. Existing device-local tasks are not automatically copied or removed; recurring reminders and message delivery are not enabled by this stage.</p>
  </section>;
}
