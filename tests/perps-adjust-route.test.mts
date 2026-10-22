import test,{mock} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {AppError} from "../lib/errors";
import {freshRoom,register,assertRoom} from "../lib/poker";
import {openPosition} from "../lib/finance";
import {publicRoom} from "../lib/public";
import type {Room} from "../lib/types";
let room=freshRoom(),who={id:"owner",name:"Owner",email:"owner@test",admin:false};
let race:(()=>void)|undefined;
mock.module("../lib/api.ts",{namedExports:{
 endpoint:async(_r:Request,handler:Function)=>{try{return Response.json(await handler(who));}catch(e){return Response.json({error:(e as Error).message},{status:e instanceof AppError?e.status:400});}},
 parse:async(r:Request,schema:any)=>schema.parse(await r.json())
}});
mock.module("../lib/public.ts",{namedExports:{freshPublicRoom:async(r:Room,w:any)=>publicRoom(r,w)}});
mock.module("../lib/store.ts",{namedExports:{
 rateLimit:async()=>{},visit:async()=>{register(room,who);return room;},
 mutate:async(fn:Function)=>{
  for(let i=0;i<5;i++){
   const version=room.version,next=structuredClone(room);await fn(next);
   if(race){const change=race;race=undefined;change();room.version++;}
   if(version!==room.version)continue;
   next.version++;room=next;return {room:next};
  }
  throw Error("CAS busy");
 }
}});
const {POST}=await import("../app/api/finance/route");

const req=(body:object)=>new Request("https://test.invalid/api/finance",{method:"POST",body:JSON.stringify(body)});
function setup(){
 room=freshRoom();race=undefined;who={id:"owner",name:"Owner",email:"owner@test",admin:false};register(room,who);
 room.quotes={BTC:{micro:100_000_000_000,at:Date.now()},ETH:{micro:3_000_000_000,at:Date.now()}};
 const ids=[randomUUID(),randomUUID()];
 openPosition(room,who,"BTC","long",10000,5,ids[0]);openPosition(room,who,"ETH","short",10000,5,ids[1]);
 room.quotes.BTC!.micro=110_000_000_000;room.quotes.ETH!.micro=3_100_000_000;return ids;
}
const order=(ids:string[],mode:string)=>({type:"close-all",positionIds:ids,mode,requestId:randomUUID(),requestAt:Date.now()});
const adjustment=(id:string,type="increase",expectedRevision=0)=>({type,positionId:id,expectedRevision,...(type==="increase"?{margin:5000}:{percentBps:5000}),requestId:randomUUID(),requestAt:Date.now()});
test("actual route add/partial replay exactly once and bind request payload and owner",async()=>{
 for(const type of ["increase","partial-close"]){const [id]=setup(),input=adjustment(id,type);const original=room.members[0].positions![0];const before={...original};
 const first=await POST(req(input));assert.equal(first.status,200,await first.text());const wallet=room.members[0].wallet,after=structuredClone(room);
 assert.equal((await POST(req(input))).status,200);assert.equal(room.members[0].wallet,wallet);assert.deepEqual(room.members[0].positions,after.members[0].positions);assert.deepEqual(room.members[0].closedPositions,after.members[0].closedPositions);
 assert.equal((await POST(req({...input,expectedRevision:1}))).status,409);
 who={...who,id:"other"};register(room,who);assert.equal((await POST(req(input))).status,409);assert.equal((await POST(req({...input,requestId:randomUUID()}))).status,404);
 assert.equal(after.members[0].positions![0].revision,1);assert.ok(type==="increase"?after.members[0].positions![0].margin>before.margin:after.members[0].positions![0].margin<before.margin);assertRoom(room);
 }
});
test("CAS retry reprices add and partial against the winning fresh quote",async()=>{
 for(const type of ["increase","partial-close"]){const [id]=setup(),input=adjustment(id,type);race=()=>{room.quotes!.BTC!.micro=115_000_000_000;};const result=await POST(req(input));assert.equal(result.status,200,await result.text());const p=room.members[0].positions![0];
 if(type==="increase")assert.ok(p.entry>104_000_000_000&&p.entry<106_000_000_000);else assert.equal(room.members[0].closedPositions![0].exit,115_000_000_000);
 assert.equal(room.financeReceipts!.length,1);assert.equal(room.auditPending!.filter(a=>a.what==="finance-"+(type==="increase"?"increase":"partial-close")).length,1);assertRoom(room);
 }
});
test("CAS retry respects newly spent wallet, stale quote and changed exposure",async()=>{
 for(const failure of ["wallet","stale","revision"]){const [id]=setup(),input=adjustment(id);race=()=>{if(failure==="wallet"){room.members[0].wallet=0;}else if(failure==="stale")room.quotes!.BTC!.at=0;else room.members[0].positions![0].revision=1;};
 const beforeMargin=room.members[0].positions![0].margin;const response=await POST(req(input));assert.ok(response.status>=400);assert.equal(room.members[0].positions![0].margin,beforeMargin);assert.equal(room.financeReceipts?.length??0,0);assert.equal(room.auditPending?.length??0,0);
 }
});
test("concurrent identical requests credit once; new keys with old exposure revision reject",async()=>{
 for(const type of ["increase","partial-close"]){const [id]=setup(),input=adjustment(id,type);const responses=await Promise.all([POST(req(input)),POST(req(input))]);assert.deepEqual(responses.map(r=>r.status),[200,200]);assert.equal(room.members[0].positions![0].revision,1);assert.equal(room.financeReceipts!.length,1);
 const response=await POST(req({...input,requestId:randomUUID()}));assert.equal(response.status,409);assert.equal(room.members[0].positions![0].revision,1);assertRoom(room);
 }
});
