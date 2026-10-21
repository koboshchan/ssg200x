import {test} from "node:test";
import assert from "node:assert/strict";
import {freshRoom,register,assertRoom} from "../lib/poker";
import {rouletteState,rouletteAction,rouletteTick} from "../lib/roulette";
import {settleAdvancements,advancementView,ADVANCEMENTS} from "../lib/advancements";
import {publicRoom} from "../lib/public";
import type {RouletteWager} from "../lib/roulette";
const who={id:"a",name:"Alice",email:"a@example.invalid",admin:false},other={...who,id:"b"};
function setup(){const r=freshRoom();register(r,who);register(r,other);return r;}
const wager=(kind:RouletteWager["bet"]["kind"]="red",extra:Partial<RouletteWager>={}):RouletteWager=>({id:"bet",userId:who.id,bet:{kind,amount:100},...extra});
test("all eight thresholds unlock once, preserve timestamps across wins, and final name is exact",()=>{
 const m=setup().members[0];for(let round=1;round<=14;round++){
 settleAdvancements(m,[wager()],0,round,round*100);
 assert.equal(m.advancements!.streak,round);
 assert.deepEqual(Object.keys(m.advancements!.unlocked).map(Number),ADVANCEMENTS.filter(a=>a.tier<=round).map(a=>a.tier));
 }
 const unlocked={...m.advancements!.unlocked};settleAdvancements(m,[wager()],1,15,1500);
 assert.equal(m.advancements!.streak,0);assert.deepEqual(m.advancements!.unlocked,unlocked);
 assert.equal(ADVANCEMENTS.at(-1)!.name,"I'm super unlucky");
});
test("all six even-money kinds lose on zero, win resets, mixed win/loss resets despite net loss",()=>{
 for(const kind of ["red","black","odd","even","low","high"] as const){
  const m=setup().members[0];settleAdvancements(m,[wager(kind)],0,1,100);
  assert.equal(m.advancements!.streak,1);
  settleAdvancements(m,[wager(kind)],kind==="black"||kind==="even"?2:kind==="high"?19:1,2,200);
  assert.equal(m.advancements!.streak,0);
 }
 const m=setup().members[0];settleAdvancements(m,[wager()],0,1,100);
 settleAdvancements(m,[wager("red",{bet:{kind:"red",amount:10000}}),wager("black")],2,2,200);
 assert.equal(m.advancements!.streak,0);
});
test("one loss per round regardless of placements, duplicate and older rounds ignored",()=>{
 const m=setup().members[0];settleAdvancements(m,[wager(),wager("odd")],0,2,100);
 assert.equal(m.advancements!.streak,1);const saved=structuredClone(m);
 settleAdvancements(m,[wager()],0,2,200);settleAdvancements(m,[wager()],1,1,200);
 assert.deepEqual(m,saved);
});
test("no bets, other users, non-even-money, fake and unknown chip denominations pause streak",()=>{
 const m=setup().members[0];settleAdvancements(m,[wager()],0,1,100);
 const saved=structuredClone(m);
 for(const bets of [[],[wager("straight")],[wager("dozen")],[wager("column")],[wager("red",{dead:true})],[wager("red",{bet:{kind:"red",amount:300}})],[wager("red",{userId:"b"})]])settleAdvancements(m,bets,0,2,200);
 assert.deepEqual(m,saved);
 // A fake winning black bet cannot reset a real red loss.
 settleAdvancements(m,[wager(),wager("black",{dead:true})],2,3,300);
 assert.equal(m.advancements!.streak,2);
});
test("nonqualifying winning wager cannot reset a qualifying loss; clean default view is detached",()=>{
 const m=setup().members[0];settleAdvancements(m,[wager(),wager("straight",{bet:{kind:"straight",pick:0,amount:100}})],0,1,100);
 assert.equal(m.advancements!.streak,1);
 const view=advancementView(m);view.unlocked["14"]=123;assert.equal(m.advancements!.unlocked["14"],undefined);
 assert.deepEqual(advancementView(),{streak:0,lastRound:0,unlocked:{}});
});
test("engine settlement is atomic, no unlock or streak leak before result animation end, survives reload",()=>{
 let r=setup();rouletteState(r,1000);
 r.members[0].advancements={streak:6,lastRound:0,unlocked:{}};
 rouletteAction(r,who,{type:"bet",bet:{kind:"red",amount:100}},1,"bet",1000);
 rouletteTick(r,61000,()=>0);
 assert.equal(publicRoom(r,who).advancements.streak,6);
 assert.deepEqual(publicRoom(r,who).advancements.unlocked,{});
 r=JSON.parse(JSON.stringify(r));rouletteTick(r,77999,()=>1);assert.equal(r.members[0].advancements!.streak,6);
 rouletteTick(r,78000,()=>1);assert.equal(r.members[0].advancements!.streak,7);
 assert.deepEqual(r.members[0].advancements!.unlocked,{"7":73000});
 assert.deepEqual(publicRoom(r,other).advancements.unlocked,{});
 const saved=structuredClone(r);rouletteTick(r,78001,()=>1);assert.deepEqual(r,saved);assertRoom(r);
});
test("cancelled bets do not count",()=>{const r=setup();rouletteState(r,1000);rouletteAction(r,who,{type:"bet",bet:{kind:"red",amount:100}},1,"bet",1000);rouletteAction(r,who,{type:"cancel",betId:"bet"},1,"cancel",1001);rouletteTick(r,61000,()=>0);rouletteTick(r,78000,()=>0);assert.equal(r.members[0].advancements,undefined);});
test("repeat thresholds increment counts once per new streak; first reward only with durable audit and conserved issuance",()=>{
 const r=setup(),m=r.members[0],rewards={7:2500};
 for(let round=1;round<=7;round++)settleAdvancements(m,[wager()],0,round,round*100,r,rewards);
 assert.equal(m.advancements!.counts![7],1);assert.equal(m.wallet,102500);assert.equal(r.issuance,2500);assert.equal(m.adjustments,2500);
 assert.equal(r.auditPending!.length,1);assert.equal(r.auditPending![0].what,"advancement-first-reward");
 settleAdvancements(m,[wager()],0,7,800,r,rewards);assert.equal(m.wallet,102500);
 settleAdvancements(m,[wager()],0,8,800,r,rewards);assert.equal(m.advancements!.counts![7],1);
 settleAdvancements(m,[wager()],1,9,900,r,rewards);
 for(let round=10;round<=16;round++)settleAdvancements(m,[wager()],0,round,round*100,r,rewards);
 assert.equal(m.advancements!.counts![7],2);assert.equal(m.wallet,102500);assert.equal(r.auditPending!.filter(e=>(e.new as {tier:number}).tier===7).length,1);
 assert.equal(m.advancements!.unlocked[7],700);assert.equal(m.advancements!.rewarded![7],2500);assertRoom(r);
});
test("approved first-unlock rewards pay exactly once at every tier",async()=>{
 const {ADVANCEMENT_REWARDS_CENTS}=await import("../lib/advancements-shared");
 assert.deepEqual(ADVANCEMENT_REWARDS_CENTS,{7:10000,8:10000,9:20000,10:20000,11:25000,12:25000,13:50000,14:50000});
 const r=setup(),m=r.members[0];let expected=100000;
 for(let round=1;round<=14;round++){
  settleAdvancements(m,[wager()],0,round,round*100,r);
  expected+=(ADVANCEMENT_REWARDS_CENTS as Record<number,number>)[round]??0;assert.equal(m.wallet,expected);assertRoom(r);
 }
 const wallet=m.wallet;
 settleAdvancements(m,[wager()],1,15,1500,r);
 for(let round=16;round<=29;round++)settleAdvancements(m,[wager()],0,round,round*100,r);
 assert.equal(m.wallet,wallet);assert.equal(r.auditPending!.length,8);
 for(const a of ADVANCEMENTS)assert.equal(m.advancements!.counts![a.tier],2);
 assertRoom(r);
});
