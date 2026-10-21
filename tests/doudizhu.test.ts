import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {freshRoom,register,assertRoom,totalChips} from "../lib/poker";
import {settledBeansExact,applyDoudizhu,publicDoudizhu,tickDoudizhu,doudizhuAssets,type DoudizhuInput} from "../lib/doudizhu";
const users=Array.from({length:4},(_,i)=>({id:"person-"+i,name:"Player "+i,email:"secret"+i+"@test.invalid",admin:false}));
function setup(){const r=freshRoom();users.forEach(u=>register(r,u,0));return r;}
function move(r:ReturnType<typeof freshRoom>,i:number,parts:Partial<DoudizhuInput>,now=1000){const g=r.doudizhu?.find(g=>g.players.some(p=>p.userId===users[i].id));const input={type:"ready",requestId:randomUUID(),requestAt:now,version:g?.version,...parts} as DoudizhuInput;applyDoudizhu(r,users[i],input,now);assertRoom(r);return input;}
function started(){const r=setup();move(r,0,{type:"create",beansPerDollar:1000,maxLoss:12800});const code=r.doudizhu![0].code;move(r,1,{type:"join",code});move(r,2,{type:"join",code});for(let i=0;i<3;i++)move(r,i,{type:"ready"});return r;}
test("crypto three BIP39 words, reserve conservation, private views, refund waiting leave",()=>{
 const r=setup();move(r,0,{type:"create",beansPerDollar:1000,maxLoss:12800});const g=r.doudizhu![0];
 assert.equal(g.code.split(" ").length,3);assert.equal(users.length*100000,totalChips(r));assert.equal(doudizhuAssets(r),12800);
 assert.equal(publicDoudizhu(r,users[3],g.code).room,null);
 const view=JSON.stringify(publicDoudizhu(r,users[0]));assert(!view.includes("secret"));assert(!view.includes("person-"));
 move(r,0,{type:"leave"});assert.equal(r.members[0].wallet,100000);assert.equal(r.doudizhu!.length,0);
});
test("deal, all pass redeal, highest bid and own cards only",()=>{
 const r=started(),g=r.doudizhu![0],first=g.handId;
 assert.deepEqual(g.players.map(p=>p.hand.length),[17,17,17]);assert.equal(g.kitty.length,3);
 for(let i=0;i<3;i++)move(r,i,{type:"bid",bid:0});
 assert.notEqual(g.handId,first);assert.equal(g.phase,"bidding");
 move(r,0,{type:"bid",bid:3});assert.equal(g.landlord,0);assert.equal(g.players[0].hand.length,20);
 const view=publicDoudizhu(r,users[1]).room!;assert(!("hand" in view.players[0]));assert.equal(view.players[1].hand!.length,17);
});
test("malicious duplicate cards, stale version and duplicate request cannot charge twice",()=>{
 const r=started(),g=r.doudizhu![0];move(r,0,{type:"bid",bid:3});
 const before=structuredClone(r),card=g.players[0].hand[0];
 assert.throws(()=>move(r,0,{type:"play",cards:[card,card]}),/unique/);assert.deepEqual(r,before);
 assert.throws(()=>move(r,0,{type:"play",cards:[card],version:g.version-1}),/changed/);assert.deepEqual(r,before);
 const request=move(r,0,{type:"play",cards:[card]});const after=structuredClone(r);applyDoudizhu(r,users[0],request,1000);assert.deepEqual(r,after);
 assert.throws(()=>applyDoudizhu(r,users[1],request,1000),/Invalid request/);
});
test("two passes reset trick; timeout leads lowest single, pass on response",()=>{
 const r=started(),g=r.doudizhu![0];move(r,0,{type:"bid",bid:3});
 const smallest=[...g.players[0].hand].sort((a,b)=>a.localeCompare(b));
 assert(tickDoudizhu(r,61000));assert.equal(g.trick!.cards.length,1);assert.equal(g.turn,1);
 const led=g.trick!.cards[0];assert(smallest.includes(led));
 assert(tickDoudizhu(r,121000));assert.equal(g.turn,2);
 assert(tickDoudizhu(r,181000));assert.equal(g.turn,0);assert.equal(g.trick,null);assertRoom(r);
});
test("active leave retains full reserve, bots complete and settlement exactly once at cap",()=>{
 const r=started(),g=r.doudizhu![0];move(r,0,{type:"bid",bid:3});
 for(let i=0;i<3;i++)move(r,i,{type:"leave"});
 assert.equal(doudizhuAssets(r),38400);
 g.multiplier=1_000_000;
 for(let n=0;n<300&&g.phase!=="finished";n++){tickDoudizhu(r,2000+n);assertRoom(r);}
 assert.equal(g.phase,"finished");assert(g.settled);assert.equal(g.result!.unit,300000000);assert(g.result!.deltas.every(d=>d>=-12800));
 assert.equal(g.result!.deltas.reduce((a,b)=>a+b,0),0);assert.equal(doudizhuAssets(r),0);assert(r.members.every(m=>m.wallet>=0));
 const snapshot=structuredClone(r);for(let i=0;i<5;i++)tickDoudizhu(r,999999);assert.deepEqual(r,snapshot);
 assert.equal(r.auditPending!.filter(a=>a.what==="doudizhu.settlement").length,1);
});
test("invalid stakes fail before debiting and one room per person",()=>{
 for(const base of [-1,0,NaN,Infinity,0.5,1000001,Number.MAX_SAFE_INTEGER]){const r=setup();assert.throws(()=>move(r,0,{type:"create",beansPerDollar:base}));assert.equal(r.members[0].wallet,100000);}
 const r=setup();move(r,0,{type:"create",beansPerDollar:1000,maxLoss:12800});assert.throws(()=>move(r,0,{type:"create",beansPerDollar:1000,maxLoss:12800}),/existing room/);
});
test("beans default to 1000 per dollar and current admin max fences new rooms",()=>{
 const r=setup();r.doudizhuMaxBeansPerDollar=2000;
 assert.throws(()=>move(r,0,{type:"create",beansPerDollar:2001}),/maximum/);
 move(r,0,{type:"create"});const g=r.doudizhu![0];assert.equal(g.beansPerDollar,1000);assert.equal(g.maxLoss,10000);assert.equal(r.members[0].wallet,90000);
 const view=publicDoudizhu(r,users[0]);assert.equal(view.maxBeansPerDollar,2000);assert.equal(view.room!.beansPerDollar,1000);assert.equal(view.room!.maxLoss,10000);
});
test("losing landlord cap splits odd cent deterministically; winning landlord collects each farmer cap",()=>{
 for(const winner of [0,1]){
  const r=started(),g=r.doudizhu![0];move(r,0,{type:"bid",bid:3});
  // Make each locked reserve odd without changing conserved assets.
  for(const p of g.players){p.escrow=101;r.members.find(m=>m.id===p.userId)!.wallet+=12699;}
  g.maxLoss=101;g.multiplier=1000000;g.turn=winner;g.trick=null;g.players[winner].hand=["3s"];
  move(r,winner,{type:"play",cards:["3s"]});
  assert.deepEqual(g.result!.deltas,winner===0?[202,-101,-101]:[-101,51,50]);assertRoom(r);
 }
});
test("code preview discloses stake before joining without revealing players or hands",()=>{
 const r=started(),g=r.doudizhu![0];
 const preview=publicDoudizhu(r,users[3],g.code);
 assert.equal(preview.room,null);
 assert.deepEqual(preview.preview,{code:g.code,scoringMode:"beans",beansPerDollar:1000,baseBeans:1000,rate:undefined,maxLoss:12800,count:3,phase:"bidding"});
 assert(!JSON.stringify(preview).includes("Player 0"));
 assert.equal(doudizhuAssets(r,users[0].id),12800);
 assert.equal(doudizhuAssets(r,users[3].id),0);
});
test("bean conversion floors cents before caps, exposes actual bean deltas and preserves legacy rooms",()=>{
 for(const legacy of [false,true]){
  const r=started(),g=r.doudizhu![0];move(r,0,{type:"bid",bid:3});
  if(legacy){delete g.scoringMode;delete g.beansPerDollar;delete g.baseBeans;g.rate=5;g.base=500;}
  else g.beansPerDollar=3000;
  g.players[0].hand=["3s"];g.players[1].plays=1; // prevent spring
  move(r,0,{type:"play",cards:["3s"]});
  assert.equal(g.result!.unit,legacy?1500:100);
  assert.deepEqual(g.result!.deltas,legacy?[3000,-1500,-1500]:[200,-100,-100]);
  if(legacy){assert.equal(g.result!.beanDeltas,undefined);assert.equal(publicDoudizhu(r,users[0]).room!.scoringMode,"legacy-rate");}
  else{assert.equal(g.result!.unitBeans,3000);assert.deepEqual(g.result!.beanDeltas,[6000,-3000,-3000]);}
  assertRoom(r);
 }
 const r=started(),g=r.doudizhu![0];move(r,0,{type:"bid",bid:3});g.beansPerDollar=7000;g.players[0].hand=["3s"];g.players[1].plays=1;
 move(r,0,{type:"play",cards:["3s"]});assert.equal(g.result!.unit,42);assert.deepEqual(g.result!.beanDeltas,[5880,-2940,-2940]);assertRoom(r);
});
test("new rooms reject legacy rate requests and explicit conversion bound is enforced",()=>{
 const r=setup();assert.throws(()=>move(r,0,{type:"create",rate:5} as never),/beansPerDollar/);
 for(const beansPerDollar of [0,1.5,1000001,Infinity])assert.throws(()=>move(r,0,{type:"create",beansPerDollar}));
 r.doudizhuMaxBeansPerDollar=1000000000;move(r,0,{type:"create",beansPerDollar:1000000000});assert.equal(r.doudizhu![0].baseBeans,1000);
});

test("settled bean decimal strings remain exact beyond safe intermediate multiplication",()=>{
 assert.equal(settledBeansExact(99999999,999999999),"999999989000000.01");
 assert.equal(settledBeansExact(-99999999,999999999),"-999999989000000.01");
 assert.equal(settledBeansExact(200000000,1000000000),"2000000000000000");
 assert.equal(settledBeansExact(1,1001),"10.01");
 assert.equal(settledBeansExact(1,1010),"10.1");
 assert.equal(settledBeansExact(0,1000000000),"0");
});
