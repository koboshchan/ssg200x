import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {chartStorageKey,parseChartPreferences,readChartPreferences,writeChartPreferences,emptyPreferences} from "../lib/chart-preferences";
import {pricePrecision,formatMarketPrice} from "../lib/price-display";
test("drawing and indicator settings isolate real user and symbol with schema version",()=>{
 assert.equal(chartStorageKey(null,"BTC"),null);
 assert.notEqual(chartStorageKey("user_a","BTC"),chartStorageKey("user_b","BTC"));
 assert.notEqual(chartStorageKey("user_a","BTC"),chartStorageKey("user_a","ETH"));
 assert.notEqual(chartStorageKey("a:b","c"),chartStorageKey("a","b:c"));
 assert.match(chartStorageKey("user_a","EUR/USD")!,/v1:.*EUR%2FUSD/);
});
test("preferences restore only whitelisted indicators and finite timestamp anchors",()=>{
 const item={name:"ssgRectangle",points:[{timestamp:1000,value:.00012},{timestamp:2000,value:.00016}]};
 const raw=JSON.stringify({version:1,indicators:["MA","MA","RSI","VOL","evil"],drawings:[item,{name:"unregistered",points:[]},{name:"segment",points:[{timestamp:1,value:null},{timestamp:2,value:1}]},{name:"segment",points:[{timestamp:1,value:1}]}]});
 assert.deepEqual(parseChartPreferences(raw),{version:1,indicators:["MA","RSI","VOL"],drawings:[item]});
 for(const raw of [null,"{",JSON.stringify({version:2,indicators:["MA"]})," ".repeat(100001)])assert.deepEqual(parseChartPreferences(raw),emptyPreferences());
});
test("drawing parsing bounds count and rejects negative, non-integer or absent timestamps",()=>{
 const item={name:"horizontalStraightLine",points:[{timestamp:0,value:1}]};
 assert.equal(parseChartPreferences(JSON.stringify({version:1,drawings:Array(150).fill(item)})).drawings.length,100);
 for(const timestamp of [-1,1.5,"200",null])assert.deepEqual(parseChartPreferences(JSON.stringify({version:1,drawings:[{...item,points:[{timestamp,value:1}]}]})).drawings,[]);
});
test("unavailable localStorage fails safely in SSR or restricted browsers",()=>{
 assert.deepEqual(readChartPreferences("any"),emptyPreferences());
 assert.doesNotThrow(()=>writeChartPreferences("any",emptyPreferences()));
});
test("cheap coin decimals stay visible without losing normal dollar formatting",()=>{
 assert.equal(pricePrecision(.00001234),8);
 assert.equal(pricePrecision(.0345),5);
 assert.equal(pricePrecision(100),2);
 assert.equal(formatMarketPrice(.00001234),"$0.00001234");
 assert.equal(formatMarketPrice(123.45),"$123.45");
 assert.equal(formatMarketPrice(NaN),"Unavailable");
});
test("market chart lazily imports selected engine with no browser upstream or polling",()=>{
 const chart=readFileSync("app/cached-chart.tsx","utf8"),engine=readFileSync("app/market-chart-engine.ts","utf8");
 assert.match(chart,/await import\("\.\/market-chart-engine"\)/);
 assert.doesNotMatch(engine,/fetch\(|new WebSocket|setInterval\(/);
 assert.match(engine,/subscribeBar:/);
 assert.match(engine,/unsubscribeBar:/);
 assert.match(engine,/paneId: "candle_pane"/);
 assert.match(engine,/createIndicator\(\{name,/);
 assert.match(engine,/name: "ssgRectangle", totalStep: 3/);
 assert.match(chart,/storeKey=chartStorageKey\(isLoaded\?user\?\.id:null,symbol\)/);
 assert.match(engine,/onPressedMoveEnd/);
 assert.match(engine,/queueMicrotask\(persist\)/);
 assert.match(engine,/pending\) c\.removeOverlay/);
});
