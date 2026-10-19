import {test,after,before} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mutate,visit,move,approve,rateLimit} from "../../lib/store";
import {db,closeDatabase,readRoom} from "../../lib/db";
import {assertRoom,register} from "../../lib/poker";
import {spin,spot,openPosition,closePosition} from "../../lib/finance";
import type {Identity} from "../../lib/types";
if(!process.env.MONGODB_DB?.startsWith("fakebucks_test_"))throw new Error("Refusing non-test database");
const admin:Identity={id:"host",email:"host@example.test",name:"Host",admin:true};
const player=(i:number):Identity=>({id:"user_"+i,email:"user"+i+"@example.test",name:"User "+i,admin:false});
before(async()=>{await(await db()).dropDatabase();});
after(async()=>{await(await db()).dropDatabase();await closeDatabase();});
test("Mongo CAS registration is exactly once under 8 parallel visits",async()=>{await Promise.all(Array.from({length:8},()=>visit(admin)));assert.equal((await readRoom()).members.length,1);});
test("pending registration cannot play or approve; host approval opens access",async()=>{
 const who=player(1),r=await visit(who);assert.equal(r.members.find(m=>m.id===who.id)!.approved,false);
 await assert.rejects(move(who,{type:"join",seat:0,buyIn:20_000},randomUUID(),0,null,Date.now()));
 await assert.rejects(approve(who,r.members[0].publicId,true));await approve(admin,r.members.find(m=>m.id===who.id)!.publicId,true);
});
test("parallel identical join request cannot debit or occupy twice",async()=>{
 const id=randomUUID(),at=Date.now();await Promise.all(Array.from({length:8},()=>move(player(1),{type:"join",seat:0,buyIn:20_000},id,0,null,at)));
 const r=await readRoom();assert.equal(r.seats.filter(Boolean).length,1);assert.equal(r.members.find(m=>m.id==="user_1")!.wallet,80_000);assertRoom(r);
});
test("seat race has exactly one winner and no loser wallet debit",async()=>{
 for(let i=2;i<=3;i++){const r=await visit(player(i));await approve(admin,r.members.find(m=>m.id===player(i).id)!.publicId,true);}
 const results=await Promise.allSettled([2,3].map(i=>move(player(i),{type:"join",seat:1,buyIn:20_000},randomUUID(),0,null,Date.now())));
 assert.equal(results.filter(x=>x.status==="fulfilled").length,1);const r=await readRoom();assertRoom(r);assert.equal(r.seats.filter(Boolean).length,2);
 const loser=[2,3].find(i=>!r.seats.some(s=>s?.userId===player(i).id))!;assert.equal(r.members.find(m=>m.id===player(loser).id)!.wallet,100_000);
});
test("stale hand, stale turn and expired request fail without mutations",async()=>{
 const r=await readRoom(),id=r.seats[r.turn!]!.userId,who=id===player(1).id?player(1):[player(2),player(3)].find(p=>p.id===id)!;
 await assert.rejects(move(who,{type:"fold"},randomUUID(),r.handNumber+1,r.deadline,Date.now()));
 await assert.rejects(move(who,{type:"fold"},randomUUID(),r.handNumber,r.deadline!-1,Date.now()));
 await assert.rejects(move(who,{type:"fold"},randomUUID(),r.handNumber,r.deadline,Date.now()-121_000));
 assert.equal((await readRoom()).version,r.version);
});
test("financial multi-operation CAS preserves every cent with shared bankroll",async()=>{
 await mutate(r=>{r.quotes={BTC:{micro:100_000_000_000,at:Date.now()}};register(r,admin);});
 await Promise.all(Array.from({length:8},(_,i)=>mutate(r=>spot(r,admin,"BTC","buy",1000))));
 await mutate(r=>{spin(r,admin,[{kind:"straight",pick:0,amount:100}],0,"spin",Date.now());openPosition(r,admin,"BTC","long",1000,5,"p",Date.now());});
 await mutate(r=>closePosition(r,admin,"p"));
 const r=await readRoom();assert.equal(r.members.find(m=>m.id===admin.id)!.holdings![0].cost,8000);assertRoom(r);
});
test("Mongo-backed rate counter enforces limit across parallel callers",async()=>{
 const result=await Promise.allSettled(Array.from({length:8},()=>rateLimit("qa_rate",3)));assert.equal(result.filter(x=>x.status==="fulfilled").length,3);
});
test("host revocation schedules occupied seat cashout, cannot reset own access",async()=>{
 const r=await readRoom(),m=r.members.find(m=>m.id==="user_1")!;await approve(admin,m.publicId,false);const next=await readRoom();assert.equal(next.members.find(x=>x.id===m.id)!.approved,false);assert.equal(next.seats[0]!.leaveAfter,true);await assert.rejects(approve(admin,r.members.find(x=>x.id===admin.id)!.publicId,false));assertRoom(next);
});
test("every admin change has durable old/new audit collection record",async()=>{const r=await readRoom();const m=r.members.find(m=>m.id==="user_1")!;const entry=await(await db()).collection("audit").findOne({what:"approval",target:m.id,new:false});assert.ok(entry);assert.equal(entry.who,admin.id);assert.equal(entry.old,true);assert.ok(entry.at);});
test("batched Coinbase worker rate lease coalesces concurrent fetches and cache-only clients",async()=>{
 const {refreshPrices}=await import("../../lib/prices");const original=globalThis.fetch;let calls=0;
 globalThis.fetch=(async()=>{calls++;return new Response(JSON.stringify({data:{currency:"USD",rates:{BTC:"0.00001",ETH:"0.0005",SOL:"0.01",DOGE:"10"}}}),{status:200});}) as typeof fetch;
 try{
 await(await db()).collection<{_id:string;nextAt:number}>("workers").deleteOne({_id:"coinbase"});
 await Promise.all(Array.from({length:10},()=>refreshPrices()));assert.equal(calls,1);
 await refreshPrices();assert.equal(calls,1);const state=await readRoom();assert.equal(state.quotes!.BTC!.micro,100_000_000_000);
 const lock=await(await db()).collection<{_id:string;nextAt:number}>("workers").findOne({_id:"coinbase"});assert.ok(lock!.nextAt>Date.now());assert.ok(lock!.nextAt-Date.now()<=1000);
 }finally{globalThis.fetch=original;}
});
