import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {freshRoom,register,assertRoom,totalChips} from "../lib/poker";
import {applyDoudizhu,publicDoudizhu,tickDoudizhu,doudizhuAssets,type DoudizhuInput} from "../lib/doudizhu";
const users=Array.from({length:4},(_,i)=>({id:"person-"+i,name:"Player "+i,email:"secret"+i+"@test.invalid",admin:false}));
function setup(){const r=freshRoom();users.forEach(u=>register(r,u,0));return r;}
function move(r:ReturnType<typeof freshRoom>,i:number,parts:Partial<DoudizhuInput>,now=1000){const g=r.doudizhu?.find(g=>g.players.some(p=>p.userId===users[i].id));const input={type:"ready",requestId:randomUUID(),requestAt:now,version:g?.version,...parts} as DoudizhuInput;applyDoudizhu(r,users[i],input,now);assertRoom(r);return input;}
function started(){const r=setup();move(r,0,{type:"create",base:100});const code=r.doudizhu![0].code;move(r,1,{type:"join",code});move(r,2,{type:"join",code});for(let i=0;i<3;i++)move(r,i,{type:"ready"});return r;}
test("crypto three BIP39 words, reserve conservation, private views, refund waiting leave",()=>{
 const r=setup();move(r,0,{type:"create",base:100});const g=r.doudizhu![0];
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
 assert.equal(g.phase,"finished");assert(g.settled);assert.equal(g.result!.unit,6400);
 assert.equal(g.result!.deltas.reduce((a,b)=>a+b,0),0);assert.equal(doudizhuAssets(r),0);assert(r.members.every(m=>m.wallet>=0));
 const snapshot=structuredClone(r);for(let i=0;i<5;i++)tickDoudizhu(r,999999);assert.deepEqual(r,snapshot);
 assert.equal(r.auditPending!.filter(a=>a.what==="doudizhu.settlement").length,1);
});
test("invalid stakes fail before debiting and one room per person",()=>{
 for(const base of [-1,0,NaN,Infinity,0.5,100001,Number.MAX_SAFE_INTEGER]){const r=setup();assert.throws(()=>move(r,0,{type:"create",base}));assert.equal(r.members[0].wallet,100000);}
 const r=setup();move(r,0,{type:"create",base:100});assert.throws(()=>move(r,0,{type:"create",base:100}),/existing room/);
});
