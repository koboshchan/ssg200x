import {test} from "node:test";
import assert from "node:assert/strict";
import {freshRoom,register} from "../lib/poker";
import {marketSummary} from "../lib/market-summary";
import {publicRoom} from "../lib/public";
import {subscribeMarket,scopeMarketRoom} from "../runtime/market-subscription.mjs";
const now=Date.parse("2026-10-21T19:00:00Z"),day="2026-10-21";
function fixture(){
 const r=freshRoom();r.marketSymbols={crypto:["BTC","ETH","NEW"],stocks:["AAPL","SPY"],delisted:["OLD"],revision:2};
 r.quotes={BTC:{micro:110_000_000,at:now},ETH:{micro:90_000_000,at:now},AAPL:{micro:100_000_000,at:now},SPY:{micro:150_000_000,at:now},OLD:{micro:1,at:now}};
 r.marketDay={BTC:{day,open:100_000_000},ETH:{day,open:100_000_000},AAPL:{day,open:100_000_000},SPY:{day,open:100_000_000}};
 return r;
}
test("server summary contains every enabled crypto and stock regardless of selection, no delisted symbols",()=>{
 const r=fixture(),summary=marketSummary(r,now);
 assert.deepEqual(Object.keys(summary),["BTC","ETH","NEW","AAPL","SPY"]);
 assert.ok(Math.abs(summary.BTC.change!-10)<1e-10);assert.ok(Math.abs(summary.ETH.change!+10)<1e-10);
 assert.equal(summary.AAPL.change,0);assert.equal(summary.SPY.change,50);
 assert.deepEqual(summary.NEW,{micro:null,change:null});
 const socket={data:{} as any};subscribeMarket(socket,"ETH");
 const scoped=scopeMarketRoom({quotes:r.quotes,marketChanges:{BTC:10,ETH:-10},marketSummary:summary,stockExecution:{AAPL:{executable:true}}},socket.data.marketSymbol);
 assert.deepEqual(Object.keys(scoped.quotes!),["ETH"]);assert.deepEqual(Object.keys(scoped.marketChanges),["ETH"]);
 assert.deepEqual(scoped.stockExecution,{});assert.deepEqual(scoped.marketSummary,summary);
 subscribeMarket(socket,"SPY");assert.deepEqual(scopeMarketRoom({...scoped,quotes:r.quotes},socket.data.marketSymbol).quotes,{SPY:r.quotes!.SPY});
 subscribeMarket(socket,null);assert.deepEqual(scopeMarketRoom(scoped,socket.data.marketSymbol).marketSummary,{});
 assert.deepEqual(scopeMarketRoom(scoped,socket.data.marketSymbol).quotes,{});
 assert.deepEqual(r,fixture(),"projection does not mutate shared cache");
});
test("daily summary never invents a change without a same-day valid baseline and quote",()=>{
 const r=fixture();r.marketDay!.BTC.day="2026-10-20";r.marketDay!.ETH.open=0;r.quotes!.AAPL!.at=now-86400000;r.quotes!.SPY!.at=now+1;
 const summary=marketSummary(r,now);for(const row of Object.values(summary))assert.equal(row.change,null);
 assert.equal(summary.AAPL.micro,100_000_000,"last cached price remains informational");assert.equal(summary.SPY.micro,null,"future quote is not displayed");
 for(const value of [NaN,Infinity,-1,0,1.5]){r.quotes!.BTC!.micro=value;assert.deepEqual(marketSummary(r,now).BTC,{micro:null,change:null});}
 r.quotes!.BTC={micro:1,at:now};r.marketDay!.BTC={day,open:NaN};assert.equal(marketSummary(r,now).BTC.change,null);
 r.marketDay!.BTC={day,open:1};assert.equal(marketSummary(r,now+86400000).BTC.change,null,"UTC rollover discards previous daily baseline");
});
test("public room supplies the same summary and daily changes from its shared quote book",()=>{
 const r=fixture(),who={id:"summary-qa",name:"Summary",email:"summary@example.test",admin:false};register(r,who);
 const today=new Date().toISOString().slice(0,10);for(const base of Object.values(r.marketDay!))base.day=today;
 for(const q of Object.values(r.quotes!))if(q)q.at=Date.now()-100;
 const result=publicRoom(r,who);assert.deepEqual(result.marketSummary,marketSummary(r));
 assert.equal(result.marketChanges.ETH,result.marketSummary.ETH.change);
 assert.equal(result.marketSummary.SPY.change,50);assert.equal(result.marketSummary.AAPL.change,0);
 const scoped=scopeMarketRoom(result,"ETH");assert.deepEqual(Object.keys(scoped.quotes),["ETH"]);
 assert.equal(scoped.marketSummary.SPY.change,50);assert.equal(scoped.marketSummary.BTC.micro,110_000_000);
});

test("real room wire updates unselected summary rows without full quotes and clears on route departure",async()=>{
 const {createServer}=await import("node:http"),{Server}=await import("socket.io"),{io}=await import("socket.io-client");
 // @ts-expect-error shared runtime JS module
 const {emitRoomState}=await import("../runtime/room-state.mjs");
 const {createStateReceiver}=await import("../runtime/state-stream.mjs");
 const http=createServer(),server=new Server(http,{transports:["websocket"]}),r=fixture();
 let peer:any;const initial={version:1,quotes:r.quotes,marketSummary:marketSummary(r,now)};
 server.on("connection",s=>{peer=s;subscribeMarket(s,"ETH");emitRoomState(s,{maintenance:{blocked:false},room:initial},true);});
 await new Promise<void>(resolve=>http.listen(0,"127.0.0.1",resolve));
 const client=io("http://127.0.0.1:"+(http.address() as any).port,{transports:["websocket"],autoConnect:false,reconnection:false});
 const values:any[]=[],frames:any[]=[],receiver=createStateReceiver(()=>assert.fail("unexpected resync"));let nextResolve:()=>void=()=>{};
 client.on("room:state",frame=>{frames.push(frame);const result=receiver.receive("room:state",frame);if(result.ok){values.push(result.value);nextResolve();}});
 const next=()=>new Promise<void>(resolve=>{nextResolve=resolve;});
 try{
  let ready=next();client.connect();await ready;assert.deepEqual(Object.keys(values[0].quotes),["ETH"]);assert.equal(values[0].marketSummary.SPY.change,50);
  r.quotes!.SPY!.micro=160_000_000;const updated={...initial,version:2,marketSummary:marketSummary(r,now)};
  ready=next();emitRoomState(peer,{maintenance:{blocked:false},room:updated});await ready;
  assert.equal(frames.at(-1).type,"diff");assert.deepEqual(Object.keys(values.at(-1).quotes),["ETH"]);assert.ok(Math.abs(values.at(-1).marketSummary.SPY.change-60)<1e-10);
  ready=next();subscribeMarket(peer,null);emitRoomState(peer,{maintenance:{blocked:false},room:updated});await ready;
  assert.deepEqual(values.at(-1).marketSummary,{});assert.deepEqual(values.at(-1).quotes,{});
 }finally{client.disconnect();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
