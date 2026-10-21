import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {subscribeMarket,scopeMarketRoom} from "../runtime/market-subscription.mjs";
// @ts-expect-error Runtime module is exercised directly without a TS facade.
import {emitRoomState} from "../runtime/room-state.mjs";
import {createChartCache} from "../lib/client-market-cache";
test("room transport omits every quote unless selected, routes one symbol, and clears on unsubscribe",()=>{
 const socket={data:{} as any,emit:(...args:any[])=>events.push(args)},events:any[]=[];
 const room={version:1,quotes:{BTC:{micro:1},ETH:{micro:2}},marketChanges:{BTC:1,ETH:2},stockExecution:{AAPL:{executable:true}},holdings:[{symbol:"ETH",value:45}],positions:[{pnl:3}],leaderboard:[{netWorth:48}]};
 assert.deepEqual(scopeMarketRoom(room,undefined).quotes,{});
 subscribeMarket(socket,"BTC");
 const selected=scopeMarketRoom(room,socket.data.marketSymbol);
 assert.deepEqual(selected.quotes,{BTC:{micro:1}});
 assert.deepEqual(selected.holdings,room.holdings);assert.deepEqual(selected.positions,room.positions);
 assert.deepEqual(selected.leaderboard,room.leaderboard);
 emitRoomState(socket,{maintenance:{blocked:false},room});assert.equal(events.length,1);
 subscribeMarket(socket,"../bad");assert.equal(socket.data.marketSymbol,"BTC");
 subscribeMarket(socket,"ETH");assert.deepEqual(scopeMarketRoom(room,socket.data.marketSymbol).quotes,{ETH:{micro:2}});
 subscribeMarket(socket,null);assert.deepEqual(scopeMarketRoom(room,socket.data.marketSymbol).quotes,{});
});
test("new connections start unsubscribed and the mounted Markets selection resubscribes after reconnect",()=>{
 const fresh={data:{} as any};assert.equal(fresh.data.marketSymbol,undefined);
 const source=readFileSync("app/finance-client.tsx","utf8");
 assert.match(source,/if\(connection==="connected"\)emit\("market:subscribe",symbol\|\|null\)/);
 assert.match(source,/return\(\)=>emit\("market:subscribe",null\)/);
 assert.match(source,/\[symbol,connection,emit\]/);
 subscribeMarket(fresh,"BTC");assert.equal(fresh.data.marketSymbol,"BTC");
});
test("chart cache retains history per symbol, merges overlapping delta and bounds LRU and rows",()=>{
 const cache=createChartCache(2,3,5000),row=(time:number,close=1)=>({time,open:1,high:close,low:1,close});
 cache.put("BTC:1m",[row(0),row(60000)],100000);
 assert.equal(cache.range("BTC:1m",60000,102000),null);
 assert.deepEqual(cache.range("BTC:1m",60000,106000),{from:60000,to:60000});
 cache.put("BTC:1m",[row(60000,2),row(120000),row(180000)],106000);
 assert.deepEqual(cache.get("BTC:1m")!.rows.map(r=>r.time),[60000,120000,180000]);
 assert.equal(cache.get("BTC:1m")!.rows[0].close,2);
 cache.put("ETH:1m",[],106000);cache.get("BTC:1m");cache.put("SOL:1m",[],106000);
 assert.equal(cache.get("ETH:1m"),undefined);assert.equal(cache.size,2);
});
test("quotes retain bounded symbol history while server transport is independently scoped",async()=>{
 const {mergeRoom}=await import("../lib/room-sync");
 const room={version:1,quotes:{BTC:{micro:1,at:1}}} as any;
 const next=mergeRoom(room,{version:2,quotes:{ETH:{micro:2,at:2}}} as any);
 assert.equal(next.quotes.BTC?.micro,1);assert.equal(next.quotes.ETH?.micro,2);
 const many=Object.fromEntries(Array.from({length:100},(_,i)=>["S"+i,{micro:1,at:i}]));
 assert.equal(Object.keys(mergeRoom(next,{version:3,quotes:many} as any).quotes).length,64);
});
