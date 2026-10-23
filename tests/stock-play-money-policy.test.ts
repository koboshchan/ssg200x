import {test} from "node:test";
import assert from "node:assert/strict";
import {freshRoom,register} from "./helpers/crypto-room";
import {openPosition,closePosition,liquidate,requireQuote} from "../lib/finance";
import {settleTriggers} from "../lib/position-triggers";
import {publicStockState} from "../lib/stock-room-policy";
const now=Date.parse("2026-10-19T15:00:00Z");
const who={id:"policy",name:"Policy",email:"policy@example.com",admin:false};
function fixture(age=59999,price=200){
 const r=freshRoom(),m=register(r,who);m.wallet=100000;m.holdings=[];m.spins=[];m.closedPositions=[];
 r.quotes={AAPL:{cryptoGeneration:"fixture",micro:price*1e6,at:now-age}};
 r.stockExecution={AAPL:{symbol:"AAPL",leaseUntil:now+120000,connected:true,authorized:true,leader:true,halt:"unknown",corporateActionsReconciled:false,tick:{symbol:"AAPL",price,timestamp:now-age,receivedAt:now-age,feed:"alpaca-iex"},clock:{isOpen:true,timestamp:now,receivedAt:now,nextOpen:now+86400000,nextClose:now+3600000},sessions:[{date:"2026-10-19",open:now-3600000,close:now+3600000}]}};
 return {r,m};
}
test("unknown metadata allows fresh OPEN opening and manual closing at 59999ms",()=>{
 const {r,m}=fixture();openPosition(r,who,"AAPL","long",1000,2,"opened",now);
 assert.equal(m.positions?.length,1);closePosition(r,who,m.positions![0].id,now);
 assert.equal(m.positions?.length,0);assert.equal(m.closedPositions?.[0].reason,"Manual");
 assert.equal(publicStockState(r,now).AAPL.validUntil,now+1);
});
for(const reason of ["TP","SL","Liq"] as const)test(reason+" honors the same 60s fresh stock policy with unknown metadata",()=>{
 const price=reason==="TP"?220:reason==="SL"?180:90;
 const {r,m}=fixture(59999,price);
 m.positions=[{id:"p",symbol:"AAPL",entry:200e6,margin:1000,leverage:2,side:"long",opened:now-120000,...(reason==="TP"?{takeProfit:210e6}:reason==="SL"?{stopLoss:190e6}:{})}];
 if(reason==="Liq")liquidate(r,now);else settleTriggers(r,now);
 assert.equal(m.positions.length,0);assert.equal(m.closedPositions?.[0].reason,reason);
});
for(const age of [60000,-1])test("invalid stock age "+age+" preserves claims across all paths",()=>{
 const {r,m}=fixture(age,90);m.positions=[{id:"p",symbol:"AAPL",entry:200e6,margin:1000,leverage:2,side:"long",opened:now-120000,stopLoss:190e6}];
 const before=structuredClone(r);
 assert.throws(()=>requireQuote(r,"AAPL",now));assert.throws(()=>openPosition(r,who,"AAPL","long",1000,2,"opened",now));assert.throws(()=>closePosition(r,who,"p",now));
 liquidate(r,now);settleTriggers(r,now);assert.deepEqual(r,before);
});
test("closed session and mismatched provider price still deny",()=>{
 for(const kind of ["closed","mismatch"]){
 const {r}=fixture();if(kind==="closed")r.stockExecution!.AAPL!.clock!.isOpen=false;else r.quotes!.AAPL!.micro++;
 assert.throws(()=>requireQuote(r,"AAPL",now));
 }
});
test("crypto uses shared heartbeat health rather than a 10s per-symbol deadline",()=>{
 const r=freshRoom();r.quotes={BTC:{cryptoGeneration:"fixture",micro:100e6,at:now-10000}};
 assert.equal(requireQuote(r,"BTC",now),100e6);assert.equal(requireQuote(r,"BTC",now+1),100e6);assert.throws(()=>requireQuote(r,"BTC",now+5000));
});

test("socket and HTTP stock statuses share the receipt-bounded 60s deadline",async()=>{
 // @ts-expect-error Runtime ESM module is exercised directly, without a declaration file.
 const {marketPayload}=await import("../runtime/market-payload.mjs");
 for(const age of [59999,60000,-1]){
  const {r}=fixture(age);
  const socket=marketPayload(r,who.id,now)!.stockExecution.AAPL;
  assert.equal(socket.executable,age===59999);
  assert.equal(socket.executable,publicStockState(r,now).AAPL.executable);
 }
 const {r}=fixture(0);r.stockExecution!.AAPL!.tick!.receivedAt=now-59999;
 assert.equal(marketPayload(r,who.id,now)!.stockExecution.AAPL.validUntil,now+1);
});
