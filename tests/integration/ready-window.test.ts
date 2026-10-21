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
test("mixed ready expiry refunds ALL stacks once across reconnect and concurrent worker ticks without dealing",async()=>{
 const original=Date.now,now=original();const before=await waiting(now,2),expiry=before.readyDeadline!;
 await closeDatabase();
 try{
  Date.now=()=>expiry-1;await tickRoom();
  assert.equal((await readRoom()).seats.filter(Boolean).length,3);
  Date.now=()=>expiry;
  await Promise.all(Array.from({length:8},()=>tickRoom()));
  let r=await readRoom();
  assert.ok(r.seats.every(s=>s===null));assert.ok(r.members.every(m=>m.wallet===100000));
  assert.equal(r.readyDeadline,null);assert.equal(r.handNumber,0);assert.equal(r.street,"waiting");
  assert.equal(pot(r),0);assert.equal(r.pokerCarry??0,0);assert.equal(r.pokerBonus??0,0);assertRoom(r);
  await closeDatabase();await Promise.all(Array.from({length:8},()=>tickRoom()));r=await readRoom();
  assert.ok(r.members.every(m=>m.wallet===100000));assertRoom(r);
 }finally{Date.now=original;}
});
test("all-unready persisted expiry is picked up on restart without requiring a ready seat",async()=>{
 const original=Date.now,now=original(),before=await waiting(now,0);
 await closeDatabase();
 try{
  Date.now=()=>before.readyDeadline!;
  await Promise.all(Array.from({length:6},()=>tickRoom()));
  const r=await readRoom();assert.ok(r.seats.every(s=>s===null));assert.ok(r.members.every(m=>m.wallet===100000));
  assert.equal(r.readyDeadline,null);assert.equal(r.handNumber,0);assert.equal(pot(r),0);assertRoom(r);
 }finally{Date.now=original;}
});
test("ready request at expiry cannot rescue a ready OR unready seat; concurrent leave cannot double refund",async()=>{
 const original=Date.now,now=original(),before=await waiting(now,2);
 try{
  Date.now=()=>before.readyDeadline!;
  const results=await Promise.allSettled([
   move(user(0),{type:"ready"},randomUUID(),0,null,Date.now()),
   move(user(2),{type:"ready"},randomUUID(),0,null,Date.now()),
   move(user(0),{type:"leave"},randomUUID(),0,null,Date.now()),
   ...Array.from({length:6},()=>tickRoom())
  ]);
  assert.equal(results[0].status,"rejected");assert.equal(results[1].status,"rejected");
  const r=await readRoom();assert.ok(r.seats.every(s=>s===null));assert.ok(r.members.every(m=>m.wallet===100000));
  assert.equal(r.handNumber,0);assertRoom(r);
 }finally{Date.now=original;}
});
for(const expiryFirst of [true,false]){
 test("forced CAS expiry vs final Ready preserves refunds or already-started hand, expiryFirst="+expiryFirst,async()=>{
  const now=Date.now(),before=await waiting(now,2),expiry=before.readyDeadline!;
  const deal=(r:Room)=>applyAction(r,user(2),{type:"ready"},expiry-1);
  const expire=(r:Room)=>tick(r,expiry);
  let entered!:()=>void,release!:()=>void,first=true;
  const reading=new Promise<void>(resolve=>{entered=resolve;});
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const delayed=mutate(async r=>{
   if(first){first=false;entered();await gate;}
   (expiryFirst?deal:expire)(r);
  }).then(()=>true,()=>false);
  await reading;
  try{await mutate(expiryFirst?expire:deal);}finally{release();}
  assert.equal(await delayed,!expiryFirst);
  let r=await readRoom();assertRoom(r);
  if(expiryFirst){assert.ok(r.seats.every(s=>s===null));assert.ok(r.members.every(m=>m.wallet===100000));assert.equal(r.handNumber,0);}
  else{assert.ok(r.seats.slice(0,3).every(s=>s?.inHand));assert.equal(r.handNumber,1);assert.deepEqual(r.members.slice(0,3).map(m=>m.wallet),[90000,80000,70000]);}
  await Promise.all(Array.from({length:6},()=>mutate(r=>tick(r,expiry))));
  r=await readRoom();assertRoom(r);assert.equal(r.handNumber,expiryFirst?0:1);
 });
}
for(const kind of ["unready","leave"] as const)for(const expiryFirst of [true,false]){
 test("forced CAS expiry vs "+kind+" refunds each stack once, expiryFirst="+expiryFirst,async()=>{
  const now=Date.now(),before=await waiting(now,2),expiry=before.readyDeadline!;
  const action=(r:Room)=>applyAction(r,user(0),{type:kind},expiry-1);
  const expire=(r:Room)=>tick(r,expiry);
  let entered!:()=>void,release!:()=>void,first=true;
  const reading=new Promise<void>(resolve=>{entered=resolve;});
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const delayed=mutate(async r=>{if(first){first=false;entered();await gate;}(expiryFirst?action:expire)(r);}).then(()=>true,()=>false);
  await reading;try{await mutate(expiryFirst?expire:action);}finally{release();}
  assert.equal(await delayed,!expiryFirst);const r=await readRoom();
  assert.ok(r.seats.every(s=>s===null));assert.ok(r.members.every(m=>m.wallet===100000));assert.equal(r.handNumber,0);assertRoom(r);
 });
}
