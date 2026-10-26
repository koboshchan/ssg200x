import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {freshRoom,register,assertRoom,totalChips} from "../lib/poker";
import {applyDoudizhu,publicDoudizhu,touchDoudizhuSpectator,DOUDIZHU_SPECTATOR_TTL,type DoudizhuInput} from "../lib/doudizhu";
const users=Array.from({length:5},(_,i)=>({id:"spectator-test-"+i,name:"Player "+i,email:"private-"+i+"@test.invalid",admin:false}));
function setup(){
 const r=freshRoom();users.forEach(u=>register(r,u));const now=Date.now();
 const move=(i:number,p:Partial<DoudizhuInput>,at=now)=>applyDoudizhu(r,users[i],{type:"ready",requestId:randomUUID(),requestAt:at,version:r.doudizhu?.[0]?.version,...p},at);
 move(0,{type:"create"});const g=r.doudizhu![0];move(1,{type:"join",code:g.code});move(2,{type:"join",code:g.code});
 for(let i=0;i<3;i++)move(i,{type:"ready"});return {r,g,now,move};
}
test("spectating a full active private room has no wallet effect; exact one-seat payload only",()=>{
 const {r,g,move}=setup(),wallets=r.members.map(m=>m.wallet),assets=totalChips(r);
 assert.equal(publicDoudizhu(r,users[3],g.code).room,null);
 const version=g.version;move(3,{type:"spectate",code:g.code});
 let view=publicDoudizhu(r,users[3]).room!;
 assert(view.spectating);assert.equal(view.watchSeat,null);assert(view.players.every(p=>!("hand" in p)));
 for(let seat=0;seat<3;seat++){
  move(3,{type:"watch",code:g.code,watchSeat:seat});view=publicDoudizhu(r,users[3]).room!;
  assert.deepEqual(view.players[seat].hand,g.players[seat].hand);
  assert(view.players.filter(p=>p.seat!==seat).every(p=>!("hand" in p)));
  assert(view.players.every(p=>!p.self));assert.equal(view.spectatorCount,1);
 }
 assert.equal(g.version,version);assert.equal(publicDoudizhu(r,users[0]).room!.spectatorCount,1);
 assert.deepEqual(r.members.map(m=>m.wallet),wallets);assert.equal(totalChips(r),assets);assertRoom(r);
 const wire=JSON.stringify(publicDoudizhu(r,users[3]));
 assert(!wire.includes("spectator-test"));assert(!wire.includes("@test.invalid"));assert(!wire.includes("seenAt"));
});
test("spectator cannot bid, act, double, ready, react, change visibility or join without normal checks",()=>{
 const {r,g,move}=setup();move(3,{type:"spectate",code:g.code});
 for(const parts of [{type:"bid",bid:3},{type:"play",cards:[g.players[0].hand[0]]},{type:"pass"},{type:"ready"},{type:"double",doubleMultiplier:4},{type:"reaction",kind:"emote",value:"hi"},{type:"visibility",isPublic:true}] as Partial<DoudizhuInput>[]){
  const before=structuredClone(r);assert.throws(()=>move(3,{code:g.code,...parts}),/Join this room first/);assert.deepEqual(r,before);
 }
 assert.throws(()=>move(3,{type:"join",code:g.code}),/full or started/);
 for(const seat of [-1,3,1.5,NaN])assert.throws(()=>move(3,{type:"watch",watchSeat:seat,code:g.code}),/seated player/);
 assert.throws(()=>move(4,{type:"watch",watchSeat:0,code:g.code}),/Spectate this room first/);
});
test("spectators still receive one hand only at reveal and finish; can leave mid-hand",()=>{
 const {r,g,move}=setup();move(3,{type:"spectate",code:g.code});move(3,{type:"watch",watchSeat:1});
 for(const phase of ["revealing","finished"] as const){g.phase=phase;const v=publicDoudizhu(r,users[3]).room!;assert.deepEqual(v.players[1].hand,g.players[1].hand);assert(!("hand" in v.players[0]));assert(!("hand" in v.players[2]));}
 g.phase="playing";const wallet=r.members[3].wallet;move(3,{type:"leave"});assert.equal(publicDoudizhu(r,users[3]).room,null);assert.equal(r.members[3].wallet,wallet);
});
test("heartbeat does not change turn version, expiry revokes access and excludes count",()=>{
 const {r,g,now,move}=setup();move(3,{type:"spectate",code:g.code});const version=g.version;
 touchDoudizhuSpectator(r,users[3].id,now+15_000);assert.equal(g.version,version);
 const expiredAt=Date.now();
 g.spectators![0].seenAt=expiredAt-DOUDIZHU_SPECTATOR_TTL;
 assert.equal(publicDoudizhu(r,users[3]).room,null);assert.equal(publicDoudizhu(r,users[0]).room!.spectatorCount,0);
 const expired=g.spectators![0].seenAt;touchDoudizhuSpectator(r,users[3].id,expiredAt);assert.equal(g.spectators![0].seenAt,expired);
 // Use the same observation clock, not setup()'s older move timestamp.
 assert.throws(()=>move(3,{type:"watch",watchSeat:0},expiredAt),/Room not found/);
});
test("switching rooms clears old membership and later joining reserves normally",()=>{
 const {r,g,move}=setup();g.phase="waiting";g.players.forEach(p=>{p.hand=[];p.ready=false;});
 move(2,{type:"leave"});move(3,{type:"spectate",code:g.code});
 const before=r.members[3].wallet;
 move(3,{type:"join",code:g.code});assert.equal(r.members[3].wallet,before-g.maxLoss);assert.equal(g.spectators?.length,0);assert(!publicDoudizhu(r,users[3]).room!.spectating);assertRoom(r);
});
