import {z} from "zod";
const TextBlock=z.object({type:z.literal("text"),id:z.string().min(1).max(80),title:z.string().max(140).optional(),body:z.string().min(1).max(4000)}).strict();
const MetricBlock=z.object({type:z.literal("metric"),id:z.string().min(1).max(80),label:z.string().min(1).max(120),value:z.union([z.string().max(120),z.number().finite()]),context:z.string().max(240).optional()}).strict();
const RecordBlock=z.object({type:z.literal("record_link"),id:z.string().min(1).max(80),recordId:z.string().min(1).max(160),recordType:z.string().min(1).max(80),label:z.string().min(1).max(160)}).strict();
const Detail=z.object({label:z.string().min(1).max(100),value:z.string().max(1000)}).strict();
export const AgentActionPreviewSchema=z.object({type:z.literal("action_preview"),id:z.string().min(1).max(80),actionId:z.string().min(1).max(160),actionName:z.string().min(1).max(120),sourceLabel:z.string().min(1).max(240),sourceExcerpt:z.string().max(1000).optional(),untrustedSource:z.boolean().default(false),consequence:z.enum(["reversible","undoable","irreversible"]),undoDescription:z.string().max(300).optional(),details:z.array(Detail).min(1).max(30)}).strict().superRefine((v,c)=>{if(v.consequence==="undoable"&&!v.undoDescription)c.addIssue({code:"custom",path:["undoDescription"],message:"Undoable actions must explain the recovery path."});});
export const AgentUiBlockSchema=z.discriminatedUnion("type",[TextBlock,MetricBlock,RecordBlock,AgentActionPreviewSchema]);
export const AgentUiResponseSchema=z.object({version:z.literal(1),blocks:z.array(AgentUiBlockSchema).max(20)}).strict();
export type AgentActionPreviewBlock=z.infer<typeof AgentActionPreviewSchema>;export type AgentUiBlock=z.infer<typeof AgentUiBlockSchema>;
export function parseAgentUiResponse(input:unknown){return AgentUiResponseSchema.safeParse(input);}
