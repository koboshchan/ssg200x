import {test} from "node:test";
import assert from "node:assert/strict";
import {BSON,MongoClient} from "mongodb";
import {freshRoom,register,assertRoom} from "../lib/poker";
import {openPosition,liqPrice} from "../lib/finance";
import {applyMarketTick} from "../lib/market-tick";
import type {Room} from "../lib/types";
const who={id:"persist",name:"Persist",email:"persist@test",admin:false};
const options=new MongoClient("mongodb://127.0.0.1:27017").bsonOptions;
function persisted(r:Room):Room{return BSON.deserialize(BSON.serialize(r,options)) as Room;}
test("actual Mongo driver BSON defaults convert explicit undefined optional prices to null",()=>{
 assert.equal(options.ignoreUndefined,false);
 const p=BSON.deserialize(BSON.serialize({takeProfit:undefined,stopLoss:undefined},options));
 assert.deepEqual(p,{takeProfit:null,stopLoss:null});
 // The old !==undefined checks admitted null, then JS compared against zero.
 assert.equal(100_000_000_000>=Number(p.takeProfit),true);assert.equal(100_000_000_000>=Number(p.stopLoss),true);
});
for(const side of ["long","short"] as const)for(const leverage of [2,200])for(const maintenance of [0,.001])for(const withTriggers of [false,true]){
 test(`${side} ${leverage}x maintenance ${maintenance} triggers ${withTriggers} survives BSON restart and same/in-range ticks, closes only crossing`,()=>{
  let r=freshRoom();register(r,who);r.maintenance=maintenance;
  const entry=100_000_000_000,direction=side==="long"?1:-1;
  r.quotes={BTC:{micro:entry,at:1000}};
  openPosition(r,who,"BTC",side,1000,leverage,"persisted",1000,withTriggers?{takeProfit:entry+direction*200_000_000,stopLoss:entry-direction*200_000_000}:{takeProfit:undefined,stopLoss:undefined});
  r=persisted(r);const p=r.members[0].positions![0];
  assert.equal(p.entry,entry);assert.equal(p.maintenance,maintenance);assert.equal(p.leverage,leverage);
  if(!withTriggers){assert.equal(Object.hasOwn(p,"takeProfit"),false);assert.equal(Object.hasOwn(p,"stopLoss"),false);}
  const wallet=r.members[0].wallet;
  for(const [i,mark] of [entry,entry+direction*50_000_000,entry-direction*50_000_000,entry].entries()){
   applyMarketTick(r,{BTC:{micro:mark,at:1200+i*200}},1200+i*200);
   assert.equal(r.members[0].positions!.length,1);assert.equal(r.members[0].wallet,wallet);assert.deepEqual(r.members[0].closedPositions,[]);
  }
  if(withTriggers){
   const stopRoom=persisted(r),stopMark=entry-direction*200_000_000;
   applyMarketTick(stopRoom,{BTC:{micro:stopMark,at:2200}},2200);
   assert.equal(stopRoom.members[0].positions!.length,0);assert.equal(stopRoom.members[0].closedPositions![0].reason,"SL");
   assert.equal(stopRoom.members[0].closedPositions![0].exit,stopMark);assertRoom(stopRoom);
  }
  const mark=withTriggers?entry+direction*200_000_000:side==="long"?Math.floor(liqPrice(p)):Math.ceil(liqPrice(p));
  applyMarketTick(r,{BTC:{micro:mark,at:2200}},2200);
  assert.equal(r.members[0].positions!.length,0);assert.equal(r.members[0].closedPositions![0].reason,withTriggers?"TP":"Liq");
  assertRoom(r);const saved=JSON.stringify(r);applyMarketTick(r,{BTC:{micro:mark,at:2200}},2200);assert.equal(JSON.stringify(r),saved);
 });
}
for(const side of ["long","short"] as const)test(`legacy BSON null triggers and liquidation override do not close unchanged ${side}`,()=>{
 let r=freshRoom();register(r,who);const entry=100_000_000_000;r.quotes={BTC:{micro:entry,at:1000}};
 openPosition(r,who,"BTC",side,1000,200,"legacy",1000);
 const p=r.members[0].positions![0];
 Object.assign(p,{takeProfit:undefined,stopLoss:undefined,liquidationOverride:undefined});
 r=persisted(r);applyMarketTick(r,{BTC:{micro:entry,at:1200}},1200);
 assert.equal(r.members[0].positions!.length,1);assert.equal(r.members[0].wallet,99000);
 const mark=side==="long"?99_500_000_000:100_500_000_000;
 applyMarketTick(r,{BTC:{micro:mark,at:1400}},1400);assert.equal(r.members[0].positions!.length,0);assert.equal(r.members[0].closedPositions![0].reason,"Liq");
});
test("explicit zero and empty-string trigger prices reject atomically rather than becoming unset",()=>{
 const r=freshRoom();register(r,who);r.quotes={BTC:{micro:100_000_000_000,at:1000}};
 for(const side of ["long","short"] as const)for(const key of ["takeProfit","stopLoss"] as const)for(const bad of [0,""]){
  const before=JSON.stringify(r);
  assert.throws(()=>openPosition(r,who,"BTC",side,1000,200,"bad",1000,{[key]:bad} as unknown as {takeProfit?:number;stopLoss?:number}));
  assert.equal(JSON.stringify(r),before);
 }
});
