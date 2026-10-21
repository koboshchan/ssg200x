import {test,beforeEach,after} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mutate,move} from "../../lib/store";
import {db,readRoom,closeDatabase} from "../../lib/db";
import {register,applyAction,assertRoom,act,tick} from "../../lib/poker";
import type {Identity,Room} from "../../lib/types";
if(!process.env.MONGODB_DB?.startsWith("fakebucks_test_"))throw new Error("Refusing non-test database");
process.env.MONGODB_DB+="_poker_unready";
const user=(i:number):Identity=>({id:"unready"+i,name:"Player "+i,email:i+"@test",admin:false});
beforeEach(async()=>{await(await db()).dropDatabase();});
after(async()=>{await(await db()).dropDatabase();await closeDatabase();});
async function setup(){
 const now=Date.now();
 await mutate(r=>{for(let i=0;i<2;i++){register(r,user(i),now);applyAction(r,user(i),{type:"join",seat:i,buyIn:20000},now);}applyAction(r,user(0),{type:"ready"},now);});
 return now;
}
for(const kind of ["unready","leave"] as const)for(const dealFirst of [true,false]){
 test("forced CAS "+kind+" vs final ready, dealFirst="+dealFirst,async()=>{
  const now=await setup();
  const withdraw=(r:Room)=>applyAction(r,user(0),{type:kind},now+1);
  const deal=(r:Room)=>applyAction(r,user(1),{type:"ready"},now+1);
  let entered!:()=>void,release!:()=>void,first=true;
  const enteredGate=new Promise<void>(resolve=>{entered=resolve;});
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const delayed=mutate(async r=>{
   if(first){first=false;entered();await gate;}
   (dealFirst?withdraw:deal)(r);
  }).then(()=>true,()=>false);
  await enteredGate;try{await mutate(dealFirst?deal:withdraw);}finally{release();}
  assert.equal(await delayed,!dealFirst);
  const r=await readRoom();assertRoom(r);
  assert.equal(r.handNumber,dealFirst?1:0);
  assert.equal(r.members[0].wallet,!dealFirst&&kind==="leave"?100000:80000);
  if(dealFirst)assert.ok(r.seats[0]?.inHand);
  else if(kind==="leave")assert.equal(r.seats[0],null);
  else assert.equal(r.seats[0]?.ready,false);
 });
}
test("parallel duplicate ready cashout refunds once, with no carry or dead pot",async()=>{
 await setup();const id=randomUUID();
 await Promise.all(Array.from({length:8},()=>move(user(0),{type:"leave"},id,0,null,Date.now())));
 const r=await readRoom();assert.equal(r.members[0].wallet,100000);assert.equal(r.seats[0],null);
 assert.equal(r.pokerCarry??0,0);assert.equal(r.pokerBonus??0,0);assertRoom(r);
});
test("stale unready cannot withdraw consent from a later hand",async()=>{
 const now=await setup();
 await mutate(r=>{applyAction(r,user(1),{type:"ready"},now);act(r,r.seats[r.turn!]!.userId,{type:"fold"},now+1);tick(r,now+9000);});
 await assert.rejects(move(user(0),{type:"unready"},randomUUID(),0,null,Date.now()),/hand has changed/);
 const r=await readRoom();assert.equal(r.handNumber,1);assertRoom(r);
});
