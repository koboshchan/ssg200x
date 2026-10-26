import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {freshRoom,register,assertRoom,totalChips} from "../lib/poker";
import {applyDoudizhu,publicDoudizhu,tickDoudizhu,doudizhuNeedsTick,type DoudizhuInput} from "../lib/doudizhu";
const users=Array.from({length:4},(_,i)=>({id:"double-"+i,name:"Player "+i,email:"test@invalid",admin:false}));
function setup(scaled=false){
 const r=freshRoom();users.forEach(u=>register(r,u,0));let now=10_000;
 const move=(seat:number,parts:Partial<DoudizhuInput>)=>{
  const input={type:"ready",requestId:randomUUID(),requestAt:now,version:r.doudizhu?.[0]?.version,...parts} as DoudizhuInput;
  applyDoudizhu(r,users[seat],input,now);if(r.doudizhu?.[0]?.phase==="revealing")tickDoudizhu(r,now+5000);assertRoom(r);return input;
 };
 move(0,{type:"create",beansPerDollar:1000,maxLoss:12800});const g=r.doudizhu![0];g.scaledDoubleCaps=scaled;
 move(1,{type:"join",code:g.code});move(2,{type:"join",code:g.code});
 for(let i=0;i<3;i++)move(i,{type:"ready"});move(0,{type:"bid",bid:3});
 return {r,g,move,time:(v:number)=>now=v};
}
test("post-landlord simultaneous choices, version fence and x1 timeout preserve already chosen x4",()=>{
 const {r,g,move}=setup();assert.equal(g.phase,"doubling");assert.equal(g.players[0].hand.length,20);
 assert.throws(()=>move(0,{type:"play",cards:[g.players[0].hand[0]]}),/Not playing/);
 assert.throws(()=>move(1,{type:"double",doubleMultiplier:3}),/x1/);
 assert.throws(()=>move(3,{type:"double",code:g.code,doubleMultiplier:2}),/Join/);
 assert.throws(()=>move(1,{type:"double",doubleMultiplier:2,version:g.version-1}),/changed/);
 const req=move(2,{type:"double",doubleMultiplier:4}),before=structuredClone(r);applyDoudizhu(r,users[2],req,10_000);assert.deepEqual(r,before);
 assert.throws(()=>move(2,{type:"double",doubleMultiplier:1}),/already/);
 assert(doudizhuNeedsTick(r,70_000));tickDoudizhu(r,70_000);
 assert.equal(g.phase,"playing");assert.equal(g.turn,0);assert.deepEqual(g.players.map(p=>p.doubleMultiplier),[1,1,4]);assert.equal(g.deadline,130_000);
 assertRoom(r);
});
test("all choices start play immediately and each deal resets choices",()=>{
 const {r,g,move}=setup();for(const i of [2,0,1])move(i,{type:"double",doubleMultiplier:i===0?4:2});
 assert.equal(g.phase,"playing");assert.equal(publicDoudizhu(r,users[0]).room!.players[0].doubleMultiplier,4);
 g.turn=0;g.players[0].hand=["3s"];move(0,{type:"play",cards:["3s"]});
 for(let i=0;i<3;i++)move(i,{type:"ready"});
 assert.equal(g.phase,"bidding");assert(g.players.every(p=>p.doubleMultiplier===1&&!p.doubleChosen));
});
test("pairwise claim multiplies before cent flooring, asymmetric proportional cap is exact and deterministic",()=>{
 for(const winner of [0,1])for(const cap of [101,12800]){
  const {r,g,move}=setup();g.beansPerDollar=7000;
  for(const [i,m] of [2,1,4].entries())move(i,{type:"double",doubleMultiplier:m});
  if(cap===101)for(const p of g.players){r.members.find(m=>m.id===p.userId)!.wallet+=p.escrow-cap;p.escrow=cap;}
  g.maxLoss=cap;g.turn=winner;g.players[winner].hand=["3s"];g.players[0].plays=2;g.players[1].plays=1;
  move(winner,{type:"play",cards:["3s"]});
  // Claims floor(3000 * 2 * farmerChoice *100 /7000) = 85 and 342.
  assert.deepEqual(g.result!.deltas,winner===0?(cap===101?[186,-85,-101]:[427,-85,-342]):cap===101?[-101,20,81]:[-427,85,342]);
  assert.equal(totalChips(r),400000);assertRoom(r);
 }
});
test("legacy active persisted games without doubling fields settle at x1",()=>{
 const {r,g,move}=setup();g.phase="playing";g.players.forEach(p=>{delete p.doubleMultiplier;delete p.doubleChosen;});
 g.players[0].hand=["3s"];g.players[1].plays=1;move(0,{type:"play",cards:["3s"]});
 assert.deepEqual(g.result!.deltas,[600,-300,-300]);assertRoom(r);
});
test("paid throws share admin prices, debit wallet to house atomically, retry never charges or animates twice",()=>{
 const {r,g,move}=setup();r.casinoLimits={rouletteMaxTotal:100000,blackjackMaxHand:100000,pokerMaxBuyIn:100000,pokerEggPrice:1200,pokerTomatoPrice:3400,gamesMaxBet:100000,revision:1};
 const view=publicDoudizhu(r,users[0]);assert.deepEqual(view.reactionPrices,{egg:1200,tomato:3400});
 const payload={type:"reaction" as const,kind:"throw" as const,value:"egg",target:1,targetId:r.members[1].publicId,expectedPrice:1200};
 const wallet=r.members[0].wallet,req=move(0,payload),snapshot=structuredClone(r);
 assert.equal(r.members[0].wallet,wallet-1200);assert.equal(r.house,1200);assert.equal(g.reactions!.length,1);
 applyDoudizhu(r,users[0],req,10000);assert.deepEqual(r,snapshot);
 assert.throws(()=>applyDoudizhu(r,users[0],{...req,value:"tomato"},10000),/Invalid request/);
 assert.throws(()=>applyDoudizhu(r,users[1],req,10000),/Invalid request/);
 assert.throws(()=>move(0,payload),/4 seconds/);assertRoom(r);assert.equal(totalChips(r),400000);
 assert.equal(r.auditPending!.filter(e=>e.what==="doudizhu.throw").length,1);
});
test("reaction membership, target identity, price, balance, cooldown, validation and privacy checks",()=>{
 const {r,g,move,time}=setup(),targetId=r.members[1].publicId;
 const payload={type:"reaction" as const,kind:"throw" as const,value:"tomato",target:1,targetId,expectedPrice:5000};
 for(const extra of [{target:0,targetId:r.members[0].publicId},{target:9},{targetId:"bad"},{value:"script"},{expectedPrice:1}]){
  const before=structuredClone(r);assert.throws(()=>move(0,{...payload,...extra}));assert.deepEqual(r,before);
 }
 assert.throws(()=>move(3,{...payload,code:g.code}),/Join/);
 const balance=r.members[0].wallet;r.members[0].wallet=0;assert.throws(()=>move(0,payload),/Not enough/);r.members[0].wallet=balance;
 const wallet=r.members[0].wallet;move(0,{type:"reaction",kind:"emote",value:"laugh"});assert.equal(r.members[0].wallet,wallet);
 assert.throws(()=>move(0,payload),/4 seconds/);time(14000);move(0,payload);
 r.members[2].accessRevoked=true;assert.throws(()=>move(2,{type:"reaction",kind:"emote",value:"nice"}),/Access denied/);
 assert.equal(publicDoudizhu(r,users[3],g.code).room,null);
 assert(!JSON.stringify(publicDoudizhu(r,users[0])).includes("double-"));
});
test("all combinations of multipliers conserve chips with either side winning and capped reserves",()=>{
 for(const a of [1,2,4])for(const b of [1,2,4])for(const c of [1,2,4])for(const winner of [0,1]){
  const {r,g,move}=setup();[a,b,c].forEach((m,i)=>move(i,{type:"double",doubleMultiplier:m}));
  g.multiplier=1000000;g.turn=winner;g.players[winner].hand=["3s"];move(winner,{type:"play",cards:["3s"]});
  assert.equal(g.result!.deltas.reduce((a,b)=>a+b,0),0);assert(g.result!.deltas.every(v=>v>=-12800));
  assert.equal(totalChips(r),400000);assertRoom(r);
 }
});

