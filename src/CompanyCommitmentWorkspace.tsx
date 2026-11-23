import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { CalendarClock, CheckCircle2, CircleAlert, ClipboardList, LoaderCircle, RefreshCw, ShieldCheck, UserRound, Pencil, Link2, FileCheck2 } from "lucide-react";
import { supabase } from "./lib/supabase";

type Deal={id:string;title:string;module:string};
type Contact={id:string;name:string;role?:string};
type Member={user_id:string;role:string};
type LegacyTask={id:string;title:string;date:string;time:string;type:string;property:string;propertyId?:string;contactId?:string;notes:string;done:boolean;priority?:string;nextAction?:string};
type Relationship={id:string;deal_record_key:string;party_record_key:string;role_code:string;responsibility_code:string;verification_state:string;effective_to:string|null};
type LegacyTaskRow={record_key:string;payload:LegacyTask};
type Commitment={
  id:string;record_key:string;commitment_type:string;title:string;summary:string;status:string;
  priority:string;next_action_code:string;due_at:string|null;responsible_user_id:string|null;
  deal_record_key:string|null;party_record_key:string|null;relationship_id:string|null;
  source_task_record_key:string|null;due_state:string;days_overdue:number;
  deal_label:string|null;party_label:string|null;updated_at:string;
};
type DetailDraft={title:string;summary:string;nextAction:string;relationshipId:string};
type Props={companyId?:string;companyRole?:string;properties:Deal[];contacts:Contact[];tasks?:LegacyTask[]};
const TYPES=["task","promise","obligation","milestone"];
const PRIORITIES=["low","normal","high","urgent"];
const ACTIONS=["review_internal","verify_evidence","prepare_document","collect_internal_input","schedule_internal_review","confirm_milestone","none"];
const STATES=["open","in_progress","blocked","completed","cancelled"];
const label=(value:string)=>String(value||"").replaceAll("_"," ").replace(/\b\w/g,c=>c.toUpperCase());
const dateValue=(value?:string|null)=>value?new Date(value).toISOString().slice(0,10):"";
const localDateTime=(value:string)=>value?new Date(value+"T17:00:00").toISOString():null;
const taskDue=(task:LegacyTask)=>{
  if(!task.date)return null;
  const time=/^\d{2}:\d{2}$/.test(task.time||"")?task.time:"17:00";
  const value=new Date(task.date+"T"+time+":00");
  return Number.isNaN(value.getTime())?null:value.toISOString();
};
const safePriority=(value?:string)=>PRIORITIES.includes(String(value||"").toLowerCase())?String(value).toLowerCase():"normal";
const safeAction=(value?:string)=>ACTIONS.includes(String(value||""))?String(value):"review_internal";

