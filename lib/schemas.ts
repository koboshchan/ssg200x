import {z} from "zod";
const base={requestId:z.string().uuid(),handNumber:z.number().int().min(0),turnDeadline:z.number().int().nullable()};
export const actionSchema=z.discriminatedUnion("type",[
 z.object({...base,type:z.literal("join"),seat:z.number().int().min(0).max(5),buyIn:z.number().int().min(10_000).max(100_000)}).strict(),
 z.object({...base,type:z.literal("leave")}).strict(),
 z.object({...base,type:z.literal("resume")}).strict(),
 z.object({...base,type:z.literal("fold")}).strict(),
 z.object({...base,type:z.literal("check")}).strict(),
 z.object({...base,type:z.literal("call")}).strict(),
 z.object({...base,type:z.literal("raise"),to:z.number().int().min(1).max(10_000_000)}).strict(),
]);
export const approvalSchema=z.object({publicId:z.string().regex(/^[a-f0-9]{16}$/),approved:z.boolean()}).strict();
