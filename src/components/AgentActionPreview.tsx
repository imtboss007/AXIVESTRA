import {useState} from "react";
import type {AgentActionPreviewBlock} from "../lib/agent-ui-contract";
type Props={action:AgentActionPreviewBlock;onApprove?:(id:string)=>void;onReject?:(id:string)=>void};
export default function AgentActionPreview({action,onApprove,onReject}:Props){
 const [confirmation,setConfirmation]=useState(""),irreversible=action.consequence==="irreversible";
 return <section className="ax-agent-action-preview" aria-labelledby={"agent-action-"+action.id}>
 <div className="ax-agent-action-preview__header"><div><span className="ax-agent-kicker">ACTION PREVIEW · HUMAN REVIEW REQUIRED</span><h3 id={"agent-action-"+action.id}>{action.actionName}</h3></div><span className={"ax-agent-consequence ax-agent-consequence--"+action.consequence}>{irreversible?"Irreversible":action.consequence==="undoable"?"Undo available":"Reversible"}</span></div>
 {action.untrustedSource&&<div className="ax-agent-injection-flag" role="alert"><strong>External instruction — inspect before approving</strong><span>Proposed action influenced by: {action.sourceLabel}</span>{action.sourceExcerpt&&<blockquote>{action.sourceExcerpt}</blockquote>}</div>}
 <dl className="ax-agent-action-facts"><div><dt>Source</dt><dd>{action.sourceLabel}</dd></div>{action.details.map((d,i)=><div key={d.label+"-"+i}><dt>{d.label}</dt><dd>{d.value}</dd></div>)}</dl>
 {action.consequence==="undoable"&&action.undoDescription&&<p className="ax-agent-undo-note">Recovery: {action.undoDescription}</p>}
 {irreversible&&<label className="ax-agent-confirm-field"><span>Type CONFIRM to enable this irreversible action.</span><input aria-label="Type CONFIRM to approve the irreversible action" value={confirmation} onChange={e=>setConfirmation(e.target.value)} autoComplete="off" spellCheck={false}/></label>}
 <div className="ax-agent-action-preview__footer"><button type="button" className="secondary-button" disabled={!onReject} onClick={()=>onReject?.(action.actionId)}>Reject proposed action</button><button type="button" className="primary-button" disabled={!onApprove||(irreversible&&confirmation!=="CONFIRM")} onClick={()=>onApprove?.(action.actionId)}>{irreversible?"Confirm irreversible action":"Approve "+action.actionName}</button></div>
 <p className="ax-agent-policy-note">Approval is not execution. The server must re-check identity, company scope, permissions and exact action parameters before carrying it out.</p></section>;
}
