import {z} from "zod";
import {endpoint,parse} from "@/lib/api";
import {rateLimit} from "@/lib/store";
import {createReceiveCode,resolveReceiveCode,sendTransfer,transferHistory} from "@/lib/transfers";
const schema=z.discriminatedUnion("action",[
 z.object({action:z.literal("code")}).strict(),
 z.object({action:z.literal("resolve"),code:z.string().max(100)}).strict(),
 z.object({action:z.literal("send"),code:z.string().max(100),amount:z.string().max(32),note:z.string().max(160).optional(),recipient:z.string().min(1).max(256),requestId:z.string().uuid()}).strict(),
]);
export const GET=(request:Request)=>endpoint(request,async who=>({transfers:await transferHistory(who,new URL(request.url).searchParams.get("all")==="1")}));
export const POST=(request:Request)=>endpoint(request,async who=>{
 const input=await parse(request,schema);await rateLimit("transfers:"+who.id,input.action==="resolve"?10:20);
 if(input.action==="code")return createReceiveCode(who);
 if(input.action==="resolve")return resolveReceiveCode(who,input.code);
 return {transfer:await sendTransfer(who,input)};
});
