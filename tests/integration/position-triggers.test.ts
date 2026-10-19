import {test,after} from "node:test";
import assert from "node:assert/strict";
import {db,closeDatabase,readRoom} from "../../lib/db";
import {mutate} from "../../lib/store";
import {register,assertRoom} from "../../lib/poker";
import {openPosition} from "../../lib/finance";
import {editPositionTriggers,settleTriggers} from "../../lib/position-triggers";
import {publicRoom} from "../../lib/public";
if(!process.env.MONGODB_DB?.startsWith("fakebucks_test_"))throw new Error("Requires isolated test DB");
process.env.MONGODB_DB+="_position_triggers";
after(async()=>{await(await db()).dropDatabase();await closeDatabase();});
test("Mongo persisted TP/SL survive connection restart, tick without clients, CAS settles once and keeps activity private",async()=>{
 const who={id:"tp",name:"TP",email:"tp@test",admin:false},other={id:"other",name:"Other",email:"other@test",admin:false},now=Date.now();
 await mutate(r=>{register(r,who);register(r,other);r.quotes={BTC:{micro:100000000,at:now}};openPosition(r,who,"BTC","long",10000,10,"long",now);editPositionTriggers(r,who,"long",{takeProfit:105000000,stopLoss:95000000});});
 await closeDatabase();
 const restarted=await readRoom();assert.equal((restarted.members[0].positions![0] as {takeProfit?:number}).takeProfit,105000000);
 await Promise.all([mutate(r=>{r.quotes={BTC:{micro:106000000,at:now+1}};settleTriggers(r,now+1);}),mutate(r=>{r.quotes={BTC:{micro:106000000,at:now+1}};settleTriggers(r,now+1);})]);
 const settled=await readRoom();assert.equal(settled.members[0].positions!.length,0);assert.equal(settled.members[0].wallet,106000);assert.equal(settled.house,-6000);assert.equal(settled.members[0].activity!.length,1);assert.match(publicRoom(settled,who).activity[0],/Take-profit/);assert.deepEqual(publicRoom(settled,other).activity,[]);assertRoom(settled);
});
for(const side of ["long","short"] as const)for(const leverage of [2,200])test(`real Mongo roundtrip omitted API triggers ${side} ${leverage}x stay open, legacy null safe, valid crossings settle once`,async()=>{
 const who={id:`omitted-${side}-${leverage}`,name:"Omitted",email:"omitted@test",admin:false},now=Date.now(),entry=100_000_000_000;
 const id=who.id,direction=side==="long"?1:-1;
 await mutate(r=>{
  register(r,who);r.maintenance=0;r.quotes={BTC:{micro:entry,at:now}};
  openPosition(r,who,"BTC",side,1000,leverage,id,now,{takeProfit:undefined,stopLoss:undefined});
  const wallet=r.members.find(m=>m.id===who.id)!.wallet;
  for(const key of ["takeProfit","stopLoss"] as const){
   assert.throws(()=>openPosition(r,who,"BTC",side,1000,leverage,id+"-bad",now,{[key]:0}));
   assert.equal(r.members.find(m=>m.id===who.id)!.wallet,wallet);
  }
 });
 await closeDatabase();
 let state=await readRoom(),member=state.members.find(m=>m.id===who.id)!;
 assert.equal(Object.hasOwn(member.positions![0],"takeProfit"),false);
 assert.equal(Object.hasOwn(member.positions![0],"stopLoss"),false);
 for(const [i,mark] of [entry,entry+direction*50_000_000,entry-direction*50_000_000].entries()){
  await mutate(r=>{r.quotes={BTC:{micro:mark,at:now+i+1}};settleTriggers(r,now+i+1);});
  state=await readRoom();member=state.members.find(m=>m.id===who.id)!;
  assert.equal(member.positions!.length,1);assert.equal(member.wallet,99000);assert.deepEqual(member.closedPositions,[]);
 }
 // Persist old API shape explicitly through the real driver to exercise historical null data.
 await mutate(r=>{const p=r.members.find(m=>m.id===who.id)!.positions![0];Object.assign(p,{takeProfit:undefined,stopLoss:undefined});});
 await closeDatabase();state=await readRoom();member=state.members.find(m=>m.id===who.id)!;
 assert.equal(member.positions![0].takeProfit,null);assert.equal(member.positions![0].stopLoss,null);
 await mutate(r=>{r.quotes={BTC:{micro:entry,at:now+4}};settleTriggers(r,now+4);});
 assert.equal((await readRoom()).members.find(m=>m.id===who.id)!.positions!.length,1);
 await mutate(r=>{editPositionTriggers(r,who,id,{takeProfit:entry+direction*100_000_000,stopLoss:entry-direction*100_000_000});});
 await closeDatabase();
 await Promise.all([0,1].map(()=>mutate(r=>{r.quotes={BTC:{micro:entry+direction*100_000_000,at:now+5}};settleTriggers(r,now+5);})));
 state=await readRoom();member=state.members.find(m=>m.id===who.id)!;
 assert.equal(member.positions!.length,0);assert.equal(member.closedPositions!.length,1);
 assert.equal(member.closedPositions![0].reason,"TP");assert.equal(member.closedPositions![0].realizedPnl,leverage);assertRoom(state);
});
