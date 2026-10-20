import {test} from "node:test";
import assert from "node:assert/strict";
import {freshRoom,register} from "../lib/poker";
import {stockExecutable,requireQuote,closePosition,liquidate,type Symbol} from "../lib/finance";
import {settleTriggers} from "../lib/position-triggers";
import {STOCK_SYMBOLS} from "../lib/stock-config";
import type {StockExecutionState} from "../lib/stock-policy";
const now=Date.parse("2026-10-19T15:00:00Z");
const who={id:"stock-fixture",name:"Fixture",email:"fixture@example.com",admin:false};
for(const symbol of STOCK_SYMBOLS)test(symbol+" closed/unknown stock state preserves claims on all settlement paths",()=>{
 const r=freshRoom();const m=register(r,who);
 // Until the separate typed stock-union hook lands, exercise persisted symbols
 // as the untrusted/previously saved claims the financial guard must protect.
 const persisted=symbol as unknown as Symbol;
 m.positions=[{id:"p",symbol:persisted,entry:200_000_000,margin:1000,leverage:2,side:"long",opened:now-1000,takeProfit:201_000_000,stopLoss:150_000_000}];
 r.quotes={[symbol]:{micro:100_000_000,at:now-100}};
 const state:StockExecutionState={symbol,connected:true,leader:true,authorized:true,tick:{symbol,price:100,timestamp:now-100,receivedAt:now,feed:"alpaca-iex"},clock:null,sessions:[]};
 Object.assign(r,{stockExecution:{[symbol]:state}});
 const before=structuredClone(r);
 assert.equal(stockExecutable(r,symbol,now),false);
 assert.throws(()=>requireQuote(r,persisted,now),/Stock market closed/);
 assert.throws(()=>closePosition(r,who,"p",now),/Stock market closed/);
 liquidate(r,now);settleTriggers(r,now);
 assert.deepEqual(r,before);
});
test("stock metadata and matching print publish atomically without allowing crypto-only spoofing",async()=>{
 const {applyMarketTick}=await import("../lib/market-tick");
 const r=freshRoom(),symbol="SPCX" as const;
 const state:StockExecutionState={symbol,connected:true,leader:true,authorized:true,tick:{symbol,price:150,timestamp:now-100,receivedAt:now,feed:"alpaca-iex"},clock:null,sessions:[]};
 applyMarketTick(r,{SPCX:{micro:150_000_000,at:now-100}},now);
 assert.equal(r.quotes?.SPCX,undefined);
 applyMarketTick(r,{SPCX:{micro:151_000_000,at:now-100}},now,{SPCX:state});
 assert.equal(r.quotes?.SPCX,undefined);
 applyMarketTick(r,{SPCX:{micro:150_000_000,at:now-100}},now,{SPCX:state});
 assert.equal(structuredClone(r).quotes?.SPCX?.micro,150_000_000);
 assert.equal(r.stockExecution?.SPCX?.symbol,"SPCX");
 assert.equal(stockExecutable(r,"SPCX",now),false);
});
test("persisted feed leadership expires in another worker without a disconnect publication",()=>{
 const r=freshRoom(),symbol="AAPL" as const;
 const state:StockExecutionState={symbol,leaseUntil:now-1,connected:true,leader:true,authorized:true,tick:{symbol,price:200,timestamp:now-100,receivedAt:now,feed:"alpaca-iex"},clock:{isOpen:true,timestamp:now,receivedAt:now,nextOpen:now+86400000,nextClose:Date.parse("2026-10-19T20:00:00Z")},sessions:[{date:"2026-10-19",open:Date.parse("2026-10-19T13:30:00Z"),close:Date.parse("2026-10-19T20:00:00Z")}]};
 r.stockExecution={AAPL:state};r.quotes={AAPL:{micro:200_000_000,at:now-100}};
 assert.equal(stockExecutable(r,symbol,now),false);
 state.leaseUntil=now+5000;assert.equal(stockExecutable(r,symbol,now),true);
 delete state.leaseUntil;assert.equal(stockExecutable(r,symbol,now),false);
});
