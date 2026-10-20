import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import * as candles from "../lib/candles";
test("candle module exposes only stored reads and live writes, without import workers",()=>{
 assert.deepEqual(Object.keys(candles).sort(),["GRANULARITIES","candleRead","candleUpdate"]);
 const source=readFileSync("lib/candles.ts","utf8");
 assert.doesNotMatch(source,/fetch\(|candle_backfill|candle_coverage|candle_history_state|deleteMany|drop\(|truncate/i);
 assert.match(source,/createIndex\(\{symbol:1,granularity:1,time:1\}/);
 assert.match(source,/Object.entries\(GRANULARITIES\)/);
});
test("startup cannot seed or execute historical jobs; HTTP reads stored bars only",()=>{
 const startup=readFileSync("instrumentation.ts","utf8"),route=readFileSync("app/api/candles/route.ts","utf8");
 assert.doesNotMatch(startup,/backfill|candleEnsure|historyStep/i);
 assert.match(startup,/startPriceWorker\(\)/);
 assert.match(route,/candleRead\(symbol,g,from,to,1000\)/);
 assert.doesNotMatch(route,/fetch\(|candleEnsure|backfill/i);
});
test("progress and go-live UI/API are removed while the manual switch remains",()=>{
 for(const path of ["app/api/internal-live/route.ts","app/live-provider.tsx","app/room-client.tsx","app/api/admin/route.ts","lib/admin.ts","lib/site-maintenance.ts","app/maintenance-gate.tsx"]){
  assert.doesNotMatch(readFileSync(path,"utf8"),/backfill|HistoryProgress|history:state/i,path);
 }
 assert.equal(existsSync("app/history-progress.tsx"),false);
 assert.match(readFileSync("app/api/admin/route.ts","utf8"),/site-maintenance/);
});
test("live candle widths remain supported for each persisted interval",()=>{
 assert.deepEqual(Object.keys(candles.GRANULARITIES),["1m","5m","15m","1h","6h","1d"]);
});
