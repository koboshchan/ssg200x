import {test,beforeEach,after} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mutate,move,tickRoom} from "../../lib/store";
import {blackjackMove} from "../../lib/blackjack-store";
import {db,readRoom,closeDatabase} from "../../lib/db";
import {register,applyAction,act,tick,forfeitSeat,assertRoom,startHand} from "../../lib/poker";
import {blackjackTablesAction} from "../../lib/blackjack";
import {ensure} from "../../lib/errors";
import type {Identity} from "../../lib/types";
if(!process.env.MONGODB_DB?.startsWith("fakebucks_test_"))throw new Error("Refusing non-test database");
process.env.MONGODB_DB+="_turn_timers";
const user=(i:number):Identity=>({id:"timer"+i,name:"Timer "+i,email:i+"@test",admin:false});
beforeEach(async()=>{await(await db()).dropDatabase();});
after(async()=>{await(await db()).dropDatabase();await closeDatabase();});
async function poker(now:number,n=3){
 await mutate(r=>{
  for(let i=0;i<n;i++){register(r,user(i),now);applyAction(r,user(i),{type:"join",seat:i,buyIn:20000},now);}
  for(let i=0;i<n;i++)applyAction(r,user(i),{type:"ready"},now);
 });
 return readRoom();
}
test("Mongo CAS timeout/action race has one outcome and conserves the forfeited stack",async()=>{
 const base=Date.now(),r=await poker(base),deadline=r.deadline!,i=r.turn!,wallet=r.members[i].wallet;
 const result=await Promise.allSettled([
  mutate(r=>{ensure(r.deadline===deadline,"Turn changed",409);act(r,user(i).id,{type:"call"},deadline-1);}),
  mutate(r=>tick(r,deadline))
 ]);
 const next=await readRoom();assertRoom(next);assert.equal(next.members[i].wallet,wallet);
 if(next.seats[i]){assert.equal(next.deadline,deadline-1+100000);assert.equal(next.seats[i]!.bet,500);}
 else{assert.equal(next.pokerBonus,19500);assert.deepEqual(next.pokerDead,[500]);assert.equal(result[0].status,"rejected");}
 assert.equal(next.handNumber,1);
});
test("actual poker request just before expiry survives concurrent timer; boundary request cannot dodge kick",async()=>{
 const original=Date.now,base=original();
 try{
  let r=await poker(base),deadline=r.deadline!,i=r.turn!;
  Date.now=()=>deadline-1;
  await Promise.all([move(user(i),{type:"call"},randomUUID(),r.handNumber,deadline,Date.now()),tickRoom()]);
  r=await readRoom();assert.ok(r.seats[i]);assert.equal(r.deadline,deadline-1+100000);assertRoom(r);
  const next=r.turn!,d=r.deadline!;Date.now=()=>d;
  const results=await Promise.allSettled([move(user(next),{type:"call"},randomUUID(),r.handNumber,d,Date.now()),...Array.from({length:4},()=>tickRoom())]);
  assert.equal(results[0].status,"rejected");r=await readRoom();assert.equal(r.seats[next],null);assertRoom(r);
 }finally{Date.now=original;}
});
test("expired poker deadline is recovered from Mongo after connection/server restart",async()=>{
 const original=Date.now,base=original();const r=await poker(base),i=r.turn!,deadline=r.deadline!;
 await closeDatabase();
 try{Date.now=()=>deadline;await tickRoom();const next=await readRoom();assert.equal(next.seats[i],null);assert.equal(next.members[i].wallet,80000);assertRoom(next);}finally{Date.now=original;}
});
test("next-hand carry survives DB restart and parallel ticks cannot duplicate it",async()=>{
 const now=Date.now();
 await mutate(r=>{for(let i=0;i<3;i++){register(r,user(i),now);applyAction(r,user(i),{type:"join",seat:i,buyIn:20000},now);}forfeitSeat(r,2);});
 await closeDatabase();
 let r=await readRoom();assert.equal(r.pokerCarry,20000);assert.equal(r.members[2].wallet,80000);assertRoom(r);
 await mutate(r=>{applyAction(r,user(0),{type:"ready"},now);applyAction(r,user(1),{type:"ready"},now);});
 r=await readRoom();await mutate(r=>act(r,user(r.turn!).id,{type:"fold"},now+1));
 await Promise.all(Array.from({length:6},()=>mutate(r=>tick(r,now+2))));
 r=await readRoom();assert.equal(r.payouts[0].amount,20300);assert.equal(r.pokerCarry,0);assertRoom(r);
});
test("idle fifth completed hand removes exactly once under concurrent completion and persists resets",async()=>{
 const now=Date.now();
 await mutate(r=>{
  for(let i=0;i<3;i++){register(r,user(i),now);applyAction(r,user(i),{type:"join",seat:i,buyIn:20000},now);}
  r.seats[2]!.sitOut=true;r.seats[2]!.idleHands=4;
  r.seats[0]!.idleHands=4;
  r.seats[0]!.ready=true;r.seats[1]!.ready=true;startHand(r,now);
 });
 await closeDatabase();let r=await readRoom();assert.equal(r.seats[0]!.idleHands,0);
 const deadline=r.deadline!,i=r.turn!,hand=r.handNumber;
 await Promise.allSettled(Array.from({length:6},()=>mutate(r=>{
  if(r.handNumber===hand&&r.deadline===deadline)act(r,user(i).id,{type:"fold"},now+1);
 })));
 r=await readRoom();assert.equal(r.seats[2],null);assert.equal(r.members[2].wallet,80000);assert.equal(r.payouts[0].amount,20300);
 assert.equal(r.idleCountedHand,hand);assertRoom(r);
 const total=r.payouts.reduce((n,p)=>n+p.amount,0);
 await Promise.all(Array.from({length:6},()=>tickRoom()));r=await readRoom();
 assert.equal(r.payouts.reduce((n,p)=>n+p.amount,0),total);assertRoom(r);
});
async function blackjack(now:number){
 await mutate(r=>{
  for(let i=0;i<2;i++){
   register(r,user(i),now);
   blackjackTablesAction(r,user(i),{tableId:"lounge",type:"join",seat:i},now);
   blackjackTablesAction(r,user(i),{tableId:"lounge",type:"bet",amount:100},now);
  }
  // Persist an already-playing split/double fixture with all escrow deducted.
  const b=r.blackjackTables!.tables.lounge!;
  b.phase="playing";b.round=1;b.turn=0;b.hand=1;b.deadline=now+100000;
  b.dealer=["Ts","7h"];b.shoe=Array(180).fill("2s");
  b.seats[0]!.hands=[{cards:["8s","2s","Ts"],bet:200,done:true,split:true,payout:0},{cards:["8h","3s"],bet:100,done:false,split:true,payout:0}];
  b.seats[1]!.hands=[{cards:["Ts","9s"],bet:100,done:false,split:false,payout:0}];
  r.members[0].wallet-=200;
 });return readRoom();
}
test("blackjack split/double timeout CAS credits house once after restart; other payout preserved",async()=>{
 const original=Date.now,now=original();let r=await blackjack(now),deadline=r.blackjackTables!.tables.lounge!.deadline!;
 await closeDatabase();
 try{
  Date.now=()=>deadline;
  const results=await Promise.allSettled([
   blackjackMove(user(0),{tableId:"lounge",type:"stand",round:1,deadline,requestId:randomUUID(),requestAt:deadline}),
   ...Array.from({length:6},()=>tickRoom())
  ]);
  assert.equal(results[0].status,"rejected");r=await readRoom();
  assert.equal(r.blackjackTables!.tables.lounge!.seats[0],null);assert.equal(r.members[0].wallet,99700);assert.equal(r.house,300);assertRoom(r);
  const b=r.blackjackTables!.tables.lounge!,id=randomUUID();
  await Promise.all(Array.from({length:6},()=>blackjackMove(user(1),{tableId:"lounge",type:"stand",round:1,deadline:b.deadline,requestId:id,requestAt:deadline})));
  r=await readRoom();assert.equal(r.members[1].wallet,100100);assert.equal(r.house,200);assertRoom(r);
 }finally{Date.now=original;}
});
test("blackjack just-before-expiry request refreshes timer, repeated action debits once",async()=>{
 const original=Date.now,now=original();let r=await blackjack(now),deadline=r.blackjackTables!.tables.lounge!.deadline!;
 try{
  Date.now=()=>deadline-1;const id=randomUUID();
  await Promise.all(Array.from({length:6},()=>blackjackMove(user(0),{tableId:"lounge",type:"double",round:1,deadline,requestId:id,requestAt:Date.now()})));
  r=await readRoom();assert.equal(r.members[0].wallet,99600);assert.equal(r.blackjackTables!.tables.lounge!.turn,1);
  assert.equal(r.blackjackTables!.tables.lounge!.deadline,deadline-1+100000);
  Date.now=()=>deadline;await tickRoom();r=await readRoom();assert.ok(r.blackjackTables!.tables.lounge!.seats[0]);assertRoom(r);
 }finally{Date.now=original;}
});
