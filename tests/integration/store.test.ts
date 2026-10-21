import {SYMBOLS} from "../../lib/market-shared";
import {test,after,before} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mutate,visit,move,rateLimit,tickRoom} from "../../lib/store";
import {db,closeDatabase,readRoom} from "../../lib/db";
import {assertRoom,register,READY_MS} from "../../lib/poker";
import {spin,spot,openPosition,closePosition} from "../../lib/finance";
import type {Identity} from "../../lib/types";
if(!process.env.MONGODB_DB?.startsWith("fakebucks_test_"))throw new Error("Refusing non-test database");
const admin:Identity={id:"host",email:"host@example.test",name:"Host",admin:true};
const player=(i:number):Identity=>({id:"user_"+i,email:"user"+i+"@example.test",name:"User "+i,admin:false});
before(async()=>{await(await db()).dropDatabase();});
after(async()=>{await(await db()).dropDatabase();await closeDatabase();});
test("Mongo CAS registration is exactly once under 8 parallel visits",async()=>{await Promise.all(Array.from({length:8},()=>visit(admin)));assert.equal((await readRoom()).members.length,1);});
test("non-admin registration opens play immediately, including migrated legacy access",async()=>{
 const who=player(1),r=await visit(who);assert.equal(r.members.find(m=>m.id===who.id)!.approved,true);
 await mutate(r=>{r.members.find(m=>m.id===who.id)!.approved=false;});
 const migrated=await visit(who);assert.equal(migrated.members.find(m=>m.id===who.id)!.approved,true);
 assert.equal(migrated.members.find(m=>m.id===who.id)!.wallet,100000);
 await move(who,{type:"join",seat:0,buyIn:20000},randomUUID(),0,null,Date.now());
 await move(who,{type:"leave"},randomUUID(),0,null,Date.now());
});
test("parallel identical join request cannot debit or occupy twice",async()=>{
 const id=randomUUID(),at=Date.now();await Promise.all(Array.from({length:8},()=>move(player(1),{type:"join",seat:0,buyIn:20_000},id,0,null,at)));
 const r=await readRoom();assert.equal(r.seats.filter(Boolean).length,1);assert.equal(r.members.find(m=>m.id==="user_1")!.wallet,80_000);assertRoom(r);
});
test("seat race has exactly one winner and no loser wallet debit",async()=>{
 for(let i=2;i<=3;i++)await visit(player(i));
 const results=await Promise.allSettled([2,3].map(i=>move(player(i),{type:"join",seat:1,buyIn:20_000},randomUUID(),0,null,Date.now())));
 assert.equal(results.filter(x=>x.status==="fulfilled").length,1);const r=await readRoom();assertRoom(r);assert.equal(r.seats.filter(Boolean).length,2);
 const loser=[2,3].find(i=>!r.seats.some(s=>s?.userId===player(i).id))!;assert.equal(r.members.find(m=>m.id===player(loser).id)!.wallet,100_000);
});
test("parallel duplicate leave credits bankroll once and readiness-leave race is serializable",async()=>{
 let r=await readRoom();const who=player(1),id=randomUUID();
 await Promise.all(Array.from({length:8},()=>move(who,{type:"leave"},id,r.handNumber,null,Date.now())));
 r=await readRoom();assert.equal(r.members.find(m=>m.id===who.id)!.wallet,100000);assert.equal(r.seats[0],null);
 await move(who,{type:"join",seat:0,buyIn:20000},randomUUID(),r.handNumber,null,Date.now());
 const result=await Promise.allSettled([
 move(who,{type:"ready"},randomUUID(),r.handNumber,null,Date.now()),
 move(who,{type:"leave"},randomUUID(),r.handNumber,null,Date.now())]);
 assert.ok(result.some(x=>x.status==="fulfilled"));
 r=await readRoom();assertRoom(r);
 assert.equal(r.seats[0],null);assert.equal(r.members.find(m=>m.id===who.id)!.wallet,100000);
 if(!r.seats[0])await move(who,{type:"join",seat:0,buyIn:20000},randomUUID(),r.handNumber,null,Date.now());
 // Expire the ready window using the actual worker and a deterministic server clock.
 const original=Date.now,now=original(),otherId=r.seats[1]!.userId;
 try{
 await mutate(r=>{r.seats[0]!.ready=true;r.readyDeadline=now+READY_MS;});
 Date.now=()=>now+READY_MS-1;await tickRoom();
 assert.equal((await readRoom()).seats[0]!.ready,true);
 assert.equal((await readRoom()).seats.filter(Boolean).length,2);
 Date.now=()=>now+READY_MS;await tickRoom();
 r=await readRoom();assert.equal(r.seats[0]!.ready,false);assert.equal(r.readyDeadline,null);
 assert.equal(r.seats.filter(Boolean).length,1);assert.equal(r.members.find(m=>m.id===otherId)!.wallet,100000);
 assert.equal(r.members.find(m=>m.id===who.id)!.wallet,80000);assertRoom(r);
 }finally{Date.now=original;}
 const other=[player(2),player(3)].find(p=>!r.seats.some(s=>s?.userId===p.id))!;
 await move(other,{type:"join",seat:1,buyIn:20000},randomUUID(),r.handNumber,null,Date.now());
});
test("parallel duplicate ready starts exactly one hand and locks leaving",async()=>{
 let r=await readRoom();const first=player(1),other=r.seats.find(s=>s&&s.userId!==first.id)!;
 const who=[player(2),player(3)].find(p=>p.id===other.userId)!;
 const id=randomUUID();
 await Promise.all(Array.from({length:8},()=>move(first,{type:"ready"},id,r.handNumber,null,Date.now())));
 r=await readRoom();assert.equal(r.street,"waiting");
 const id2=randomUUID();
 await Promise.all(Array.from({length:8},()=>move(who,{type:"ready"},id2,r.handNumber,null,Date.now())));
 const next=await readRoom();assert.equal(next.handNumber,r.handNumber+1);assert.equal(next.street,"preflop");
 await assert.rejects(move(first,{type:"leave"},randomUUID(),next.handNumber,null,Date.now()));
 assert.equal(next.readyDeadline,null);assertRoom(next);
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
test("persistent Coinbase worker coalesces concurrent starts with one leader and cache-only clients",async()=>{
 const {startPriceWorker}=await import("../../lib/prices");const original=globalThis.fetch,originalWS=globalThis.WebSocket;let calls=0,sockets=0;
 class MockSocket{readyState=0;onopen=null;onmessage=null;onerror=null;onclose=null;constructor(){sockets++;}send(){}close(){this.readyState=3;}}
 globalThis.WebSocket=MockSocket as unknown as typeof WebSocket;
 globalThis.fetch=(async()=>{calls++;return new Response(JSON.stringify({data:{currency:"USD",rates:{...Object.fromEntries(SYMBOLS.map(s=>[s,"1"])),BTC:"0.00001",ETH:"0.0005",SOL:"0.01",DOGE:"10"}}}),{status:200});}) as typeof fetch;
 let worker:ReturnType<typeof startPriceWorker>|undefined;
 try{
 worker=startPriceWorker();
 for(let i=0;i<10;i++)assert.equal(startPriceWorker(),worker);
 await worker.ready;assert.equal(calls,0);assert.equal(sockets,1);
 
 const lock=await(await db()).collection("workers").findOne({_id:"coinbase-feed"} as never);assert.equal(lock!.owner,worker.owner);assert.ok(lock!.until>Date.now());
 }finally{worker?.stop();globalThis.fetch=original;globalThis.WebSocket=originalWS;}
});
test("manual site maintenance persists independently and records administrator audit",async()=>{
 const {siteMaintenance}=await import("../../lib/site-maintenance");
 const {audit}=await import("../../lib/audit");
 await mutate(r=>{audit(r,admin,"site-maintenance","global",r.siteMaintenance===true,true);r.siteMaintenance=true;});
 assert.equal((await siteMaintenance(false)).blocked,true);
 assert.equal((await siteMaintenance(true)).blocked,false);
 assert.equal((await siteMaintenance(true)).manual,true);
 await mutate(r=>{audit(r,admin,"site-maintenance","global",true,false);r.siteMaintenance=false;});
 assert.equal((await siteMaintenance(false)).manual,false);
 assert.equal((await siteMaintenance(false)).blocked,false);
 const events=await(await db()).collection("audit").find({what:"site-maintenance"}).toArray();
 assert.equal(events.length,2);assert.equal(events[0].who,admin.id);
 assert.ok(events.some(e=>e.old===false&&e.new===true));assert.ok(events.some(e=>e.old===true&&e.new===false));
});

test("orphaned legacy chat lock never blocks gameplay or resurrects on room writes",async()=>{
 await(await db()).collection("rooms").updateOne({_id:"main"} as never,{$set:{chatMutationLock:{token:"dead-worker"}}});
 await mutate(r=>{r.siteMaintenance=false;});
 assert.equal((await(await db()).collection("rooms").findOne({_id:"main"} as never))!.chatMutationLock,undefined);
 await visit(admin);await tickRoom();assertRoom(await readRoom());
});

test("admin removal survives visits and move registration, with explicit admin restoration",async()=>{
 const {setMemberAccess}=await import("../../lib/admin");
 const target=player(91);await visit(target);
 const publicId=(await readRoom()).members.find(m=>m.id===target.id)!.publicId;
 const before=(await readRoom()).chatRemovalVersion||0;
 await mutate(r=>setMemberAccess(r,admin,publicId,false));
 await assert.rejects(visit(target),/revoked/);
 await assert.rejects(move(target,{type:"join",seat:5,buyIn:10000},randomUUID(),0,null,Date.now()),/revoked/);
 assert.equal((await readRoom()).chatRemovalVersion,before+1);
 await mutate(r=>setMemberAccess(r,admin,publicId,false));
 assert.equal((await readRoom()).chatRemovalVersion,before+1);
 await mutate(r=>setMemberAccess(r,admin,publicId,true));
 assert.equal((await visit(target)).members.find(m=>m.id===target.id)!.approved,true);
});
