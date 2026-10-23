import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {join} from "node:path";
function files(root:string):string[]{return readdirSync(root,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(root,e.name)):/\.[cm]?[jt]sx?$/.test(e.name)?[join(root,e.name)]:[]);}
test("client entry modules cannot fetch Coinbase, Binance or external chart data providers",()=>{
 for(const path of files("app")){
  const source=readFileSync(path,"utf8");
  if(!/^["']use client["'];/.test(source.trimStart()))continue;
  assert.doesNotMatch(source,/(?:api\.(?:exchange\.)?coinbase\.com|ws-feed\.exchange\.coinbase\.com|data\.binance\.vision|s3\.tradingview\.com|widget\.tradingview|TradingView\.widget)/i,path);
  assert.doesNotMatch(source,/(?:fetch|WebSocket|EventSource)\s*\(\s*["'`](?:https?:|wss?:|\/\/)/,path);
 }
});
test("chart uses bundled renderer with same-origin cached candle API and server supplied quotes",()=>{
 const source=readFileSync("app/cached-chart.tsx","utf8");
 assert.match(source,/import\("\.\/market-chart-engine"\)/);
 assert.match(readFileSync("app/market-chart-engine.ts","utf8"),/from "klinecharts"/);
 assert.match(source,/fetch\("\/api\/candles\?/);
 assert.match(source,/useLive/);
 assert.doesNotMatch(source,/createElement\(["']script|<iframe|<script|datafeed|new WebSocket/);
});