test("new rooms fund pairwise scaled caps, reject unaffordable choices without partial debits, replay once",()=>{
 const {r,g,move}=setup(true);g.maxLoss=1000;
 const original=totalChips(r),wallets=r.members.map(m=>m.wallet),reserves=g.players.map(p=>p.escrow);
 // Restore initial reserve to the new fixture cap without minting chips.
 g.players.forEach((p,i)=>{r.members[i].wallet+=p.escrow-1000;p.escrow=1000;});
 assert.equal(publicDoudizhu(r,users[0]).room!.doubleOptions.find(o=>o.multiplier===4)!.reserve,4000);
 const req=move(0,{type:"double",doubleMultiplier:4});assert.deepEqual(g.players.map(p=>p.escrow),[4000,4000,4000]);
 const after=structuredClone(r);applyDoudizhu(r,users[0],req,10000);assert.deepEqual(r,after);
 const old=r.members[0].wallet;r.members[0].wallet=0;
 assert.equal(publicDoudizhu(r,users[1]).room!.doubleOptions.find(o=>o.multiplier===4)!.available,false);
 const snapshot=structuredClone(r);assert.throws(()=>move(1,{type:"double",doubleMultiplier:4}),/increased maximum-loss/);assert.deepEqual(r,snapshot);
 r.members[0].wallet=old;move(1,{type:"double",doubleMultiplier:4});move(2,{type:"double",doubleMultiplier:2});
 assert.deepEqual(g.players.map(p=>p.escrow),[16000,16000,8000]);assert.equal(totalChips(r),original);
 g.multiplier=1000000;g.players[0].hand=["3s"];move(0,{type:"play",cards:["3s"]});
 assert.deepEqual(g.result!.deltas,[24000,-16000,-8000]);assert(g.players.every(p=>p.escrow===0));assert.equal(totalChips(r),original);
 const settled=structuredClone(r);tickDoudizhu(r,15000);assert.deepEqual(r,settled);assertRoom(r);
});
test("scaled landlord loss uses highest opposing choice and refunds unused reserves exactly once",()=>{
 const {r,g,move}=setup(true);const total=totalChips(r);g.maxLoss=1000;
 g.players.forEach((p,i)=>{r.members[i].wallet+=p.escrow-1000;p.escrow=1000;});
 [2,4,1].forEach((m,i)=>move(i,{type:"double",doubleMultiplier:m}));
 assert.deepEqual(g.players.map(p=>p.escrow),[8000,8000,2000]);
 g.multiplier=1000000;g.turn=1;g.players[1].hand=["3s"];move(1,{type:"play",cards:["3s"]});
 assert.deepEqual(g.result!.deltas,[-8000,6400,1600]);assert.equal(totalChips(r),total);
 for(let i=0;i<3;i++)move(i,{type:"ready"});assert.deepEqual(g.players.map(p=>p.escrow),[1000,1000,1000]);assertRoom(r);
});
test("timeout keeps funded caps and no-double remains available without further balance",()=>{
 const {r,g,move}=setup(true);g.maxLoss=1000;g.players.forEach((p,i)=>{r.members[i].wallet+=p.escrow-1000;p.escrow=1000;});
 move(1,{type:"double",doubleMultiplier:4});const funded=g.players.map(p=>p.escrow),wallets=r.members.map(m=>m.wallet);
 tickDoudizhu(r,70000);assert.equal(g.phase,"playing");assert.deepEqual(g.players.map(p=>p.escrow),funded);assert.deepEqual(r.members.map(m=>m.wallet),wallets);assertRoom(r);
});
test("every scaled choice combination settles within funded exposure, zero-sum for either winning side",()=>{
 for(const a of [1,2,4])for(const b of [1,2,4])for(const c of [1,2,4])for(const winner of [0,1]){
  const {r,g,move}=setup(true);g.maxLoss=1000;
  g.players.forEach((p,i)=>{r.members[i].wallet+=p.escrow-1000;p.escrow=1000;});
  [a,b,c].forEach((m,i)=>move(i,{type:"double",doubleMultiplier:m}));
  const funded=[1000*a*Math.max(b,c),1000*a*b,1000*a*c];assert.deepEqual(g.players.map(p=>p.escrow),funded);
  g.multiplier=1000000;g.turn=winner;g.players[winner].hand=["3s"];move(winner,{type:"play",cards:["3s"]});
  assert(g.result!.deltas.every((v,i)=>v>=-funded[i]));assert.equal(g.result!.deltas.reduce((a,b)=>a+b,0),0);assert.equal(totalChips(r),400000);assertRoom(r);
 }
});
