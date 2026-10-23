// Offline route/ledger fixture. Not real Clerk, Mongo CAS, or browser acceptance.
import test,{mock} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {freshRoom,register,assertRoom,totalChips} from "../lib/poker";
import {rouletteState,rouletteTick,roulettePublic} from "../lib/roulette";
import {rouletteBetSchema} from "../lib/casino-schemas";
import {AppError} from "../lib/errors";
import type {Room} from "../lib/types";
const captured={bet:{amount:100,kind:"red"},requestAt:1792736547857,requestId:"ceb8e626-fa8a-49dd-a4db-c9bf60cc4d16",round:3802,tableId:"01",type:"bet"};
const owner={id:"fixture-owner",name:"Owner",email:"owner@fixture.invalid",admin:false};
let signedIn=true,verified=true,blocked=false,rateBlocked=false;
let room:Room=freshRoom();
const rates:string[]=[];
process.env.CLERK_PUBLISHABLE_KEY="pk_test_offline_fixture";
process.env.CLERK_SECRET_KEY="sk_test_offline_fixture";
process.env.APP_ORIGIN="https://fixture.invalid";
// External identity boundary only. Production endpoint and Google-only policy stay real.
mock.module("@clerk/nextjs/server",{namedExports:{auth:async()=>({userId:signedIn?owner.id:null,sessionId:signedIn?"fixture-session":null})}});
mock.module("../lib/clerk-reads.ts",{namedExports:{
 currentClerkSession:async(id:string,userId:string)=>{assert.equal(id,"fixture-session");assert.equal(userId,owner.id);},
 currentClerkUser:async()=>({id:owner.id,firstName:"Owner",lastName:null,username:null,passwordEnabled:false,privateMetadata:{},externalAccounts:[{provider:"oauth_google",emailAddress:owner.email}],primaryEmailAddressId:"email",emailAddresses:[{id:"email",emailAddress:owner.email,verification:{status:verified?"verified":"unverified"}}]})
}});
mock.module("../lib/site-maintenance.ts",{namedExports:{siteMaintenance:async()=>({blocked:false})}});
mock.module("../lib/feature-flags.ts",{namedExports:{enforceFeatureRequest:async()=>{if(blocked)throw new AppError("Fixture feature disabled",403);}}});
mock.module("../lib/db.ts",{namedExports:{readRoom:async()=>structuredClone(room)}});
mock.module("../lib/store.ts",{namedExports:{
 rateLimit:async(key:string)=>{rates.push(key);if(rateBlocked)throw new AppError("Rate limited",429);},
 mutate:async(fn:(r:Room)=>unknown)=>{const next=structuredClone(room);const result=await fn(next);assertRoom(next);next.version++;room=next;return {room:structuredClone(room),result};}
}});
mock.module("../lib/public.ts",{namedExports:{freshPublicRoom:async(r:Room)=>({roulette:roulettePublic(r,owner),wallet:r.members.find(m=>m.id===owner.id)?.wallet})}});
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
 assert.equal(String(input),"http://127.0.0.1:3000/internal-tab-check","unexpected outbound request");
 const body=JSON.parse(String(init?.body));
 assert.equal(body.userId,owner.id);assert.equal(body.game,"roulette");
 return body.tabId==="fixture-tab"&&body.tabProof==="fixture-proof"
  ?Response.json({ok:true}):Response.json({error:"Fixture tab lease missing"},{status:409});
};
const {POST}=await import("../app/api/roulette/route");
const originalNow=Date.now;
let now=captured.requestAt;
Date.now=()=>now;
function setup(){
 now=captured.requestAt;signedIn=true;verified=true;blocked=false;rateBlocked=false;rates.length=0;
 room=freshRoom();register(room,owner);const state=rouletteState(room,now);state.round=captured.round;
}
function request(body:object=captured,headers:Record<string,string>={}){
 return new Request("https://fixture.invalid/api/roulette",{method:"POST",headers:{"origin":"https://fixture.invalid","content-type":"application/json","x-tab-id":"fixture-tab","x-tab-proof":"fixture-proof",...headers},body:JSON.stringify(body)});
}
test("original strict route shape rejects exact captured body specifically at tableId",()=>{
 const base={requestId:z.string().uuid(),requestAt:z.number().int(),round:z.number().int().min(1)};
 const original=z.discriminatedUnion("type",[
  z.object({...base,type:z.literal("rebet")}).strict(),
  z.object({...base,type:z.literal("bet"),bet:rouletteBetSchema}).strict(),
  z.object({...base,type:z.literal("change"),betId:z.string().uuid(),bet:rouletteBetSchema}).strict(),
  z.object({...base,type:z.literal("cancel"),betId:z.string().uuid()}).strict(),
 ]);
 const result=original.safeParse(captured);assert.equal(result.success,false);
 if(!result.success)assert.deepEqual(result.error.issues,[{code:"unrecognized_keys",keys:["tableId"],path:[],message:'Unrecognized key: "tableId"'}]);
});
test("exact captured body passes real endpoint and rouletteMove, debits once, settles red once",async()=>{
 setup();const bank=totalChips(room);
 const first=await POST(request());assert.equal(first.status,200,await first.clone().text());
 assert.equal(room.members[0].wallet,99900);assert.equal(rouletteState(room,now).bets.length,1);
 assert.equal(room.receipts.filter(r=>r.id===captured.requestId).length,1);
 assert.ok(rates.includes("roulette:"+owner.id));assert.ok(rates.includes(owner.id));
 assert.equal((await POST(request())).status,200);assert.equal(room.members[0].wallet,99900);
 now+=60000;rouletteTick(room,now,()=>1);assertRoom(room);
 assert.equal(room.members[0].wallet,100100);assert.equal(room.members[0].spins?.[0].returned,200);
 assert.equal(room.members[0].spins?.[0].stake,100);assert.equal(totalChips(room),bank);
 const wallet=room.members[0].wallet;rouletteTick(room,now+1,()=>1);
 assert.equal(room.members[0].wallet,wallet);assert.equal((await POST(request())).status,200);
 assert.equal(room.members[0].wallet,wallet);
});
test("endpoint auth, origin, content type, verified Google, feature, rate and tab fences reject without debit",async()=>{
 for(const scenario of ["signedOut","unverified","origin","contentType","feature","rate","tab"]){
  setup();let headers:Record<string,string>={};let status=403;
  if(scenario==="signedOut"){signedIn=false;status=401;}
  if(scenario==="unverified")verified=false;
  if(scenario==="origin")headers.origin="https://other.invalid";
  if(scenario==="contentType"){headers["content-type"]="text/plain";status=415;}
  if(scenario==="feature")blocked=true;
  if(scenario==="rate"){rateBlocked=true;status=429;}
  if(scenario==="tab"){headers["x-tab-proof"]="wrong";status=409;}
  const before=structuredClone(room),response=await POST(request(captured,headers));
  assert.equal(response.status,status,scenario+" "+await response.text());assert.deepEqual(room,before);
 }
});
test("malformed table context, payload, expiry, round and lock fences retain atomic rejection",async()=>{
 for(const scenario of ["table","unknown","amount","expired","future","round","locked"]){
  setup();let body={...captured,requestId:randomUUID()} as Record<string,unknown>;let status=400;
  if(scenario==="table")body.tableId="04";
  if(scenario==="unknown")body.extra=true;
  if(scenario==="amount")body.bet={kind:"red",amount:150};
  if(scenario==="expired"){body.requestAt=now-120001;status=409;}
  if(scenario==="future"){body.requestAt=now+10001;status=409;}
  if(scenario==="round"){body.round=captured.round+1;status=409;}
  if(scenario==="locked"){rouletteState(room,now).started=now-55000;status=409;}
  const before=structuredClone(room),response=await POST(request(body));
  assert.equal(response.status,status,scenario+" "+await response.text());assert.deepEqual(room,before);
 }
});
test("receipt replay binds canonical action, round, timestamp and owner, fails closed for legacy",async()=>{
 setup();
 assert.equal((await POST(request())).status,200);
 const wallet=room.members[0].wallet;
 const reordered={type:"bet",tableId:"01",round:captured.round,requestId:captured.requestId,requestAt:captured.requestAt,bet:{kind:"red",amount:100}};
 assert.equal((await POST(request(reordered))).status,200);
 // Shared transport context is not part of the semantic wager identity.
 assert.equal((await POST(request({...reordered,tableId:"02"}))).status,200);
 const {tableId,...withoutTable}=reordered;
 assert.equal((await POST(request(withoutTable))).status,200);
 assert.equal(room.members[0].wallet,wallet);
 assert.equal(rouletteState(room,now).bets.length,1);
 for(const body of [{...captured,bet:{kind:"red",amount:200}},{...captured,round:captured.round+1},{...captured,requestAt:captured.requestAt+1},{...captured,type:"rebet",bet:undefined}]){
  const before=structuredClone(room);
  assert.equal((await POST(request(body))).status,409);
  assert.deepEqual(room,before);
 }
 const receipt=room.receipts.find(r=>r.id===captured.requestId)!;
 receipt.userId="another-user";
 let before=structuredClone(room);
 assert.equal((await POST(request())).status,409);assert.deepEqual(room,before);
 receipt.userId=owner.id;delete receipt.rouletteFingerprint;
 before=structuredClone(room);
 assert.equal((await POST(request())).status,409);assert.deepEqual(room,before);
});
test.after(()=>{Date.now=originalNow;globalThis.fetch=originalFetch;});
