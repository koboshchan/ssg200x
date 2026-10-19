import {test} from "node:test";
import assert from "node:assert/strict";
import {freshRoom,register,assertRoom} from "../lib/poker";
import {openPosition,liqPrice,type Position} from "../lib/finance";
import {editPositionTriggers,settleTriggers,validateTriggers,type PositionTriggers} from "../lib/position-triggers";
const who={id:"tp-owner",name:"Owner",email:"tp@example.test",admin:false};
function setup(side:"long"|"short"="long"){
 const r=freshRoom();register(r,who);r.quotes={BTC:{micro:100_000_000,at:1000}};
 openPosition(r,who,"BTC",side,10000,10,"position",1000);
 return {r,p:r.members[0].positions![0] as Position & PositionTriggers};
}
for(const side of ["long","short"] as const){
 test(`${side} trigger validation rejects entry, liquidation boundaries and invalid prices`,()=>{
  const {p}=setup(side),liq=liqPrice(p);
  for(const price of [0,-1,NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>validateTriggers({...p,takeProfit:price}));
  assert.throws(()=>validateTriggers({...p,takeProfit:p.entry}));assert.throws(()=>validateTriggers({...p,stopLoss:p.entry}));assert.throws(()=>validateTriggers({...p,stopLoss:liq}));
  assert.throws(()=>validateTriggers({...p,takeProfit:p.entry*(side==="long"?.99:1.01)}));
  assert.throws(()=>validateTriggers({...p,stopLoss:liq+(side==="long"?-1:1)}));
 });
 for(const reason of ["takeProfit","stopLoss"] as const)test(`${side} ${reason} exact boundary triggers and fills gap at mark only once`,()=>{
  for(const gap of [0,1_000_000]){
   const {r,p}=setup(side),profit=reason==="takeProfit",direction=(side==="long")===(profit)?1:-1;
   const threshold=p.entry+direction*5_000_000;editPositionTriggers(r,who,p.id,{[reason]:threshold});
   r.quotes!.BTC!.micro=threshold+direction*gap;settleTriggers(r,1000);
   assert.equal(r.members[0].positions!.length,0);assert.equal(r.members[0].wallet,100000+(profit?1:-1)*(5000+gap/1000));
   const snapshot=JSON.stringify(r);settleTriggers(r,1000);assert.equal(JSON.stringify(r),snapshot);assert.match(r.members[0].activity![0],profit?/Take-profit/:/Stop-loss/);assertRoom(r);
  }
 });
 test(`${side} liquidation has priority across a stop gap`,()=>{const {r,p}=setup(side);editPositionTriggers(r,who,p.id,{stopLoss:p.entry*(side==="long"?.95:1.05)});r.quotes!.BTC!.micro=p.entry*(side==="long"?.8:1.2);settleTriggers(r,1000);assert.equal(r.members[0].wallet,90000);assert.match(r.members[0].activity![0],/Liquidated/);assertRoom(r);});
}
test("edit/remove are owner-only and invalid updates atomic",()=>{const {r,p}=setup();editPositionTriggers(r,who,p.id,{takeProfit:110000000,stopLoss:95000000});assert.throws(()=>editPositionTriggers(r,{...who,id:"other"},p.id,{takeProfit:null}));assert.throws(()=>editPositionTriggers(r,who,p.id,{takeProfit:120000000,stopLoss:1}));assert.equal(p.takeProfit,110000000);editPositionTriggers(r,who,p.id,{takeProfit:null});assert.equal(p.takeProfit,undefined);assert.equal(p.stopLoss,95000000);editPositionTriggers(r,who,p.id,{stopLoss:null});assert.equal(p.stopLoss,undefined);});
test("stale and future marks cannot trigger; serialized restart resumes without clients",()=>{const {r,p}=setup();editPositionTriggers(r,who,p.id,{takeProfit:110000000});r.quotes!.BTC!.micro=120000000;settleTriggers(r,20000);assert.equal(r.members[0].positions!.length,1);settleTriggers(r,0);assert.equal(r.members[0].positions!.length,1);const resumed=JSON.parse(JSON.stringify(r));settleTriggers(resumed,1000);assert.equal(resumed.members[0].positions.length,0);assertRoom(resumed);});
test("opening accepts persisted triggers and invalid opening never debits margin",()=>{
 const {r}=setup();const wallet=r.members[0].wallet;
 assert.throws(()=>openPosition(r,who,"BTC","long",1000,10,"invalid",1000,{stopLoss:1}));assert.equal(r.members[0].wallet,wallet);assert.equal(r.members[0].positions!.length,1);
 openPosition(r,who,"BTC","short",1000,10,"valid",1000,{takeProfit:95000000,stopLoss:105000000});assert.equal(r.members[0].positions!.at(-1)!.stopLoss,105000000);assertRoom(r);
});
