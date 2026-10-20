import {test,beforeEach,after} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mutate,move,tickRoom} from "../../lib/store";
import {db,readRoom,closeDatabase} from "../../lib/db";
import {register,applyAction,tick,assertRoom,READY_MS,pot} from "../../lib/poker";
import type {Identity,Room,Action} from "../../lib/types";
if(!process.env.MONGODB_DB?.startsWith("fakebucks_test_"))throw new Error("Refusing non-test database");
process.env.MONGODB_DB+="_ready_window";
const user=(i:number):Identity=>({id:"ready"+i,name:"Ready "+i,email:i+"@test",admin:false});
beforeEach(async()=>{await(await db()).dropDatabase();});
after(async()=>{await(await db()).dropDatabase();await closeDatabase();});
async function waiting(now:number,ready=1){
 await mutate(r=>{
  for(let i=0;i<4;i++)register(r,user(i),now);
  for(let i=0;i<3;i++)applyAction(r,user(i),{type:"join",seat:i,buyIn:10000*(i+1)},now);
  for(let i=0;i<ready;i++)applyAction(r,user(i),{type:"ready"},now);
  // Also exercise a persisted deadline with zero ready seats (e.g. migrated state).
  r.readyDeadline=now+READY_MS;
 });
 return readRoom();
}
function wallet(r:Room,i:number){return r.members.find(m=>m.id===user(i).id)!.wallet;}
test("mixed ready expiry survives reconnect, starts remaining ready players, and refunds only nonparticipants once",async()=>{
 const original=Date.now,now=original();let r=await waiting(now,2);const expiry=r.readyDeadline!;
 assert.equal(r.street,"waiting");assert.equal(r.seats[2]!.inHand,false);
 await closeDatabase();
 try{
  Date.now=()=>expiry;
  await Promise.all(Array.from({length:6},()=>tickRoom()));
  r=await readRoom();assert.equal(r.seats[2],null);assert.equal(wallet(r,2),100000);
  assert.equal(wallet(r,0),90000);assert.equal(wallet(r,1),80000);
  assert.ok(r.seats.slice(0,2).every(s=>s?.ready&&s.inHand));
  assert.equal(r.handNumber,1);assert.equal(r.street,"preflop");assert.equal(r.readyDeadline,null);assertRoom(r);
  await Promise.all(Array.from({length:6},()=>tickRoom()));
  r=await readRoom();assert.equal(wallet(r,2),100000);assert.equal(r.handNumber,1);assertRoom(r);
 }finally{Date.now=original;}
});
test("all-unready persisted expiry is picked up on restart without requiring a ready seat",async()=>{
 const original=Date.now,now=original(),before=await waiting(now,0);
 await closeDatabase();
 try{
  Date.now=()=>before.readyDeadline!;
  await Promise.all(Array.from({length:6},()=>tickRoom()));
  let r=await readRoom();assert.ok(r.seats.every(s=>s===null));assert.ok(r.members.every(m=>m.wallet===100000));
  assert.equal(r.readyDeadline,null);assert.equal(r.handNumber,0);assert.equal(pot(r),0);assert.equal(r.pokerCarry??0,0);assertRoom(r);
  await closeDatabase();await tickRoom();r=await readRoom();
  assert.ok(r.members.every(m=>m.wallet===100000));assertRoom(r);
 }finally{Date.now=original;}
});
test("real request just before expiry saves readiness; boundary request and concurrent leaves cannot double-refund",async()=>{
 const original=Date.now,now=original();let r=await waiting(now);const expiry=r.readyDeadline!;
 try{
  Date.now=()=>expiry-1;
  await Promise.all([move(user(1),{type:"ready"},randomUUID(),0,null,Date.now()),tickRoom()]);
  r=await readRoom();assert.ok(r.seats[1]?.ready);assert.equal(r.street,"waiting");
  Date.now=()=>expiry;
  const results=await Promise.allSettled([
   move(user(2),{type:"ready"},randomUUID(),0,null,Date.now()),
   move(user(2),{type:"leave"},randomUUID(),0,null,Date.now()),
   ...Array.from({length:6},()=>tickRoom())
  ]);
  assert.equal(results[0].status,"rejected");
  r=await readRoom();assert.equal(r.seats[2],null);assert.equal(wallet(r,2),100000);
  assert.ok(r.seats[0]?.ready);assert.ok(r.seats[1]?.ready);assert.equal(r.handNumber,1);assertRoom(r);
 }finally{Date.now=original;}
});
for(const kind of ["ready","leave","join"] as const)for(const expiryFirst of [true,false]){
 test("forced CAS expiry versus "+kind+" rechecks both commit orders, expiryFirst="+expiryFirst,async()=>{
  const now=Date.now(),before=await waiting(now),expiry=before.readyDeadline!;
  const action:Action=kind==="join"?{type:"join",seat:3,buyIn:40000}:{type:kind};
  const who=user(kind==="join"?3:1);
  const act=(r:Room)=>applyAction(r,who,action,expiry-1);
  const expire=(r:Room)=>tick(r,expiry);
  let entered!:()=>void,release!:()=>void,first=true;
  const reading=new Promise<void>(resolve=>{entered=resolve;});
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const delayed=mutate(async r=>{
   if(first){first=false;entered();await gate;}
   if(expiryFirst)act(r);else expire(r);
  }).then(()=>true,()=>false);
  await reading;
  try{await mutate(expiryFirst?expire:act);}finally{release();}
  assert.equal(await delayed,!(expiryFirst&&kind!=="join"));
  let r=await readRoom();assertRoom(r);assert.equal(r.seats[2],null);assert.equal(wallet(r,2),100000);
  if(kind==="ready"&&!expiryFirst){
   assert.ok(r.seats[1]?.ready);assert.equal(wallet(r,1),80000);assert.equal(r.handNumber,1);
  }else{assert.equal(r.seats[1],null);assert.equal(wallet(r,1),100000);assert.equal(r.handNumber,0);}
  if(kind==="join"){
   assert.equal(!!r.seats[3],expiryFirst);assert.equal(wallet(r,3),expiryFirst?60000:100000);
  }
  assert.ok(r.seats[0]?.ready);assert.equal(wallet(r,0),90000);
  await Promise.all(Array.from({length:6},()=>mutate(r=>tick(r,expiry))));
  r=await readRoom();assert.equal(wallet(r,1),kind==="ready"&&!expiryFirst?80000:100000);
  assert.equal(wallet(r,2),100000);assertRoom(r);
 });
}
