import {currentProfiles,currentTransferHistory,currentTransferResult} from "@/lib/server-names";
import {profileName} from "@/runtime/clerk-names.mjs";
import {limitTransferGuess} from "@/lib/transfer-rate-limit";
import {db} from "@/lib/db";
import type {Room} from "@/lib/types";
import {z} from "zod";
import {endpoint,parse} from "@/lib/api";
import {rateLimit} from "@/lib/store";
import {createReceiveCode,resolveReceiveCode,sendTransfer} from "@/lib/transfers";
const schema=z.discriminatedUnion("action",[
 z.object({action:z.literal("code"),amount:z.string().max(32),note:z.string().max(160).optional()}).strict(),
 z.object({action:z.literal("resolve"),code:z.string().max(100)}).strict(),
 z.object({action:z.literal("send"),code:z.string().max(100),recipient:z.string().min(1).max(256),requestId:z.string().uuid()}).strict(),
]);
export const GET=(request:Request)=>endpoint(request,async who=>({transfers:await currentTransferHistory(who,new URL(request.url).searchParams.get("all")==="1")}));
export const POST=(request:Request)=>endpoint(request,async who=>{
 const input=await parse(request,schema);await rateLimit("transfers:"+who.id,input.action==="resolve"?10:20);
 if(input.action==="code")return createReceiveCode(who,input);
 if(input.action==="resolve"){
  await limitTransferGuess(request,who.id);
  const preview=await resolveReceiveCode(who,input.code);
  const r=await(await db()).collection<Room>("rooms").findOne({_id:"main"});
  const recipient=r?.members.find(m=>m.publicId===preview.publicId);
  const profiles=await currentProfiles(recipient?[recipient.id]:[]);
  return {...preview,name:recipient?profileName(profiles,recipient.id):"Player",avatar:recipient?profiles.get(recipient.id)?.avatar??null:null};
 }
 await limitTransferGuess(request,who.id);
 const sent=await sendTransfer(who,input);
 return {transfer:sent?await currentTransferResult(sent.id,who):sent};
});
