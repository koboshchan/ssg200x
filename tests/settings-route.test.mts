import test,{mock} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {AppError} from "../lib/errors";
import {freshRoom,register} from "../lib/poker";
import type {Room} from "../lib/types";
import {saveSettings} from "../lib/settings-request";
const who={id:"settings-owner",name:"Owner",email:"owner@test",admin:false};
let room=freshRoom(),serverNow=1_800_000_000_000;
const wallNow=Date.now;
mock.module("../lib/api.ts",{namedExports:{
 endpoint:async(_r:Request,handler:Function)=>{
  // Simulate a server process with a different wall clock from the client.
  Date.now=()=>serverNow;
  try{return Response.json(await handler(who));}
  catch(e){return Response.json({error:(e as Error).message},{status:e instanceof AppError?e.status:400});}
  finally{Date.now=wallNow;}
 },
 parse:async(r:Request,schema:any)=>schema.parse(await r.json())
}});
mock.module("../lib/public.ts",{namedExports:{freshPublicRoom:async(r:Room)=>structuredClone(r)}});
mock.module("../lib/store.ts",{namedExports:{
 rateLimit:async()=>{},visit:async()=>room,
 mutate:async(fn:Function)=>{const next=structuredClone(room);await fn(next);room=next;return {room};}
}});
const {GET,POST}=await import("../app/api/settings/route");
function setup(){room=freshRoom();register(room,who);}
const req=(body:object)=>new Request("https://settings.invalid/api/settings",{method:"POST",body:JSON.stringify(body)});
test("baseline shipped Date.now request reproduces exact toast with device clock skew",async()=>{
 for(const skew of [-3_600_000,3_600_000]){
  setup();const response=await POST(req({triggerInputMode:"pnl",requestId:randomUUID(),requestAt:serverNow+skew}));
  assert.equal(response.status,409);
  assert.equal((await response.json()).error,"Request expired. Try again.");
  assert.notEqual(room.members[0].settings?.triggerInputMode,"pnl");
 }
});
test("fresh server clock saves actual route both ways despite skew and long-open tabs",async()=>{
 setup();const bodies:Record<string,any>[]=[],methods:string[]=[];
 const fetcher:typeof fetch=async(_url,init)=>{
  methods.push(init?.method??"GET");
  if(init?.method!=="POST"){
   assert.equal(init?.cache,"no-store");
   return GET(new Request("https://settings.invalid/api/settings"));
  }
  const body=JSON.parse(String(init.body));bodies.push(body);
  assert.equal((init.headers as Record<string,string>)["x-tab-id"],"fixture-tab");
  assert.equal(body.requestAt,serverNow);
  return POST(req(body));
 };
 for(const [skew,patch] of [
  [-3_600_000,{triggerInputMode:"pnl"}],
  [3_600_000,{triggerInputMode:"price"}],
  [-86_400_000,{skipCloseConfirmation:true}],
  [86_400_000,{hideFromLeaderboard:true}]
 ] as const){
  serverNow+=86_400_000; // next click a day later, no stale cached timestamp
  Date.now=()=>serverNow+skew;
  try{await saveSettings(patch,{"x-tab-id":"fixture-tab"},fetcher);}finally{Date.now=wallNow;}
 }
 assert.deepEqual(methods,["GET","POST","GET","POST","GET","POST","GET","POST"]);
 assert.equal(new Set(bodies.map(b=>b.requestId)).size,4);
 assert.equal(room.members[0].settings?.triggerInputMode,"price");
 assert.equal(room.members[0].settings?.skipCloseConfirmation,true);
 assert.equal(room.members[0].settings?.hideFromLeaderboard,true);
});
test("POST still rejects genuinely stale and future requests",async()=>{
 setup();
 for(const delta of [-120001,10001]){
  assert.equal((await POST(req({triggerInputMode:"pnl",requestId:randomUUID(),requestAt:serverNow+delta}))).status,409);
 }
 assert.equal(room.receipts.length,0);
});
test("failed clock read never sends mutation; failed POST is surfaced for UI rollback",async()=>{
 for(const response of [
  Response.json({error:"Sign in again."},{status:401}),
  Response.json({serverNow:"invalid"}),
  Response.json({serverNow:1.5})
 ]){
  let posts=0;
  await assert.rejects(saveSettings({triggerInputMode:"pnl"},{},async(_url,init)=>{
   if(init?.method==="POST")posts++;return response;
  }));
  assert.equal(posts,0);
 }
 let calls=0;
 await assert.rejects(saveSettings({triggerInputMode:"pnl"},{},async()=>{
  return ++calls===1?Response.json({serverNow}):Response.json({error:"The room is busy."},{status:409});
 }),/The room is busy/);
});
