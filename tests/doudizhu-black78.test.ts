import {test} from "node:test";
import assert from "node:assert/strict";
import {isBlack78} from "../lib/black78";
import {classify,beats,rocketPlays,comboLabel} from "../lib/doudizhu-rules";
import {freshRoom,register,assertRoom} from "../lib/poker";
import {applyDoudizhu,tickDoudizhu,type DoudizhuInput} from "../lib/doudizhu";
import {randomUUID} from "node:crypto";
test("Black 78 reuses the house definition for every suit/order; red, duplicates and attachments are not rockets",()=>{
 for(const a of ["7s","7c"])for(const b of ["8s","8c"])for(const cards of [[a,b],[b,a]]){
  assert(isBlack78(cards));const c=classify(cards)!;assert.equal(c.kind,"rocket");assert.equal(c.special,"black78");assert.equal(comboLabel(c),"Black 78");
  for(const previous of [["2s"],["2s","2h","2d","2c"]])assert(beats(c,classify(previous)!));
  assert(!beats(c,classify(["X","Y"])!));assert(!beats(classify(["X","Y"])!,c));
 }
 for(const cards of [["7h","8s"],["7s","8d"],["7s","7c"],["7s","7s"],["7s","8s","3s"]])assert.notEqual(classify(cards)?.kind,"rocket");
 assert.equal(rocketPlays(["7s","7c","8s","8c","X","Y"]).length,5);
 assert.equal(rocketPlays(["7s","8c"],classify(["X","Y"])).length,0);
});
test("server validates Black 78 from owned cards, doubles once and reaches gated settlement",()=>{
 const r=freshRoom(),now=10000,users=Array.from({length:3},(_,i)=>({id:"b78-"+i,name:"P"+i,email:"p@invalid",admin:false}));
 users.forEach(u=>register(r,u,now));const move=(seat:number,data:Partial<DoudizhuInput>)=>{const input={type:"ready",requestId:randomUUID(),requestAt:now,version:r.doudizhu?.[0]?.version,...data} as DoudizhuInput;applyDoudizhu(r,users[seat],input,now);return input;};
 move(0,{type:"create"});const g=r.doudizhu![0];for(let i=1;i<3;i++)move(i,{type:"join",code:g.code});for(let i=0;i<3;i++)move(i,{type:"ready"});move(0,{type:"bid",bid:3});for(let i=0;i<3;i++)move(i,{type:"double",doubleMultiplier:1});
 g.players[0].hand=["7s","8c"];for(const p of g.players.slice(1))p.hand=p.hand.filter(c=>c!=="7s"&&c!=="8c");
 assert.throws(()=>move(0,{type:"play",cards:["7c","8s"]}),/not in your hand/);
 g.trick={cards:["2s","2h","2d","2c"],combo:classify(["2s","2h","2d","2c"])!,seat:1};
 const req=move(0,{type:"play",cards:["7s","8c"]});assert.equal(g.multiplier,2);assert.equal(g.trick!.combo.special,"black78");assert.equal(g.phase,"revealing");
 applyDoudizhu(r,users[0],req,now);assert.equal(g.multiplier,2);
 tickDoudizhu(r,now+5000);assert.equal(g.multiplier,4);assert.equal(g.phase,"finished");assertRoom(r);
});
