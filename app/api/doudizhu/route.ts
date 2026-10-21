import {z} from "zod";
import {endpoint,parse} from "@/lib/api";
import {doudizhuMove,doudizhuRead} from "@/lib/doudizhu-store";
const stamp={requestId:z.string().uuid(),requestAt:z.number().int(),code:z.string().max(100).optional(),version:z.number().int().nonnegative().optional()};
const schema=z.discriminatedUnion("type",[
 z.object({...stamp,type:z.literal("create"),beansPerDollar:z.number().int().min(1).max(1000000000).optional(),maxLoss:z.number().int().min(100).max(100000000).optional()}).strict(),
 ...(["join","ready","pass","leave"] as const).map(type=>z.object({...stamp,type:z.literal(type)}).strict()),
 z.object({...stamp,type:z.literal("bid"),bid:z.number().int().min(0).max(3)}).strict(),
 z.object({...stamp,type:z.literal("play"),cards:z.array(z.string().max(2)).min(1).max(20)}).strict()
]);
export const GET=(request:Request)=>endpoint(request,who=>doudizhuRead(who,new URL(request.url).searchParams.get("code")||undefined));
export const POST=(request:Request)=>endpoint(request,async who=>doudizhuMove(who,await parse(request,schema)));
