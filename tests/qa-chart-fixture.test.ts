import test from "node:test";
import assert from "node:assert/strict";
import {fixtureMode,fixtureCandles} from "../lib/qa-chart-fixture";
const env={QA_CHART_FIXTURES:"1",SSG_ISOLATED_QA:"1",QA_PROTECTED_COLLECTIONS:"candles",FX_STREAM_ENABLED:"false",NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:"pk_test_dummy",CLERK_SECRET_KEY:"sk_test_dummy"};
test("fixtures default off and fail closed without isolated DEV configuration",()=>{
 assert.equal(fixtureMode({}),false);assert.equal(fixtureMode(env),true);
 for(const key of Object.keys(env)){const e={...env};delete e[key as keyof typeof e];if(key==="QA_CHART_FIXTURES")assert.equal(fixtureMode(e),false);else assert.throws(()=>fixtureMode(e));}
 assert.throws(()=>fixtureMode({...env,CLERK_SECRET_KEY:"sk_live_dummy"}));
 assert.throws(()=>fixtureMode({...env,QA_CHART_FIXTURES:"true"}));
});
test("deterministic multi-symbol/timeframe OHLCV supports low prices and indicators",()=>{
 for(const symbol of ["BTC","DOGE","XRP","AAPL","EUR/USD","USD/JPY"])
 for(const g of ["1m","5m","15m","1h","6h","1d"]){
  const rows=fixtureCandles(symbol,g);assert.equal(rows.length,360);assert.deepEqual(rows,fixtureCandles(symbol,g));
  for(const [i,row]of rows.entries()){assert.ok(row.low>0&&row.low<=Math.min(row.open,row.close)&&row.high>=Math.max(row.open,row.close));assert.ok(row.volume>0);if(i)assert.ok(row.time>rows[i-1].time);}
 }
 assert.ok(fixtureCandles("DOGE","1h")[0].close<0.0001);
 assert.throws(()=>fixtureCandles("../bad","1h"));assert.throws(()=>fixtureCandles("BTC","bad"));
});

import {fixtureMacdPrecision,fixtureChatInitiallyOpen} from "../lib/qa-fixture-display";
test("fixture MACD retains small price differences and mobile default preserves production",()=>{
 const p=fixtureMacdPrecision(0.00003741);
 assert.ok(p>=10);assert.notEqual((0.0000001234).toFixed(p),"0.0000000000");
 assert.equal(fixtureChatInitiallyOpen(true,390,"1"),false);
 assert.equal(fixtureChatInitiallyOpen(false,390,"1"),true);
 assert.equal(fixtureChatInitiallyOpen(false,1280,null),true);
 assert.equal(fixtureChatInitiallyOpen(true,1280,"1"),true);
});

test("fixture labels and chat layout remain gated on server fixture mode",async()=>{
 const fs=await import("node:fs/promises");
 const badge=await fs.readFile("app/live-provider.tsx","utf8");
 assert.ok(badge.includes('fixture?"DEMO FIXTURE — NOT LIVE"'));
 const css=await fs.readFile("app/globals.css","utf8");
 assert.ok(css.includes('body[data-qa-chart-fixture="true"] .chat-dock{position:relative!important'));
 const layout=await fs.readFile("app/layout.tsx","utf8");
 assert.ok(layout.includes('data-qa-chart-fixture={fixtureMode()?"true":undefined}'));
});

test("picker percentage tooltip labels fixture baseline without changing production wording",async()=>{
 const fs=await import("node:fs/promises");
 const s=await fs.readFile("app/market-symbol-picker.tsx","utf8");
 assert.ok(s.includes('fixture?"DEMO FIXTURE — NOT LIVE. Change from fixture baseline":"Change since first live quote today (UTC)"'));
 assert.ok(s.includes('title={baseline+". Unavailable."}'));
 assert.ok(s.includes('title={baseline}'));
});
