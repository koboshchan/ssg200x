import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {freshRoom,register,assertRoom,totalChips} from "../lib/poker";
import {applyDoudizhu,publicDoudizhu,tickDoudizhu,doudizhuNeedsTick,DOUDIZHU_IDLE_MS,type DoudizhuInput} from "../lib/doudizhu";
const users=Array.from({length:3},(_,i)=>({id:"idle-"+i,name:"Idle "+i,email:"qa@invalid.test",admin:false}));
function setup(isPublic=false){const r=freshRoom();users.forEach(u=>register(r,u,0));move(r,0,{type:"create",isPublic});return r;}
function move(r:ReturnType<typeof freshRoom>,i:number,parts:Partial<DoudizhuInput>,now=1000){const g=r.doudizhu?.[0];applyDoudizhu(r,users[i],{type:"ready",requestId:randomUUID(),requestAt:now,version:g?.version,...parts},now);assertRoom(r);}
for(const isPublic of [false,true]){
 test("idle refunds and removes "+(isPublic?"public":"private")+" room exactly once",()=>{
  const r=setup(isPublic),g=r.doudizhu![0];move(r,1,{type:"join",code:g.code},2000);
  assert.equal(g.idleDeadline,1000+DOUDIZHU_IDLE_MS);
  assert.equal(publicDoudizhu(r,users[0]).room!.idleDeadline,g.idleDeadline);
  assert(!doudizhuNeedsTick(r,g.idleDeadline!-1));assert(!tickDoudizhu(r,g.idleDeadline!-1));
  assert(doudizhuNeedsTick(r,g.idleDeadline!));assert(tickDoudizhu(r,g.idleDeadline!));
  assert.equal(r.doudizhu!.length,0);assert(r.members.every(m=>m.wallet===100000));
  assertRoom(r);assert.equal(totalChips(r),300000);
  const snapshot=structuredClone(r);assert(!tickDoudizhu(r,9999999));assert.deepEqual(r,snapshot);
  assert.equal(r.auditPending!.filter(a=>a.what==="doudizhu.idle_cleanup").length,1);
 });
 test("last voluntary departure removes "+(isPublic?"public":"private")+" room",()=>{
  const r=setup(isPublic);move(r,0,{type:"leave"});assert.equal(r.doudizhu!.length,0);assert.equal(r.members[0].wallet,100000);
 });
}
test("joins, reactions and visibility never extend the nobody-ready baseline",()=>{
 const r=setup(),g=r.doudizhu![0],deadline=g.idleDeadline;
 move(r,1,{type:"join",code:g.code},2000);move(r,0,{type:"visibility",isPublic:true},3000);
 move(r,0,{type:"reaction",kind:"emote",value:"laugh"},4000);
 assert.equal(g.idleDeadline,deadline);
});
test("a ready player exempts room indefinitely; departure starts a fresh continuous interval",()=>{
 const r=setup(),g=r.doudizhu![0];move(r,1,{type:"join",code:g.code});
 move(r,0,{type:"ready"},2000);assert.equal(g.idleDeadline,undefined);
 assert(!doudizhuNeedsTick(r,999999));assert(!tickDoudizhu(r,999999));
 move(r,0,{type:"leave"},1000000);assert.equal(g.idleDeadline,1000000+DOUDIZHU_IDLE_MS);
 assert(!tickDoudizhu(r,g.idleDeadline!-1));assert(tickDoudizhu(r,g.idleDeadline!));assertRoom(r);
});
test("legacy waiting and finished rooms get a persisted full grace interval",()=>{
 for(const phase of ["waiting","finished"] as const){
  let r=setup(),g=r.doudizhu![0];g.phase=phase;delete g.idleDeadline;
  assert(doudizhuNeedsTick(r,999999));assert(tickDoudizhu(r,999999));
  assert.equal(g.idleDeadline,999999+DOUDIZHU_IDLE_MS);
  r=structuredClone(r);g=r.doudizhu![0];assert(!tickDoudizhu(r,g.idleDeadline!-1));
  assert(tickDoudizhu(r,g.idleDeadline!));assert.equal(r.members[0].wallet,100000);assertRoom(r);
 }
});
test("all active phases ignore an expired idle timer without refunding reserves",()=>{
 for(const phase of ["bidding","doubling","playing"] as const){
  const r=setup(),g=r.doudizhu![0];g.phase=phase;g.idleDeadline=1;g.deadline=9999999;
  const wallet=r.members[0].wallet;assert(tickDoudizhu(r,500000));assert.equal(g.idleDeadline,undefined);
  assert.equal(g.players[0].escrow,10000);assert.equal(r.members[0].wallet,wallet);
  assert.equal(r.doudizhu!.length,1);assert(!doudizhuNeedsTick(r,500000));assertRoom(r);
 }
});
test("settlement starts a new five-minute interval, with no extra debit on expiry",()=>{
 const r=setup(),g=r.doudizhu![0];for(let i=1;i<3;i++)move(r,i,{type:"join",code:g.code});
 for(let i=0;i<3;i++)move(r,i,{type:"ready"});
 move(r,0,{type:"bid",bid:3});for(let i=0;i<3;i++)move(r,i,{type:"double",doubleMultiplier:1});
 g.players[0].hand=["3s"];move(r,0,{type:"play",cards:["3s"]},2000);
 assert.equal(g.phase,"finished");assert.equal(g.idleDeadline,2000+DOUDIZHU_IDLE_MS);
 const wallets=r.members.map(m=>m.wallet);
 assert(tickDoudizhu(r,g.idleDeadline!));assert.deepEqual(r.members.map(m=>m.wallet),wallets);assertRoom(r);
});
test("persisted empty rooms are removed safely even with a stray active phase",()=>{
 const r=setup(),g=r.doudizhu![0];move(r,0,{type:"leave"});
 g.players=[];g.phase="playing";r.doudizhu=[g];
 assert(doudizhuNeedsTick(r,2000));assert(tickDoudizhu(r,2000));assert.equal(r.doudizhu.length,0);assertRoom(r);
});
