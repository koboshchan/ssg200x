import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {freshRoom,register,assertRoom,totalChips} from "../lib/poker";
import {applyPokerTableAction,pokerTableRoom} from "../lib/poker-tables";
import {applyDoudizhu,doudizhuAssets} from "../lib/doudizhu";
import {publicRoom} from "../lib/public";
import {leaderboardSnapshot} from "../lib/leaderboard";

test("Dou Dizhu reserves and all three poker tables share one conserved ledger and net-worth projection",()=>{
 const r=freshRoom(),now=Date.now();
 const users=Array.from({length:6},(_,i)=>({id:"mixed-"+i,name:"Mixed "+i,email:"qa@invalid",admin:i===0}));
 users.forEach(u=>register(r,u,now));
 for(const [i,id] of (["01","02","03"] as const).entries()){
  const t=pokerTableRoom(r,id);
  applyPokerTableAction(r,id,users[i],{type:"join",seat:0,buyIn:20000},t.handNumber,t.deadline,now);
  applyDoudizhu(r,users[i],{type:"create",beansPerDollar:1000,maxLoss:12800,requestId:randomUUID(),requestAt:now},now);
  assertRoom(r);
 }
 assert.equal(totalChips(r),600000);
 assert.equal(doudizhuAssets(r),38400);
 for(const id of ["01","02","03"] as const){
  const view=publicRoom(r,users[0],id);
  assert(view.leaderboard.every(m=>m.netWorth===100000));
  assert(view.adminUsers.every(m=>m.netWorth===100000));
 }
 assert(leaderboardSnapshot(r).rows.every(m=>m.netWorth===100000));
 for(const [i,id] of (["01","02","03"] as const).entries()){
  const t=pokerTableRoom(r,id);
  applyPokerTableAction(r,id,users[i],{type:"leave"},t.handNumber,t.deadline,now);
  applyDoudizhu(r,users[i],{type:"leave",requestId:randomUUID(),requestAt:now},now);
  assertRoom(r);
 }
 assert(r.members.every(m=>m.wallet===100000));
});
test("the combined ledger rejects negative Dou Dizhu escrow alongside extra poker tables",()=>{
 const r=freshRoom(),now=Date.now(),u={id:"negative",name:"Negative",email:"qa@invalid",admin:false};
 register(r,u,now);
 const t=pokerTableRoom(r,"02");
 applyPokerTableAction(r,"02",u,{type:"join",seat:0,buyIn:20000},t.handNumber,t.deadline,now);
 applyDoudizhu(r,u,{type:"create",requestId:randomUUID(),requestAt:now},now);
 r.doudizhu![0].players[0].escrow=-1;
 assert.throws(()=>assertRoom(r),/Invalid chip ledger/);
});
