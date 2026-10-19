import {test,after} from "node:test";
import assert from "node:assert/strict";
import {db,closeDatabase,readRoom} from "../../lib/db";
import {mutate} from "../../lib/store";
import {register,assertRoom} from "../../lib/poker";
import {requireQuote,openPosition} from "../../lib/finance";
import {editPositionTriggers} from "../../lib/position-triggers";
import {publicRoom} from "../../lib/public";
import {setTradingSettings,resolveTriggerInput} from "../../lib/trading-settings";
if(!process.env.MONGODB_DB?.startsWith("fakebucks_test_"))throw new Error("Requires isolated test DB");
process.env.MONGODB_DB+="_trading_settings";
after(async()=>{await(await db()).dropDatabase();await closeDatabase();});
test("per-user saved mode survives Mongo restart and CAS retries; open/edit convert against persisted entry",async()=>{
 const who={id:"settings-owner",name:"Owner",email:"owner@test",admin:false},other={...who,id:"other",name:"Other"};
 await mutate(r=>{register(r,who);register(r,other);});
 await Promise.all([mutate(r=>setTradingSettings(r,who,"pnl")),mutate(r=>setTradingSettings(r,other,"price"))]);
 await closeDatabase();
 let room=await readRoom();
 assert.equal(publicRoom(room,who).me.triggerInputMode,"pnl");
 assert.equal(publicRoom(room,other).me.triggerInputMode,"price");
 for(const side of ["long","short"] as const)for(const leverage of [2,200]){
  const id=side+leverage,now=Date.now();
  await mutate(r=>{
   const m=r.members.find(m=>m.id===who.id)!;
   r.quotes={BTC:{micro:100_000_000,at:now}};
   const triggers=resolveTriggerInput(m,{entry:requireQuote(r,"BTC",now),side,margin:1000,leverage},{triggerInputMode:"pnl",takeProfitPnl:500,stopLossPnl:100});
   openPosition(r,who,"BTC",side,1000,leverage,id,now,triggers as {takeProfit:number;stopLoss:number});
  });
  await closeDatabase();
  room=await readRoom();const p=room.members.find(m=>m.id===who.id)!.positions!.find(p=>p.id===id)!;
  const sign=side==="long"?1:-1;
  assert.equal(p.takeProfit,Math.round(p.entry*(1+sign*500/(1000*leverage))));
  assert.equal(p.stopLoss,Math.round(p.entry*(1-sign*100/(1000*leverage))));
  await mutate(r=>{
   const m=r.members.find(m=>m.id===who.id)!,position=m.positions!.find(p=>p.id===id)!;
   r.quotes={BTC:{micro:101_000_000,at:now}};
   editPositionTriggers(r,who,id,resolveTriggerInput(m,position,{takeProfitPnl:600,stopLossPnl:200}));
  });
  await closeDatabase();
  room=await readRoom();const edited=room.members.find(m=>m.id===who.id)!.positions!.find(p=>p.id===id)!;
  assert.equal(edited.takeProfit,Math.round(p.entry*(1+sign*600/(1000*leverage))));
  const before=JSON.stringify(room);
  await assert.rejects(()=>mutate(r=>editPositionTriggers(r,other,id,{takeProfit:null})));
  assert.equal(JSON.stringify(await readRoom()),before);
  await assert.rejects(()=>mutate(r=>{
   const m=r.members.find(m=>m.id===who.id)!,position=m.positions!.find(p=>p.id===id)!;
   editPositionTriggers(r,who,id,resolveTriggerInput(m,position,{stopLossPnl:1000}));
  }));
  assert.equal(JSON.stringify(await readRoom()),before);assertRoom(room);
 }
});
