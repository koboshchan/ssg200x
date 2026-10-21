// These legacy accounting/trigger fixtures explicitly exercise the admin zero-fee mode.
import {test} from "node:test";
import assert from "node:assert/strict";
import {freshRoom,register,assertRoom} from "../lib/poker";
import {closePosition,openPosition,liquidate} from "../lib/finance";
import {settleTriggers} from "../lib/position-triggers";
import {publicRoom} from "../lib/public";
import {mergeMarket} from "../lib/room-sync";
// @ts-expect-error runtime JavaScript has no generated declarations
import {marketPayload} from "../runtime/market-payload.mjs";
const who={id:"owner",name:"Owner",email:"private@test",admin:true};
function setup(side:"long"|"short"="long"){
 const r=Object.assign(freshRoom(),{perpFeePpm:0});register(r,who);r.quotes={BTC:{micro:100_000_000,at:1000}};
 openPosition(r,who,"BTC",side,1001,3,"position",1000,{takeProfit:side==="long"?110_000_000:90_000_000,stopLoss:side==="long"?95_000_000:105_000_000});
 return r;
}
for(const side of ["long","short"] as const){
 for(const reason of ["Manual","TP","SL","Liq"] as const)test(`${side} ${reason} records exact exit, integer realized cents and supplied settlement time once`,()=>{
  const r=setup(side),m=r.members[0],before=m.wallet;
  const direction=side==="long"?1:-1;
  const move=reason==="SL"?-6_123_457:reason==="Liq"?-40_000_000:12_345_679;
  const exit=100_000_000+direction*move;
  r.quotes!.BTC={micro:exit,at:2345};
  if(reason==="Manual")closePosition(r,who,"position",2345);
  else if(reason==="Liq")liquidate(r,2345);
  else settleTriggers(r,2345);
  const realized=reason==="Liq"?-1001:Math.floor(1001*3*(exit-100_000_000)/100_000_000*direction);
  assert.deepEqual(m.closedPositions,[{id:"position",symbol:"BTC",side,leverage:3,entry:100_000_000,exit,margin:1001,realizedPnl:realized,reason,closedAt:2345}]);
  assert.equal(m.wallet-before,1001+realized);
  assert.equal(m.positions!.length,0);assertRoom(r);
  const saved=JSON.stringify(r);settleTriggers(r,2345);liquidate(r,2345);
  assert.throws(()=>closePosition(r,who,"position",2345));assert.equal(JSON.stringify(r),saved);
 });
}
test("manual close beyond liquidation is recorded as liquidation at actual gap mark",()=>{
 const r=setup();r.quotes!.BTC={micro:50_000_000,at:2000};closePosition(r,who,"position",2000);
 assert.equal(r.members[0].closedPositions![0].reason,"Liq");assert.equal(r.members[0].closedPositions![0].exit,50_000_000);
});
test("closed history is private in full and market snapshots and survives market merge",()=>{
 const r=setup(),other={...who,id:"other",email:"other@test",admin:false};register(r,other);
 closePosition(r,who,"position",1000);
 const own=publicRoom(r,who),foreign=publicRoom(r,other),ownMarket=marketPayload(r,who.id,1000),foreignMarket=marketPayload(r,other.id,1000);
 const wire=r.members[0].closedPositions!.map(({margin:_,...p})=>p);
 assert.deepEqual(own.closedPositions,wire);assert.deepEqual(ownMarket.closedPositions,own.closedPositions);
 assert.deepEqual(foreign.closedPositions,[]);assert.deepEqual(foreignMarket.closedPositions,[]);
 assert.equal(JSON.stringify(foreign).includes('"id":"position"'),false);
 assert.equal(JSON.stringify(foreignMarket).includes('"id":"position"'),false);
 assert.deepEqual(mergeMarket({...own,closedPositions:[]},ownMarket)!.closedPositions,own.closedPositions);
 const restarted=JSON.parse(JSON.stringify(r));assert.deepEqual(publicRoom(restarted,who).closedPositions,own.closedPositions);
});
test("legacy notices are preserved without inventing structured records",()=>{
 const r=Object.assign(freshRoom(),{perpFeePpm:0});register(r,who);r.members[0].activity=["Closed long BTC · 10.00 returned · position old"];
 const view=publicRoom(r,who);assert.deepEqual(view.closedPositions,[]);assert.deepEqual(view.activity,r.members[0].activity);
 assert.deepEqual(marketPayload(r,who.id).closedPositions,[]);
});
test("newest closed positions come first without overwriting older fills",()=>{
 const r=setup();closePosition(r,who,"position",1000);openPosition(r,who,"BTC","short",1000,2,"second",1000);closePosition(r,who,"second",1001);
 assert.deepEqual(r.members[0].closedPositions!.map(p=>[p.id,p.closedAt]),[["second",1001],["position",1000]]);
});
for(const side of ["long","short"] as const)test(`unchanged-entry manual ${side} returns full margin with plain Closed notice, not trigger or liquidation`,()=>{
 const r=Object.assign(freshRoom(),{perpFeePpm:0});register(r,who);r.quotes={BTC:{micro:100_000_000_000,at:1000}};
 openPosition(r,who,"BTC",side,2000,200,"manual-entry",1000,{takeProfit:undefined,stopLoss:undefined});
 settleTriggers(r,1000);assert.equal(r.members[0].positions!.length,1);assert.deepEqual(r.members[0].activity,undefined);
 closePosition(r,who,"manual-entry",1000);
 const m=r.members[0];assert.equal(m.wallet,100000);
 assert.equal(m.activity![0],`Closed ${side} BTC · 20.00 returned · fees 0.00 · position manual-entry`);
 assert.equal(m.closedPositions![0].reason,"Manual");assert.equal(m.closedPositions![0].realizedPnl,0);
 assert.equal(m.closedPositions![0].exit,m.closedPositions![0].entry);
 assertRoom(r);
});
