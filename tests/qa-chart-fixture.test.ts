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
