import {enforceFeatureRequest} from "./feature-flags";
import {checkActionTab} from "./tab-guard";
import {currentClerkUser,currentClerkSession} from "./clerk-reads";
import {clerkDisplayName} from "../runtime/clerk-names.mjs";
import {auth} from "@clerk/nextjs/server";
import {NextResponse} from "next/server";
import {z,ZodError,type ZodType} from "zod";
import {AppError,ensure} from "./errors";
import {endpointBudget} from "./read-policy";
import {clerkConfigured} from "./clerk-env";
import {rateLimit} from "./store";
import {verifiedGoogleEmail} from "./google-identity";
import {siteMaintenance} from "./site-maintenance";
import type {Identity} from "./types";
export const configured=clerkConfigured;
const receiveGenerationSchema=z.object({action:z.literal("code"),amount:z.string().max(32),note:z.string().max(160).optional()}).strict();
async function receiveGeneration(request:Request){
 if(request.method!=="POST"||new URL(request.url).pathname!=="/api/transfers")return false;
 // Inspect a bounded clone, leaving the authenticated route's body and schema intact.
 // Malformed/unknown payloads keep the ordinary endpoint budget.
 const reader=request.clone().body?.getReader();if(!reader)return false;
 let text="",bytes=0;const decoder=new TextDecoder();
 try{
  while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>2048)return false;text+=decoder.decode(part.value,{stream:true});}
  text+=decoder.decode();return receiveGenerationSchema.safeParse(JSON.parse(text)).success;
 }catch{return false;}
 // A clone is a teed stream. Awaiting cancellation can deadlock until the handler
 // reads the original branch, so cancel this inspection branch without waiting.
 finally{void reader.cancel().catch(()=>{});}
}
export async function endpoint(request:Request,handler:(who:Identity)=>Promise<unknown>) {
 try {
  ensure(configured(),"Clerk setup required.",503);
  const {userId,sessionId}=await auth(); ensure(userId,"Sign in with Google.",401);
  if(request.method!=="GET") {
   ensure(process.env.APP_ORIGIN&&request.headers.get("origin")===new URL(process.env.APP_ORIGIN).origin,"Request origin not allowed.",403);
   ensure(request.headers.get("content-type")?.split(";")[0]==="application/json","Use application/json.",415);
  }
  ensure(sessionId,"Sign in with Google.",401);
  await currentClerkSession(sessionId,userId);
  const user=await currentClerkUser(userId);
  const email=verifiedGoogleEmail(user);
  ensure(user&&email,"A verified Google-only account is required.",403);
  const who:Identity={id:userId,name:clerkDisplayName(user),email,admin:user.privateMetadata?.admin===true};
  const budget=endpointBudget(request.method,new URL(request.url).pathname,userId);
  if(!await receiveGeneration(request))await rateLimit(budget.key,budget.limit);
  if(!who.admin&&new URL(request.url).pathname!=="/api/maintenance")ensure(!(await siteMaintenance(false)).blocked,"Under maintenance",503);
  let featureInput:Record<string,unknown>={};
  if(request.method!=="GET"){
   // Bounded inspection of the clone leaves the original body for the route schema.
   const reader=request.clone().body?.getReader();let bytes=0,text="";const decoder=new TextDecoder();
   try{if(reader){while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;ensure(bytes<=32768,"Request too large.",413);text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();featureInput=JSON.parse(text);ensure(featureInput!==null&&typeof featureInput==="object"&&!Array.isArray(featureInput),"Invalid request.");}}
   finally{if(reader)void reader.cancel().catch(()=>{});}
  }
  await enforceFeatureRequest(new URL(request.url).pathname,request.method,featureInput,userId);
  await checkActionTab(request,userId);
  return NextResponse.json(await handler(who),{headers:{"Cache-Control":"no-store"}});
 }catch(e) {
  const status=e instanceof AppError?e.status:e instanceof ZodError||e instanceof SyntaxError?400:503;
  return NextResponse.json({error:e instanceof AppError?e.message:status===400?"Invalid request.":"Service unavailable. Try again."},{status,headers:{"Cache-Control":"no-store",...(status===429?{"Retry-After":"60"}:{})}});
 }
}
export async function parse<T>(request:Request,schema:ZodType<T>,maxBytes=2048) {
 const reader=request.body?.getReader();ensure(reader,"Missing body.");
 let text="",bytes=0;const decoder=new TextDecoder();
 try {while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;ensure(bytes<=maxBytes,"Request too large.",413);text+=decoder.decode(chunk.value,{stream:true});}text+=decoder.decode();}
 finally{await reader.cancel();}
 return schema.parse(JSON.parse(text));
}
