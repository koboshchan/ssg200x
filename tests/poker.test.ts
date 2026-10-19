import {test} from "node:test";
import assert from "node:assert/strict";
import {freshRoom,register,applyAction,act,tick,startHand,showdown,totalChips,assertRoom,legal,TURN_MS,pot,shuffled} from "../lib/poker";
import {publicRoom} from "../lib/public";
import {actionSchema} from "../lib/schemas";
import type {Room,Identity,Seat} from "../lib/types";
const user=(n:number,admin=true):Identity=>({id:"user_"+n,name:"Player "+n,email:"p"+n+"@example.test",admin});
function setup(n=2){const r=freshRoom();for(let i=0;i<n;i++)register(r,user(i),1000);for(let i=0;i<n;i++)applyAction(r,user(i),{type:"join",seat:i,buyIn:20_000},1000);return r;}
function callThrough(r:Room){let count=0;while(!["waiting","showdown"].includes(r.street)&&count++<100){const s=r.seats[r.turn!]!;act(r,s.userId,{type:legal(r,r.turn!)!.check?"check":"call"},2000+count);}assert.ok(count<100);}
test("new accounts start once with $1,000 and default pending",()=>{const r=freshRoom();const m=register(r,user(0,false));assert.equal(m.wallet,100_000);assert.equal(m.approved,false);register(r,user(0,false));assert.equal(r.members.length,1);assert.throws(()=>applyAction(r,user(0,false),{type:"join",seat:0,buyIn:10_000},1000));assertRoom(r);});
test("second seat starts automatically, heads-up button posts SB and acts first",()=>{const r=setup();assert.equal(r.street,"preflop");assert.equal(r.turn,r.button);assert.equal(pot(r),300);assert.equal(r.currentBet,200);assertRoom(r);});
test("three players use live UTG $5 straddle",()=>{const r=setup(3);callThrough(r);tick(r,20_000);assert.equal(r.currentBet,500);assert.equal(pot(r),800);assert.equal(r.seats.filter(s=>s?.inHand).length,3);assertRoom(r);});
test("invalid turn, check facing bet, underraise and overdraw rejected",()=>{const r=setup();const i=r.turn!,id=r.seats[i]!.userId;assert.throws(()=>act(r,r.seats[1-i]!.userId,{type:"call"},1001));assert.throws(()=>act(r,id,{type:"check"},1001));assert.throws(()=>act(r,id,{type:"raise",to:250},1001));assert.throws(()=>act(r,id,{type:"raise",to:999999},1001));assertRoom(r);});
test("heads-up big blind retains option, postflop first action is non-button",()=>{const r=setup();act(r,r.seats[r.turn!]!.userId,{type:"call"},1100);assert.equal(r.turn,1-r.button);assert.equal(r.street,"preflop");act(r,r.seats[r.turn!]!.userId,{type:"check"},1200);assert.equal(r.street,"flop");assert.equal(r.board.length,3);assert.equal(r.turn,1-r.button);assertRoom(r);});
test("full raise resets pending action; raises are to total not increments",()=>{const r=setup();const i=r.turn!;act(r,r.seats[i]!.userId,{type:"raise",to:1000},1100);assert.equal(r.currentBet,1000);assert.equal(r.minRaise,800);assert.equal(r.seats[i]!.bet,1000);assert.equal(legal(r,r.turn!)!.minTo,1800);assertRoom(r);});
test("check through all streets reaches showdown and conserves every cent",()=>{const r=setup();callThrough(r);assert.equal(r.street,"showdown");assert.equal(r.board.length,5);assert.equal(pot(r),0);assert.equal(totalChips(r),200_000);assertRoom(r);});
test("fold immediately awards whole pot and never shows opponent holes",()=>{const r=setup();const i=r.turn!;act(r,r.seats[i]!.userId,{type:"fold"},1100);assert.equal(r.street,"showdown");assert.equal(r.payouts[0].amount,300);const view=publicRoom(r,user(i));assert.deepEqual(view.seats[1-i]!.hole,["?","?"]);assertRoom(r);});
test("active snapshots hide deck, email, user IDs and opponent holes",()=>{const r=setup();const view=publicRoom(r,{...user(0),admin:false});const text=JSON.stringify(view);assert.ok(!text.includes("deck"));assert.ok(!text.includes("user_"));assert.ok(!text.includes("@example.test"));assert.deepEqual(view.seats[1]!.hole,["?","?"]);assert.equal(view.seats[0]!.hole.length,2);});
test("timeout folds facing a call and sits player out; free timeout checks",()=>{const r=setup();const i=r.turn!;tick(r,1000+TURN_MS);assert.ok(r.seats[i]!.sitOut);assert.equal(r.street,"showdown");assertRoom(r);const q=setup();act(q,q.seats[q.turn!]!.userId,{type:"call"},2000);const j=q.turn!;tick(q,2000+TURN_MS);assert.ok(q.seats[j]!.sitOut);assert.equal(q.street,"flop");assertRoom(q);});
test("leave during hand defers cash-out and never deletes committed chips",()=>{const r=setup();const i=r.turn!,id=r.seats[i]!.userId;applyAction(r,user(i),{type:"leave"},1100);assert.equal(r.seats[i]!.leaveAfter,true);assertRoom(r);act(r,id,{type:"fold"},1200);tick(r,1300);assert.equal(r.seats[i],null);assertRoom(r);});
test("seat restrictions, insufficient funds and pending approval are enforced",()=>{const r=setup();assert.throws(()=>applyAction(r,user(0),{type:"join",seat:3,buyIn:10_000},1200));register(r,user(3));assert.throws(()=>applyAction(r,user(3),{type:"join",seat:0,buyIn:10_000},1200));assert.throws(()=>applyAction(r,user(3),{type:"join",seat:2,buyIn:100_001},1200));assert.throws(()=>applyAction(r,user(3),{type:"join",seat:-1,buyIn:10_000},1200));});
test("next hand waits eight seconds, rotates button and does not deal to sitter",()=>{const r=setup();const button=r.button;callThrough(r);tick(r,2500);assert.equal(r.street,"showdown");tick(r,20_000);assert.equal(r.street,"preflop");assert.notEqual(r.button,button);assert.equal(r.handNumber,2);assertRoom(r);});
function crafted(contributions:number[],holes:string[][],folded:number[]=[]):Room{
 const r=freshRoom();r.street="river";r.board=["2c","3d","7h","9s","Jc"];r.button=0;
 contributions.forEach((amount,i)=>{register(r,user(i),1000);r.members[i].wallet=100_000-amount;r.seats[i]={userId:user(i).id,stack:0,hole:holes[i],bet:amount,committed:amount,folded:folded.includes(i),inHand:true,actedAt:0,sitOut:false,leaveAfter:false,seen:1000};});
 return r;
}
test("side pots pay main and side winners, excess uncalled chips returned",()=>{
 const r=crafted([1000,2000,3000],[["As","Ad"],["Ks","Kd"],["Qs","Qd"]]);showdown(r,1000);
 assert.equal(r.seats[0]!.stack,3000);assert.equal(r.seats[1]!.stack,2000);assert.equal(r.seats[2]!.stack,1000);assertRoom(r);
});
test("folded contributions fund pots but cannot win",()=>{const r=crafted([1000,1000,1000],[["As","Ad"],["Ks","Kd"],["Qs","Qd"]],[0]);showdown(r,1000);assert.equal(r.seats[1]!.stack,3000);assert.equal(r.seats[0]!.stack,0);assertRoom(r);});
test("split pots distribute odd cents clockwise after dealer",()=>{const r=crafted([101,101,101],[["As","Kd"],["Ah","Ks"],["2s","2d"]],[2]);r.board=["Qc","Jd","Th","8s","7c"];showdown(r,1000);assert.equal(r.seats[1]!.stack,152);assert.equal(r.seats[0]!.stack,151);assertRoom(r);});
test("short all-in does not reopen betting for previous caller",()=>{
 const r=crafted([0,0,0],[["As","Ad"],["Ks","Kd"],["Qs","Qd"]]);
 r.board=[];r.street="preflop";r.currentBet=1000;r.minRaise=800;r.pending=[1,2];r.turn=1;r.deadline=2000;
 r.seats.forEach((s,i)=>{if(!s)return;s!.stack=i===1?1500:10_000;s!.committed=i===1?0:1000;s!.bet=s!.committed;s!.actedAt=i===1?null:1000;r.members[i].wallet=100_000-s!.stack-s!.committed;});
 act(r,user(1).id,{type:"raise",to:1500},1100);
 assert.equal(r.minRaise,800);assert.equal(legal(r,2)!.raiseOpen,false);assert.throws(()=>act(r,user(2).id,{type:"raise",to:2500},1200));
 act(r,user(2).id,{type:"call"},1200);assert.equal(r.turn,0);assert.equal(legal(r,0)!.raiseOpen,false);assertRoom(r);
});
test("all-in automatically runs board and conserves stacks",()=>{const r=setup();act(r,r.seats[r.turn!]!.userId,{type:"raise",to:20_000},1100);act(r,r.seats[r.turn!]!.userId,{type:"call"},1200);assert.equal(r.street,"showdown");assert.equal(r.board.length,5);assertRoom(r);});
test("shuffle uses one copy of each card",()=>{for(let i=0;i<30;i++){const d=shuffled();assert.equal(d.length,52);assert.equal(new Set(d).size,52);}});
test("strict action schema rejects client identities, floats, negative bets and forged decks",()=>{
 const base={requestId:"b66d4984-f360-4673-8ef9-cd448a9cad93",handNumber:1,turnDeadline:1000,requestAt:1000};
 assert.ok(actionSchema.safeParse({...base,type:"call"}).success);
 for(const input of [{...base,type:"call",userId:"victim"},{...base,type:"raise",to:1.3},{...base,type:"join",seat:0,buyIn:-100},{...base,type:"fold",deck:["As"]}])assert.equal(actionSchema.safeParse(input).success,false);
});
test("random legal play across 500 hands preserves invariant after every action",()=>{
 const r=setup(6);let steps=0;
 while(r.handNumber<500&&steps++<30_000) {
  if(r.street==="showdown"||r.street==="waiting"){
   for(const s of r.seats)if(s){s.seen=1000+steps*100;s.sitOut=false;}
   if(r.seats.filter(Boolean).length<2)break;
   tick(r,Math.max(r.nextDeal||0,1000+steps*100));assertRoom(r);continue;
  }
  const i=r.turn!,s=r.seats[i]!,l=legal(r,i)!;const choice=Math.random();
  if(choice<.13)act(r,s.userId,{type:"fold"},1000+steps*100);
  else if(choice>.80&&l.raiseOpen) {
   const to=Math.min(l.maxTo,l.minTo+Math.floor(Math.random()*20)*100);
   act(r,s.userId,{type:"raise",to},1000+steps*100);
  }else act(r,s.userId,{type:l.check?"check":"call"},1000+steps*100);
  assertRoom(r);
 }
 assert.ok(steps>50);
 assert.equal(totalChips(r),600_000);
});
