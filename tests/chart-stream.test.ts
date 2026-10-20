import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {chartSelection,chartSnapshotCache} from "../lib/chart-snapshot";
import {mergeChartCandles,tickCandle} from "../lib/live-candle";
import type {candleRead} from "../lib/candles";
test("chart subscriptions exactly allowlist symbols and intervals",()=>{
 for(const values of [["BTC","1h"],["HYPE","1m"]])assert.ok(chartSelection(...values as [string,string]));
 for(const values of [["BTC","__proto__"],["NOTREAL","1h"],[{$ne:null},"1h"],["BTC",{}]])assert.equal(chartSelection(...values as [unknown,unknown]),null);
});
test("server snapshot reads coalesce across subscribers and refresh without fetching upstream",async()=>{
 let calls=0,now=1_792_459_280_000;
 const load=(async(symbol,g,from,to,limit)=>{calls++;assert.equal(limit,301);assert.equal(to-from,300*3600000);return [];}) as typeof candleRead;
 const snapshot=chartSnapshotCache(load,()=>now),s=chartSelection("BTC","1h")!;
 await Promise.all(Array.from({length:20},()=>snapshot(s)));assert.equal(calls,1);
 now+=2001;await snapshot(s);assert.equal(calls,2);
});
test("snapshot failures retry and do not poison the shared cache",async()=>{
 let calls=0;
 const snapshot=chartSnapshotCache((async()=>{if(++calls===1)throw Error("db");return [];}) as typeof candleRead);
 await assert.rejects(snapshot(chartSelection("BTC","1m")!));
 assert.deepEqual(await snapshot(chartSelection("BTC","1m")!),[]);
});
test("sparse historical arrivals preserve live close and extrema without inventing missing bars",()=>{
 const row=(time:number,open=10,high=10,low=10,close=10)=>({time,open,high,low,close});
 const live=new Map([[180000,row(180000,12,16,11,15)]]);
 assert.deepEqual(mergeChartCandles([],live),[...live.values()]);
 const merged=mergeChartCandles([row(0),row(180000,9,14,8,13)],live);
 assert.deepEqual(merged,[row(0),row(180000,9,16,8,15)]);
 assert.equal(merged.some(r=>r.time===60000||r.time===120000),false);
 const next=tickCandle(merged.at(-1),{micro:17_000_000,at:240001},60000)!;
 assert.equal(next.time,240000);assert.equal(next.close,17);
 assert.equal(mergeChartCandles(Array.from({length:1000},(_,i)=>row(i*60000)),new Map()).length,301);
});
test("socket chart snapshots are read-only, scoped, deduplicated and maintenance gated",async()=>{
 const {subscribeChart,emitChartState}=await import("../runtime/chart-stream.mjs");
 const events:unknown[]=[],socket={data:{} as any,emit:(...args:unknown[])=>events.push(args)};
 subscribeChart(socket,{symbol:"BTC",granularity:"1h"},1000);
 const payload={symbol:"BTC",granularity:"1h",candles:[]};
 emitChartState(socket,{maintenance:{blocked:true},candles:payload});assert.equal(events.length,0);
 emitChartState(socket,{maintenance:{blocked:false},candles:{...payload,symbol:"ETH"}});assert.equal(events.length,0);
 emitChartState(socket,{maintenance:{blocked:false},candles:payload});assert.equal(events.length,1);
 emitChartState(socket,{maintenance:{blocked:false},candles:payload});assert.equal(events.length,1);
 subscribeChart(socket,{symbol:{$ne:null},granularity:"1h"},1200);assert.equal(socket.data.chart.symbol,"BTC");
 subscribeChart(socket,null,1300);
 subscribeChart(socket,{symbol:"ETH",granularity:"1m"},1301);
 assert.equal(socket.data.chart.symbol,"ETH");
 subscribeChart(socket,null,1302);
 emitChartState(socket,{maintenance:{blocked:false},candles:payload});assert.equal(events.length,1);
});
test("chart snapshot delivery uses existing websocket, never tick-triggered HTTP or upstream calls",()=>{
 const chart=readFileSync("app/cached-chart.tsx","utf8"),stream=readFileSync("runtime/chart-stream.mjs","utf8");
 assert.match(chart,/subscribe\("candles:state"/);assert.match(chart,/emit\("candles:subscribe"/);
 assert.doesNotMatch(chart,/setInterval\(|fetch\(.*coinbase|fetch\(.*binance/);
 assert.doesNotMatch(stream,/fetch\(/);
 assert.match(chart,/if\(latest.current\)push.current\?\.\(latest.current\);/);
 assert.match(readFileSync("app/api/candles/route.ts","utf8"),/candleEnsure\(.*\.catch\(/);
});
