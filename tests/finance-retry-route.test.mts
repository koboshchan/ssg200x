import test,{mock} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {AppError} from "../lib/errors";
import {freshRoom,register} from "../lib/poker";
import type {Room} from "../lib/types";
import {PendingFinanceController} from "../lib/pending-finance";
import {mergeRoom} from "../lib/room-sync";
let room=freshRoom(),who={id:"owner",name:"Owner",email:"owner@test",admin:false};
mock.module("../lib/api.ts",{namedExports:{
 endpoint:async(_r:Request,handler:Function)=>{try{return Response.json(await handler(who));}catch(e){return Response.json({error:(e as Error).message},{status:e instanceof AppError?e.status:400});}},
 parse:async(r:Request,schema:any)=>schema.parse(await r.json())
}});
mock.module("../lib/public.ts",{namedExports:{freshPublicRoom:async(r:Room)=>structuredClone(r)}});
let beforeCommit:(()=>Promise<void>)|null=null;
mock.module("../lib/store.ts",{namedExports:{rateLimit:async()=>{},mutate:async(fn:Function)=>{
 for(let i=0;i<12;i++){
  const previous=room,next=structuredClone(previous),result=await fn(next);
  if(beforeCommit)await beforeCommit();await Promise.resolve();
  if(room.version!==previous.version)continue;
  next.version=previous.version+1;room=next;return {room:next,result};
 }
 throw new Error("CAS busy");
}}});
const {POST}=await import("../app/api/finance/route");
const {POST:STATUS}=await import("../app/api/finance/status/route");
const req=(body:object)=>new Request("https://test.invalid/api/finance",{method:"POST",body:JSON.stringify(body)});
function setup(){room=freshRoom();register(room,who);room.quotes={BTC:{micro:100000000,at:Date.now()}};beforeCommit=null;}
const input=()=>({type:"open",symbol:"BTC",side:"long",margin:10000,leverage:5,expectedOpeningFeePpm:300,expectedClosingFeePpm:300,requestAt:Date.now(),requestId:randomUUID()});
test("actual route same-key concurrent retries settle once; mismatched payload/owner rejected; explicit new intent allowed",async()=>{
 setup();const body=input();
 const responses=await Promise.all([POST(req(body)),POST(req(body))]);assert.deepEqual(responses.map(r=>r.status),[200,200]);
 assert.equal(room.members[0].positions!.length,1);assert.equal(room.auditPending!.filter(a=>a.what==="finance-open").length,1);
 assert.equal((await POST(req({...body,margin:20000}))).status,409);
 const old=who;who={...who,id:"other"};assert.equal((await STATUS(req(body))).status,409);who=old;
 assert.equal((await POST(req(input()))).status,200);assert.equal(room.members[0].positions!.length,2);
});
test("cancel fence wins racing in-flight execution; stale CAS cannot execute later",async()=>{
 setup();const body=input();let release!:()=>void,entered!:()=>void;
 const gate=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);let blocked=false;
 beforeCommit=async()=>{if(!blocked){blocked=true;entered();await gate;}};
 const execution=POST(req(body));await started;
 const status=await STATUS(req(body));assert.equal((await status.json()).outcome,"cancelled");
 release();assert.equal((await execution).status,409);assert.equal((room.members[0].positions??[]).length,0);
});
test("receipt replay precedes expiry; expired absent orders cannot execute; legacy receipts acknowledge without execution",async()=>{
 setup();const body=input();assert.equal((await POST(req(body))).status,200);
 const legacy={...input(),requestAt:Date.now()-130000};room.receipts.push({id:legacy.requestId,userId:who.id,at:Date.now()});
 assert.equal((await POST(req(legacy))).status,200);
 const expired={...input(),requestAt:Date.now()-130000};assert.equal((await POST(req(expired))).status,409);
 assert.equal((await STATUS(req(expired))).status,200);assert.equal((await POST(req(expired))).status,409);
 assert.equal(room.members[0].positions!.length,1);
});
test("same close retry and different-key already-closed request never double settle",async()=>{
 setup();await POST(req(input()));const close={type:"close",positionId:room.members[0].positions![0].id,requestId:randomUUID(),requestAt:Date.now()};
 assert.equal((await POST(req(close))).status,200);const wallet=room.members[0].wallet;
 assert.equal((await POST(req(close))).status,200);assert.equal((await POST(req({...close,requestId:randomUUID()}))).status,404);assert.equal(room.members[0].wallet,wallet);
});
function storage(){const map=new Map<string,string>();return {getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);},removeItem:(k:string)=>{map.delete(k);}};}
const wait=async(check:()=>boolean)=>{for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,1));}assert.fail("Controller did not settle");};
test("response dropped after real route commit, reload, reconnect and rapid clicks reconcile one fee only",async()=>{
 setup();const saved=storage();let posts=0,statusOnline=false,dropped=false;const bodies:unknown[]=[];
 const fetcher:typeof fetch=async(path,options)=>{
  if(path==="/api/room")return Response.json(room);
  const body=JSON.parse(String(options?.body));bodies.push(body);
  if(path==="/api/finance/status"){if(!statusOnline)throw new Error("offline");return STATUS(req(body));}
  posts++;const response=await POST(req(body));if(!dropped){dropped=true;throw new Error("response lost");}return response;
 };
 const make=()=>new PendingFinanceController({storage:saved,key:"test",fetch:fetcher,headers:()=>({}),room:()=>{},change:()=>{}});
 const first=make();first.connection(true);await wait(()=>first.ready);
 const body=input();await Promise.all([first.submit(body,Date.now()),first.submit(body,Date.now())]);
 await wait(()=>!first.working);assert.equal(posts,1);assert.ok(first.pending);assert.equal(first.ready,false);
 first.connection(false);
 const reloaded=make();statusOnline=true;reloaded.connection(true);await wait(()=>reloaded.ready);
 assert.equal(reloaded.pending,null);assert.equal(posts,1);assert.equal(room.members[0].positions!.length,1);
 assert.match(reloaded.message,/completed/);
 const original=bodies[0] as any;assert.equal((await POST(req(original))).status,200);assert.equal(room.members[0].positions!.length,1);
 await reloaded.submit(body,Date.now());assert.equal(posts,2);assert.equal(room.members[0].positions!.length,2);
});
test("unknown uncommitted intent is cancelled, not automatically executed, across reload",async()=>{
 setup();const saved=storage(),body=input();saved.setItem("test",JSON.stringify(body));let posts=0;
 const c=new PendingFinanceController({storage:saved,key:"test",headers:()=>({}),change:()=>{},room:()=>{},fetch:async(path,options)=>{
  if(path==="/api/finance"){posts++;return POST(req(JSON.parse(String(options?.body))));}
  return STATUS(req(JSON.parse(String(options?.body))));
 }});
 c.connection(true);await wait(()=>c.ready);assert.equal(posts,0);assert.equal((room.members[0].positions??[]).length,0);assert.match(c.message,/not placed/);
 assert.equal((await POST(req(body))).status,409);
});
test("reconnect requires fresh room even when a late successful response arrives; stale snapshots never replace newer version",async()=>{
 setup();let resolve!:()=>void,started!:()=>void;
 const gate=new Promise<void>(r=>resolve=r),began=new Promise<void>(r=>started=r);let reads=0;
 const c=new PendingFinanceController({storage:storage(),key:"test",headers:()=>({}),change:()=>{},room:()=>{},fetch:async(path,options)=>{
  if(path==="/api/room"){reads++;return Response.json(room);}
  const res=await POST(req(JSON.parse(String(options?.body))));started();await gate;return res;
 }});
 c.connection(true);await wait(()=>c.ready);const pending=c.submit(input(),Date.now());await began;c.connection(false);c.connection(true);assert.equal(c.ready,false);
 resolve();await pending;await wait(()=>c.ready);assert.ok(reads>=2);
 const newer={version:100,quotes:{}} as any,older={version:99,quotes:{}} as any;
 assert.equal(mergeRoom(newer,older),newer);
});