export default function CompanyCommitmentWorkspace({companyId,companyRole,properties,contacts,tasks=[]}:Props){
  const canEdit=["owner","admin","manager","staff"].includes(companyRole||"");
  const [rows,setRows]=useState<Commitment[]>([]);
  const [members,setMembers]=useState<Member[]>([]);
  const [relationships,setRelationships]=useState<Relationship[]>([]);
  const [legacyTaskRows,setLegacyTaskRows]=useState<LegacyTaskRow[]>([]);
  const [currentUserId,setCurrentUserId]=useState("");
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState("");
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [kind,setKind]=useState("task");
  const [title,setTitle]=useState("");
  const [summary,setSummary]=useState("");
  const [dealKey,setDealKey]=useState("");
  const [partyKey,setPartyKey]=useState("");
  const [relationshipId,setRelationshipId]=useState("");
  const [assignee,setAssignee]=useState("");
  const [priority,setPriority]=useState("normal");
  const [action,setAction]=useState("review_internal");
  const [dueDate,setDueDate]=useState("");
  const [legacyTaskKey,setLegacyTaskKey]=useState("");
  const [statusDrafts,setStatusDrafts]=useState<Record<string,string>>({});
  const [dueDrafts,setDueDrafts]=useState<Record<string,string>>({});
  const [detailDrafts,setDetailDrafts]=useState<Record<string,DetailDraft>>({});
  const [editingDetails,setEditingDetails]=useState<Record<string,boolean>>({});

  const load=useCallback(async()=>{
    if(!companyId||!supabase){setRows([]);setMembers([]);setRelationships([]);setLegacyTaskRows([]);return;}
    setLoading(true);setError("");
    try{
      const [items,people,user,links,sourceTasks]=await Promise.all([
        supabase.from("company_commitment_inbox").select("*").eq("company_id",companyId).order("due_at",{ascending:true}).limit(500),
        supabase.from("company_memberships").select("user_id,role").eq("company_id",companyId).order("role"),
        supabase.auth.getUser(),
        supabase.from("company_deal_parties").select("id,deal_record_key,party_record_key,role_code,responsibility_code,verification_state,effective_to").eq("company_id",companyId).limit(1000),
        supabase.from("company_records").select("record_key,payload").eq("company_id",companyId).eq("record_type","task").is("deleted_at",null).order("record_key").limit(1000)
      ]);
      if(items.error)throw items.error;
      if(people.error)throw people.error;
      if(links.error)throw links.error;
      if(sourceTasks.error)throw sourceTasks.error;
      setRows((items.data||[]) as Commitment[]);
      setMembers((people.data||[]) as Member[]);
      setCurrentUserId(user.data.user?.id||"");
      setRelationships((links.data||[]) as Relationship[]);
      setLegacyTaskRows((sourceTasks.data||[]).map((row:{record_key:string;payload:LegacyTask})=>({record_key:row.record_key,payload:{...row.payload,id:row.record_key}})));
    }catch(reason){setError(reason instanceof Error?reason.message:"Could not load commitments.");}
    finally{setLoading(false);}
  },[companyId]);
  useEffect(()=>{void load();},[load]);

  const activeRelationships=useMemo(()=>relationships.filter(link=>!link.effective_to||link.effective_to>=new Date().toISOString().slice(0,10)),[relationships]);
  const createRelationships=useMemo(()=>activeRelationships.filter(link=>link.deal_record_key===dealKey&&link.party_record_key===partyKey),[activeRelationships,dealKey,partyKey]);
  const linkedTaskKeys=useMemo(()=>new Set(rows.map(row=>row.source_task_record_key).filter((value):value is string=>Boolean(value))),[rows]);
  const unlinkedLegacyTasks=useMemo(()=>legacyTaskRows.filter(row=>!linkedTaskKeys.has(row.record_key)),[legacyTaskRows,linkedTaskKeys]);
  const syncedTaskKeys=useMemo(()=>new Set(legacyTaskRows.map(row=>row.record_key)),[legacyTaskRows]);
  const unsyncedLocalTaskCount=tasks.filter(task=>!syncedTaskKeys.has(task.id)).length;

  const create=async(event:FormEvent)=>{
    event.preventDefault();
    if(!companyId||!supabase||!title.trim())return;
    setBusy("create");setError("");setNotice("");
    try{
      const {error:insertError}=await supabase.from("company_action_commitments").insert({
        company_id:companyId,record_key:"commitment-"+crypto.randomUUID(),
        commitment_type:kind,title:title.trim(),summary:summary.trim(),status:"open",priority,next_action_code:action,
        due_at:localDateTime(dueDate),responsible_user_id:assignee||null,
        deal_record_key:dealKey||null,party_record_key:partyKey||null,relationship_id:relationshipId||null
      });
      if(insertError)throw insertError;
      setTitle("");setSummary("");setDealKey("");setPartyKey("");setRelationshipId("");setDueDate("");setAssignee("");
      setNotice("Commitment created. Its creation event is retained in the immutable history.");await load();
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
  const beginEditDetails=(row:Commitment)=>{
    setDetailDrafts(old=>({...old,[row.id]:{title:row.title,summary:row.summary||"",nextAction:row.next_action_code,relationshipId:row.relationship_id||""}}));
    setEditingDetails(old=>({...old,[row.id]:true}));
  };
  const saveDetails=(row:Commitment)=>{
    const draft=detailDrafts[row.id];
    if(!draft||!draft.title.trim())return;
    if(draft.relationshipId&&!activeRelationships.some(link=>link.id===draft.relationshipId&&link.deal_record_key===row.deal_record_key&&link.party_record_key===row.party_record_key)){
      setError("Choose a relationship connected to this commitment's saved deal and party.");return;
    }
    void update(row.id,{title:draft.title.trim(),summary:draft.summary.trim(),next_action_code:draft.nextAction,relationship_id:draft.relationshipId||null,change_reason_code:"details_updated"},"details-"+row.id,"Commitment details and relationship updated with an audit event.");
    setEditingDetails(old=>({...old,[row.id]:false}));
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

  const importLegacyTask=async()=>{
    const source=unlinkedLegacyTasks.find(item=>item.record_key===legacyTaskKey);
    if(!companyId||!supabase||!source)return;
    const task=source.payload;
    const dealKey=task.propertyId&&properties.some(item=>item.id===task.propertyId)?task.propertyId:null;
    const partyKey=task.contactId&&contacts.some(item=>item.id===task.contactId)?task.contactId:null;
    setBusy("import");setError("");setNotice("");
    try{
      const {data:created,error:insertError}=await supabase.from("company_action_commitments").insert({
        company_id:companyId,record_key:"commitment-"+crypto.randomUUID(),
        commitment_type:"task",title:String(task.title||"Imported legacy task").slice(0,200),
        summary:String(task.notes||"Imported from the existing task register").slice(0,1000),
        status:"open",priority:safePriority(task.priority),next_action_code:safeAction(task.nextAction),
        due_at:taskDue(task),responsible_user_id:null,deal_record_key:dealKey,party_record_key:partyKey,
        relationship_id:null,source_task_record_key:source.record_key
      }).select("id").single();
      if(insertError)throw insertError;
      if(task.done&&created?.id){
        const {error:closeError}=await supabase.from("company_action_commitments").update({status:"completed",change_reason_code:"completed"})
          .eq("company_id",companyId).eq("id",created.id);
        if(closeError)throw new Error("The commitment was linked, but the completed state could not be copied: "+closeError.message);
      }
      setLegacyTaskKey("");setNotice(task.done?"Completed legacy task linked; the original task remains unchanged.":"Legacy task linked as a structured commitment; the original task remains unchanged.");
      await load();
    }catch(reason){setError(reason instanceof Error?reason.message:"Could not link the legacy task.");}
    finally{setBusy("");}
  };

  if(!companyId)return null;
  return <section className="data-panel ax-commitment-workspace" aria-label="Commitments and operational actions">
    <div className="section-heading">
      <div><span className="section-kicker">E18 · OPERATIONAL EXECUTION</span><h2>Commitments and action register</h2>
        <p>Structured tasks, promises, obligations and milestones linked to company deals, parties and existing tasks. Due status is calculated from the saved date; no reminder or external message is sent.</p></div>
      <button type="button" className="secondary-button" onClick={()=>void load()} disabled={loading}><RefreshCw size={14}/>Refresh</button>
    </div>
    {error&&<div className="discovery-lead-message is-error" role="alert"><CircleAlert size={15}/>{error}</div>}
    {notice&&<div className="discovery-lead-message" role="status"><CheckCircle2 size={15}/>{notice}</div>}
    {!canEdit&&<div className="discovery-readonly"><ShieldCheck size={14}/>Read-only. An owner, admin, manager or staff member must manage commitments.</div>}
    {canEdit&&<form className="ax-commitment-create" onSubmit={event=>void create(event)}>
      <label>Type<select value={kind} onChange={e=>setKind(e.target.value)}>{TYPES.map(item=><option key={item} value={item}>{label(item)}</option>)}</select></label>
      <label className="ax-commitment-title">Title<input required maxLength={200} value={title} onChange={e=>setTitle(e.target.value)} placeholder="What needs to be done or honoured?"/></label>
      <label className="ax-commitment-summary-field">Summary<textarea maxLength={1000} rows={2} value={summary} onChange={e=>setSummary(e.target.value)} placeholder="Context, expected outcome or obligation details"/></label>
      <label>Priority<select value={priority} onChange={e=>setPriority(e.target.value)}>{PRIORITIES.map(item=><option key={item} value={item}>{label(item)}</option>)}</select></label>
      <label>Next internal action<select value={action} onChange={e=>setAction(e.target.value)}>{ACTIONS.map(item=><option key={item} value={item}>{label(item)}</option>)}</select></label>
      <label>Due date<input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)} required={kind==="milestone"}/></label>
      <label>Responsible member<select value={assignee} onChange={e=>setAssignee(e.target.value)}>
        <option value="">Unassigned</option>{members.filter(m=>companyRole!=="staff"||m.user_id===currentUserId).map(m=><option key={m.user_id} value={m.user_id}>{label(m.role)} · {m.user_id.slice(0,8)}</option>)}
      </select></label>
      <label>Linked deal<select value={dealKey} onChange={e=>{setDealKey(e.target.value);setRelationshipId("");}}><option value="">No deal link</option>{properties.map(item=><option key={item.id} value={item.id}>{item.title} · {item.module}</option>)}</select></label>
      <label>Linked party<select value={partyKey} onChange={e=>{setPartyKey(e.target.value);setRelationshipId("");}}><option value="">No party link</option>{contacts.map(item=><option key={item.id} value={item.id}>{item.name} · {item.role||"Contact"}</option>)}</select></label>
      {dealKey&&partyKey&&<label>Matching E16 relationship<select value={relationshipId} onChange={e=>setRelationshipId(e.target.value)}>
        <option value="">No relationship selected</option>{createRelationships.map(link=><option key={link.id} value={link.id}>{label(link.role_code)} · {label(link.responsibility_code)} · {label(link.verification_state)}</option>)}
      </select>{!createRelationships.length&&<small>No active relationship for this deal and party. Add one in the E16/E17 panel first.</small>}</label>}
      <button type="submit" className="primary-button" disabled={busy==="create"||!title.trim()}>{busy==="create"?<LoaderCircle size={14}/>:<ClipboardList size={14}/>}Create action</button>
    </form>}
    {canEdit&&<div className="ax-commitment-reconciliation">
      <div><strong><FileCheck2 size={15}/> Legacy task reconciliation</strong><p>Review cloud-synced tasks and explicitly link selected tasks into E18. The source task is retained; no legacy task is copied over or deleted automatically.</p></div>
      <label>Unlinked legacy task<select value={legacyTaskKey} onChange={e=>setLegacyTaskKey(e.target.value)}>
        <option value="">Choose a task to link</option>{unlinkedLegacyTasks.map(item=><option key={item.record_key} value={item.record_key}>{item.payload.title||"Untitled task"} · {item.payload.date||"No date"} · {item.payload.done?"Completed":"Open"}</option>)}
      </select></label>
      <button type="button" className="secondary-button" onClick={()=>void importLegacyTask()} disabled={!legacyTaskKey||busy==="import"}>{busy==="import"?<LoaderCircle size={14}/>:<Link2 size={14}/>}Link / import selected task</button>
      <small>{unlinkedLegacyTasks.length} cloud-synced task(s) available · {rows.filter(row=>row.source_task_record_key).length} already linked{unsyncedLocalTaskCount? " · "+unsyncedLocalTaskCount+" device task(s) not yet present in the company cloud register; sync before linking":""}</small>
    </div>}
    <div className="ax-commitment-summary">
      <article><strong>{rows.filter(r=>!["completed","cancelled"].includes(r.status)).length}</strong><span>Open</span></article>
      <article><strong>{rows.filter(r=>r.due_state==="overdue").length}</strong><span>Overdue</span></article>
      <article><strong>{rows.filter(r=>r.due_state==="due_today").length}</strong><span>Due today</span></article>
      <article><strong>{rows.filter(r=>r.status==="completed").length}</strong><span>Completed</span></article>
    </div>
    {loading&&!rows.length?<div className="discovery-loading"><LoaderCircle size={15}/>Loading commitments…</div>:
      rows.length?<div className="ax-commitment-list">{rows.map(row=>{
        const draft=detailDrafts[row.id]||{title:row.title,summary:row.summary||"",nextAction:row.next_action_code,relationshipId:row.relationship_id||""};
        const rowRelationships=activeRelationships.filter(link=>link.deal_record_key===row.deal_record_key&&link.party_record_key===row.party_record_key);
        return <article key={row.id} className="ax-commitment-card">
          <div className="ax-commitment-card-head"><div><strong>{row.title}</strong><small>{label(row.commitment_type)}{row.deal_label?" · "+row.deal_label:""}{row.party_label?" · "+row.party_label:""}</small></div>
            <span className={"discovery-lead-stage stage-"+row.due_state}>{label(row.due_state)}</span></div>
          {row.summary&&<p>{row.summary}</p>}
          {row.relationship_id&&<small className="ax-commitment-linked-relationship">E16 link: {label(activeRelationships.find(link=>link.id===row.relationship_id)?.role_code||"recorded relationship")}</small>}
          {row.source_task_record_key&&<small className="ax-commitment-source-task">Linked legacy task: {row.source_task_record_key}</small>}
          <div className="ax-commitment-card-meta"><span>{label(row.status)}</span><span>{label(row.priority)}</span><span>Due {row.due_at?new Date(row.due_at).toLocaleString():"Not set"}</span>{row.due_state==="overdue"&&<span>{row.days_overdue} days overdue</span>}</div>
          {canEdit&&<div className="ax-commitment-card-controls">
            <div className="ax-commitment-details-tools">
              {!editingDetails[row.id]?<button type="button" className="secondary-button" onClick={()=>beginEditDetails(row)}><Pencil size={13}/>Edit title / summary / links</button>:
                <div className="ax-commitment-detail-editor">
                  <label>Title<input maxLength={200} value={draft.title} onChange={e=>setDetailDrafts(old=>({...old,[row.id]:{...draft,title:e.target.value}}))}/></label>
                  <label>Summary<textarea rows={2} maxLength={1000} value={draft.summary} onChange={e=>setDetailDrafts(old=>({...old,[row.id]:{...draft,summary:e.target.value}}))}/></label>
                  <label>Next internal action<select value={draft.nextAction} onChange={e=>setDetailDrafts(old=>({...old,[row.id]:{...draft,nextAction:e.target.value}}))}>{ACTIONS.map(value=><option key={value} value={value}>{label(value)}</option>)}</select></label>
                  {row.deal_record_key&&row.party_record_key&&<label>Matching E16 relationship<select value={draft.relationshipId} onChange={e=>setDetailDrafts(old=>({...old,[row.id]:{...draft,relationshipId:e.target.value}}))}>
                    <option value="">No relationship selected</option>{rowRelationships.map(link=><option key={link.id} value={link.id}>{label(link.role_code)} · {label(link.responsibility_code)} · {label(link.verification_state)}</option>)}
                  </select></label>}
                  <div><button type="button" className="primary-button" onClick={()=>saveDetails(row)} disabled={busy==="details-"+row.id||!draft.title.trim()}>{busy==="details-"+row.id?<LoaderCircle size={13}/>:<CheckCircle2 size={13}/>}Save details</button>
                    <button type="button" className="secondary-button" onClick={()=>setEditingDetails(old=>({...old,[row.id]:false}))}>Cancel</button></div>
                </div>}
            </div>
            <label>Status<select value={statusDrafts[row.id]||row.status} disabled={row.status==="cancelled"||busy==="status-"+row.id}
              onChange={e=>setStatusDrafts(old=>({...old,[row.id]:e.target.value}))}>
              <option value={row.status}>{label(row.status)}</option>
              {(row.status==="completed"?["in_progress"]:STATES.filter(s=>s!==row.status&&row.status!=="cancelled")).map(s=><option key={s} value={s}>{label(s)}</option>)}
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
        </article>;
      })}</div>:<p className="ax-relationship-unlinked">No structured commitments have been added in this company workspace yet.</p>}
    <p className="ax-relationship-footnote">Commitments are retained as auditable records. Existing device-local tasks are not changed by linking; recurring reminders and message delivery are not enabled by this stage.</p>
  </section>;
}
