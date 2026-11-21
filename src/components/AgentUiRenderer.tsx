import AgentActionPreview from "./AgentActionPreview";
import type {AgentUiBlock} from "../lib/agent-ui-contract";
import {parseAgentUiResponse} from "../lib/agent-ui-contract";
type Props={value:unknown;onOpenRecord?:(id:string,type:string)=>void;onApproveAction?:(id:string)=>void;onRejectAction?:(id:string)=>void};
function Block({block,onOpenRecord,onApproveAction,onRejectAction}:{block:AgentUiBlock;onOpenRecord?:Props["onOpenRecord"];onApproveAction?:Props["onApproveAction"];onRejectAction?:Props["onRejectAction"]}){
 if(block.type==="text")return <article className="ax-agent-content-card" key={block.id}>{block.title&&<h3>{block.title}</h3>}<p>{block.body}</p></article>;
 if(block.type==="metric")return <article className="ax-agent-metric-card" key={block.id}><span>{block.label}</span><strong>{String(block.value)}</strong>{block.context&&<small>{block.context}</small>}</article>;
 if(block.type==="record_link")return <article className="ax-agent-record-card" key={block.id}><span>{block.recordType}</span><strong>{block.label}</strong><button type="button" className="secondary-button" disabled={!onOpenRecord} onClick={()=>onOpenRecord?.(block.recordId,block.recordType)}>Open source record</button></article>;
 return <AgentActionPreview key={block.id} action={block} onApprove={onApproveAction} onReject={onRejectAction}/>;
}
export default function AgentUiRenderer({value,onOpenRecord,onApproveAction,onRejectAction}:Props){
 const parsed=parseAgentUiResponse(value);
 if(!parsed.success)return <section className="ax-agent-invalid" role="status"><strong>Agent content not displayed</strong><p>The response did not match AXIVESTRA's approved UI schema. No embedded code or unrecognised controls were executed.</p></section>;
 return <div className="ax-agent-ui-renderer">{parsed.data.blocks.map(block=><Block key={block.id} block={block} onOpenRecord={onOpenRecord} onApproveAction={onApproveAction} onRejectAction={onRejectAction}/>)}</div>;
}
