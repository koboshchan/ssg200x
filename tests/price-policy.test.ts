import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {quoteFresh,STALE_MS} from "../lib/price-policy";
import {freshRoom,register} from "./helpers/crypto-room";
import {openPosition,closePosition,requireQuote,liquidate,portfolio} from "../lib/finance";
import {applyMarketTick} from "../lib/market-tick";
import {settleTriggers} from "../lib/position-triggers";
const who={id:"freshness",name:"Freshness",email:"freshness@test",admin:false};
function setup(now:number){const room=freshRoom();portfolio(register(room,who));room.quotes={BTC:{cryptoGeneration:"fixture",micro:100e6,at:now}};return room;}
test("one source-age policy keeps strict WS ten seconds and stock strict sixty seconds",()=>{
 assert.equal(STALE_MS,10000);
 for(const age of [0,9999,10000])assert.equal(quoteFresh(100000-age,100000),true);
 for(const at of [89999,100001,NaN,Infinity,99999.5,-1])assert.equal(quoteFresh(at,100000),false);
 assert.equal(quoteFresh(40001,100000,true),true);assert.equal(quoteFresh(40000,100000,true),false);
});
test("v2 rates cannot construct executable marks; no receipt clock or HTTP header bypass remains",()=>{
 const source=readFileSync("lib/prices.ts","utf8"),policy=readFileSync("lib/price-policy.ts","utf8");
 assert.doesNotMatch(source,/exchange-rates\?|decodeRates|response\.json\(|nextRest|coinbase-history-budget/);
 assert.doesNotMatch(policy,/decodeRates|rates|Date\.now/);
 assert.match(source,/No executable REST fallback/);
});
for(const age of [15000,15001])test("manual open/close, liquidation and TP/SL agree at provider age "+age,()=>{
 const at=100000,now=at+age;
 for(const operation of ["open","close","liquidate","tp","sl"]){
  const r=setup(at);r.cryptoStatus={...r.cryptoStatus!,leaseUntil:at+60000};
  if(operation!=="open")openPosition(r,who,"BTC","long",10000,5,"p",at,operation==="tp"?{takeProfit:110e6}:operation==="sl"?{stopLoss:90e6}:{});
  const price=operation==="tp"?110e6:operation==="liquidate"?50e6:operation==="sl"?90e6:100e6;
  r.quotes!.BTC={cryptoGeneration:"fixture",micro:price,at};
  if(operation==="open"||operation==="close"){
   const fn=()=>operation==="open"?openPosition(r,who,"BTC","long",10000,5,"new",now):closePosition(r,who,"p",now);
   if(age===15000){assert.equal(requireQuote(r,"BTC",now),price);assert.doesNotThrow(fn);}
   else {const before=structuredClone(r);assert.throws(fn,/stream unavailable/);assert.deepEqual(r,before);}
  }else{
   const before=structuredClone(r);if(operation==="liquidate")liquidate(r,now);else settleTriggers(r,now);
   if(age===15000)assert.equal(r.members[0].positions!.length,0);else assert.deepEqual(r,before);
  }
 }
});
test("expired changed marks cannot publish or settle and fresh verified later trade replaces stale mark",()=>{
 const at=100000,r=setup(at);openPosition(r,who,"BTC","long",10000,5,"p",at,{stopLoss:90e6});
 applyMarketTick(r,{BTC:{cryptoGeneration:"fixture",micro:50e6,at}},at+15001);
 assert.deepEqual(r.quotes!.BTC,{cryptoGeneration:"fixture",micro:100e6,at});assert.equal(r.members[0].positions!.length,1);
 assert.throws(()=>requireQuote(r,"BTC",at+15001),/stream unavailable/);
 applyMarketTick(r,{BTC:{cryptoGeneration:"fixture",micro:110e6,at:at+15002}},at+15002);
 assert.equal(requireQuote(r,"BTC",at+15002),110e6);
});
