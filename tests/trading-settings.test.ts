import {test} from "node:test";
import assert from "node:assert/strict";
import {freshRoom,register,assertRoom} from "./helpers/crypto-room";
import {openPosition,liqPrice} from "../lib/finance";
import {editPositionTriggers} from "../lib/position-triggers";
import {triggerInputMode,setTradingSettings,resolveTriggerInput,skipCloseConfirmation,setCloseConfirmation} from "../lib/trading-settings";
import {pnlTriggerPrice} from "../lib/trigger-input";
import {publicRoom} from "../lib/public";
import {mergeMarket} from "../lib/room-sync";
const who={id:"settings-owner",name:"Owner",email:"settings@test",admin:false};
for(const side of ["long","short"] as const)for(const leverage of [2,200]){
 test(`${side} ${leverage}x converts $5 profit/$1 loss, open/edit use entry basis`,()=>{
  const r=freshRoom(),member=register(r,who),entry=100_000_000;
  setTradingSettings(r,who,"pnl");
  r.quotes={BTC:{cryptoGeneration:"fixture",micro:entry,at:1000}};
  const basis={entry,margin:1000,leverage,side};
  const triggers=resolveTriggerInput(member,basis,{takeProfitPnl:500,stopLossPnl:100});
  const direction=side==="long"?1:-1;
  assert.equal(triggers.takeProfit,Math.round(entry*(1+direction*500/(1000*leverage))));
  assert.equal(triggers.stopLoss,Math.round(entry*(1-direction*100/(1000*leverage))));
  openPosition(r,who,"BTC",side,1000,leverage,"position",1000,triggers as {takeProfit:number;stopLoss:number});
  const p=member.positions![0];assert.equal(p.takeProfit,triggers.takeProfit);
  r.quotes.BTC!.micro=entry+1_000_000;
  editPositionTriggers(r,who,p.id,resolveTriggerInput(member,p,{takeProfitPnl:600,stopLossPnl:200}));
  assert.equal(p.takeProfit,pnlTriggerPrice(p,600,"takeProfit"));
  assert.equal(p.stopLoss,pnlTriggerPrice(p,200,"stopLoss"));
  const saved={...p};
  for(const loss of [1000,1100])assert.throws(()=>editPositionTriggers(r,who,p.id,resolveTriggerInput(member,p,{stopLossPnl:loss})));
  assert.deepEqual(p,saved);
  assert.ok(side==="long"?p.stopLoss!>liqPrice(p):p.stopLoss!<liqPrice(p));
  editPositionTriggers(r,who,p.id,resolveTriggerInput(member,p,{takeProfitPnl:null,stopLossPnl:null}));
  assert.equal(p.takeProfit,undefined);assert.equal(p.stopLoss,undefined);assertRoom(r);
 });
}
test("conversion exact rounding, positive integer inputs, unreachable/zero prices",()=>{
 const p={entry:101,margin:100,leverage:2,side:"long" as const};
 assert.equal(pnlTriggerPrice(p,1,"takeProfit"),102);
 assert.equal(pnlTriggerPrice(p,1,"stopLoss"),100);
 for(const amount of [0,-1,1.1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>pnlTriggerPrice(p,amount,"takeProfit"));
 assert.throws(()=>pnlTriggerPrice(p,200,"stopLoss"));
 assert.throws(()=>pnlTriggerPrice({...p,side:"short"},200,"takeProfit"));
 const tiny={...p,entry:1,margin:1000000};
 // A rounded unchanged price is rejected by existing trigger validation, not silently accepted.
 const r=freshRoom(),m=register(r,who);setTradingSettings(r,who,"pnl");r.quotes={BTC:{cryptoGeneration:"fixture",micro:1,at:1000}};
 assert.throws(()=>openPosition(r,who,"BTC","long",1000,2,"tiny",1000,resolveTriggerInput(m,tiny,{takeProfitPnl:1}) as {takeProfit:number}));
 assert.equal(m.wallet,100000);
});
test("preferences default, isolation, serialized restart and full room/market merge",()=>{
 const r=freshRoom(),a=register(r,who),other={...who,id:"other",name:"Other"},b=register(r,other);
 assert.equal(triggerInputMode(a),"price");assert.equal(triggerInputMode(b),"price");
 setTradingSettings(r,who,"pnl");
 const restarted=JSON.parse(JSON.stringify(r));
 assert.equal(triggerInputMode(restarted.members[0]),"pnl");assert.equal(triggerInputMode(restarted.members[1]),"price");
 const full=publicRoom(restarted,who);assert.equal(full.me.triggerInputMode,"pnl");
 assert.equal(publicRoom(restarted,other).me.triggerInputMode,"price");
 const merged=mergeMarket(full,{version:full.version,serverNow:1000,quotes:{},positions:[],holdings:[],closedPositions:[],activity:[],leaderboard:[],wallet:1,netWorth:1})!;
 assert.equal(merged.me.triggerInputMode,"pnl");
 assert.throws(()=>setTradingSettings(r,who,"wrong" as "price"));
 assert.equal(triggerInputMode(a),"pnl");
});
test("saved mode is authoritative, rejects ambiguous payloads and stale UI, preserves default legacy prices",()=>{
 const r=freshRoom(),m=register(r,who),p={entry:100000000,margin:1000,leverage:2,side:"long" as const};
 assert.deepEqual(resolveTriggerInput(m,p,{takeProfit:120000000}),{takeProfit:120000000});
 assert.deepEqual(resolveTriggerInput(m,p,{}),{});
 assert.throws(()=>resolveTriggerInput(m,p,{takeProfitPnl:500}));
 assert.throws(()=>resolveTriggerInput(m,p,{triggerInputMode:"pnl"}));
 setTradingSettings(r,who,"pnl");
 for(const input of [{takeProfit:120000000},{takeProfit:null},{takeProfit:120000000,takeProfitPnl:500},{stopLoss:90000000,stopLossPnl:100}])assert.throws(()=>resolveTriggerInput(m,p,input));
 assert.deepEqual(resolveTriggerInput(m,p,{takeProfitPnl:null}),{takeProfit:null});
 assert.throws(()=>resolveTriggerInput(m,p,{triggerInputMode:"price",takeProfitPnl:500}));
});
test("close confirmation defaults off, validates boolean, isolates users and survives serialization",()=>{
 const r=freshRoom(),a=register(r,who),other={...who,id:"other"},b=register(r,other);
 assert.equal(skipCloseConfirmation(a),false);assert.equal(skipCloseConfirmation(b),false);
 setTradingSettings(r,who,"pnl");setCloseConfirmation(r,who,true);
 assert.equal(triggerInputMode(a),"pnl");assert.equal(skipCloseConfirmation(b),false);
 const restarted=JSON.parse(JSON.stringify(r));
 assert.equal(skipCloseConfirmation(restarted.members[0]),true);
 assert.equal(publicRoom(restarted,who).me.skipCloseConfirmation,true);
 assert.equal(publicRoom(restarted,other).me.skipCloseConfirmation,false);
 setTradingSettings(restarted,who,"price");assert.equal(skipCloseConfirmation(restarted.members[0]),true);
 setCloseConfirmation(restarted,who,false);assert.equal(skipCloseConfirmation(restarted.members[0]),false);
 assert.throws(()=>setCloseConfirmation(r,who,"true" as any));assertRoom(r);
});
