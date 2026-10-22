import {test,after} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {db,readRoom,closeDatabase} from "../../lib/db";
import {mutate} from "../../lib/store";
import {doudizhuMove} from "../../lib/doudizhu-store";
import {tickDoudizhu,doudizhuNeedsTick,DOUDIZHU_IDLE_MS,type DoudizhuInput} from "../../lib/doudizhu";
import {assertRoom,totalChips} from "../../lib/poker";
if(!/^fakebucks_test_/.test(process.env.MONGODB_DB??""))throw Error("Isolated test DB required");
process.env.MONGODB_DB+="_idle";
after(async()=>{await(await db()).dropDatabase();await closeDatabase();});
const users=Array.from({length:3},(_,i)=>({id:"mongo-idle-"+i,name:"Idle "+i,email:"qa@invalid.test",admin:false}));
const request=(p:Partial<DoudizhuInput>)=>({type:"ready",requestId:randomUUID(),requestAt:Date.now(),...p}) as DoudizhuInput;
test("Mongo CAS atomically refunds public/private idle rooms once across concurrent ticks and reconnect",async()=>{
 for(const isPublic of [false,true]){
  const v=await doudizhuMove(users[0],request({type:"create",isPublic}));
  await doudizhuMove(users[1],request({type:"join",code:v.room!.code}));
  const deadline=v.room!.idleDeadline!;
  await closeDatabase();let r=await readRoom();assert.equal(r.doudizhu![0].idleDeadline,deadline);
  assert.equal(r.members.find(m=>m.id===users[0].id)!.wallet,90000);
  await Promise.all(Array.from({length:6},()=>mutate(room=>tickDoudizhu(room,deadline))));
  await closeDatabase();r=await readRoom();assert.equal(r.doudizhu!.length,0);
  assert(r.members.every(m=>m.wallet===100000));assertRoom(r);assert.equal(totalChips(r),200000);
  assert(!doudizhuNeedsTick(r,deadline+1));
 }
 assert.equal(await(await db()).collection("audit").countDocuments({what:"doudizhu.idle_cleanup"}),2);
});
test("Mongo legacy grace initializes once, survives persistence, ready cancels and active rooms are exempt",async()=>{
 await doudizhuMove(users[0],request({type:"create"}));
 await mutate(r=>{delete r.doudizhu![0].idleDeadline;});
 const now=Date.now()+1000000;
 await mutate(r=>{assert(doudizhuNeedsTick(r,now));tickDoudizhu(r,now);});
 await closeDatabase();let r=await readRoom();
 assert.equal(r.doudizhu![0].idleDeadline,now+DOUDIZHU_IDLE_MS);
 await mutate(r=>tickDoudizhu(r,now+1));
 r=await readRoom();assert.equal(r.doudizhu![0].idleDeadline,now+DOUDIZHU_IDLE_MS);
 await doudizhuMove(users[0],request({type:"ready",version:r.doudizhu![0].version}));
 await mutate(r=>tickDoudizhu(r,now+DOUDIZHU_IDLE_MS));
 r=await readRoom();assert.equal(r.doudizhu![0].idleDeadline,undefined);
 assert.equal(r.doudizhu![0].players[0].escrow,10000);
 // Each active phase must retain its room and exact reserve even with an expired idle field.
 for(const phase of ["bidding","doubling","playing"] as const){
  await mutate(r=>{const g=r.doudizhu![0];g.phase=phase;g.deadline=now+10000000;g.idleDeadline=1;tickDoudizhu(r,now);});
  await closeDatabase();r=await readRoom();
  assert.equal(r.doudizhu![0].phase,phase);assert.equal(r.doudizhu![0].idleDeadline,undefined);
  assert.equal(r.members.find(m=>m.id===users[0].id)!.wallet,90000);assertRoom(r);assert.equal(totalChips(r),200000);
 }
});

test("Mongo finished legacy room refunds remaining reserves and empty persisted rooms are removed",async()=>{
 // Previous test deliberately left an active fixture; turn it into a legacy finished room.
 await mutate(r=>{const g=r.doudizhu![0];g.phase="finished";g.players.forEach(p=>p.ready=false);delete g.idleDeadline;});
 const now=Date.now()+2000000;
 await mutate(r=>tickDoudizhu(r,now));
 await closeDatabase();let r=await readRoom();
 assert.equal(r.doudizhu![0].idleDeadline,now+DOUDIZHU_IDLE_MS);
 await Promise.all([mutate(r=>tickDoudizhu(r,now+DOUDIZHU_IDLE_MS)),mutate(r=>tickDoudizhu(r,now+DOUDIZHU_IDLE_MS))]);
 r=await readRoom();assert.equal(r.doudizhu!.length,0);assert(r.members.every(m=>m.wallet===100000));assertRoom(r);
 const v=await doudizhuMove(users[0],request({type:"create"}));
 const empty=structuredClone((await readRoom()).doudizhu![0]);
 await doudizhuMove(users[0],request({type:"leave",version:v.room!.version}));
 empty.players=[];
 await mutate(r=>{r.doudizhu=[empty];});
 await mutate(r=>{assert(doudizhuNeedsTick(r,now));tickDoudizhu(r,now);});
 await closeDatabase();r=await readRoom();assert.equal(r.doudizhu!.length,0);assertRoom(r);
 assert.equal(totalChips(r),200000);
 assert.equal(await(await db()).collection("audit").countDocuments({what:"doudizhu.idle_cleanup"}),4);
});
