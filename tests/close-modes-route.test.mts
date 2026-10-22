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
const {GET,POST:SETTINGS}=await import("../app/api/settings/route");
const req=(body:object)=>new Request("https://test.invalid/api/finance",{method:"POST",body:JSON.stringify(body)});
function setup(){
 room=freshRoom();race=undefined;who={id:"owner",name:"Owner",email:"owner@test",admin:false};register(room,who);
 room.quotes={BTC:{micro:100_000_000_000,at:Date.now()},ETH:{micro:3_000_000_000,at:Date.now()}};
 const ids=[randomUUID(),randomUUID()];
 openPosition(room,who,"BTC","long",10000,5,ids[0]);openPosition(room,who,"ETH","short",10000,5,ids[1]);
 room.quotes.BTC!.micro=110_000_000_000;room.quotes.ETH!.micro=3_100_000_000;return ids;
}
const order=(ids:string[],mode:string)=>({type:"close-all",positionIds:ids,mode,requestId:randomUUID(),requestAt:Date.now()});
test("actual finance route filtered partial receipts replay once and bind mode",async()=>{
 const ids=setup(),input=order(ids,"profiting");
 room.quotes!.ETH!.at=0;
 assert.equal((await POST(req(input))).status,200);
 const receipt=room.financeReceipts![0].closeAll!;
 assert.deepEqual(receipt.closed,[ids[0]]);assert.equal(receipt.failed[0].id,ids[1]);
 const wallet=room.members[0].wallet;
 room.quotes!.ETH!.at=Date.now();room.quotes!.ETH!.micro=2_000_000_000;
 assert.equal((await POST(req(input))).status,200);assert.equal(room.members[0].wallet,wallet);
 assert.equal(room.members[0].positions!.length,1);
 assert.equal((await POST(req({...input,mode:"all"}))).status,409);assertRoom(room);
});
test("CAS retry reclassifies current quote and excludes a newly opened position from snapshot",async()=>{
 const ids=setup(),input=order(ids,"profiting"),later=randomUUID();
 race=()=>{room.quotes!.BTC!.micro=90_000_000_000;openPosition(room,who,"BTC","long",1000,5,later);};
 assert.equal((await POST(req(input))).status,200);
 assert.deepEqual(room.financeReceipts![0].closeAll!.closed,[]);
 assert.deepEqual(room.financeReceipts![0].closeAll!.skipped,ids);
 assert.equal(room.members[0].positions!.length,3);assertRoom(room);
});
test("actual settings GET/POST default, strict boolean, persistence, receipt and isolation",async()=>{
 setup();
 assert.equal((await (await GET(new Request("https://test.invalid/api/settings"))).json()).skipCloseConfirmation,false);
 const input={skipCloseConfirmation:true,requestId:randomUUID(),requestAt:Date.now()};
 assert.equal((await SETTINGS(req(input))).status,200);
 room=JSON.parse(JSON.stringify(room));
 assert.equal((await (await GET(new Request("https://test.invalid/api/settings"))).json()).skipCloseConfirmation,true);
 assert.equal((await SETTINGS(req({...input,requestId:randomUUID(),skipCloseConfirmation:"true"}))).status,400);
 const own=who;who={...who,id:"other"};register(room,who);
 assert.equal((await (await GET(new Request("https://test.invalid/api/settings"))).json()).skipCloseConfirmation,false);
 assert.equal((await SETTINGS(req(input))).status,409);
 who=own;assert.equal((await SETTINGS(req({skipCloseConfirmation:false}))).status,200);
 assert.equal((await (await GET(new Request("https://test.invalid/api/settings"))).json()).skipCloseConfirmation,false);
 assertRoom(room);
});
