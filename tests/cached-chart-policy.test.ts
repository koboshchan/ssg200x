import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chartDisplayQuote,type ChartDisplayContext} from '../lib/chart-display-policy';
import {tickCandle} from '../lib/live-candle';
import {readFileSync} from 'node:fs';
const now=120_000;
const stock:ChartDisplayContext={kind:'stock',stockExecution:{executable:true,validUntil:now+10000}};
const crypto:ChartDisplayContext={kind:'crypto',cryptoStatus:{connected:true,heartbeatSubscribed:true,generation:'current',lastMessage:now-1000,leaseUntil:now+10000}};
const fx:ChartDisplayContext={kind:'forex'};
test('stocks retain valid original prints older than ten seconds, never beyond stock policy',()=>{
 const q={micro:123_000_000,at:now-30000};
 assert.equal(chartDisplayQuote(q,stock,now),q);
 assert.equal(tickCandle(undefined,chartDisplayQuote(q,stock,now)!,60000)?.time,60000);
 assert.equal(q.at,90000);
 assert.equal(chartDisplayQuote({...q,at:now-60000},stock,now),undefined);
 assert.equal(chartDisplayQuote(q,{kind:'stock',stockExecution:{executable:false,validUntil:now+10000}},now),undefined);
 assert.equal(chartDisplayQuote(q,{kind:'stock',stockExecution:{executable:true,validUntil:now}},now),undefined);
});
test('healthy crypto uses shared transport health, not per-symbol trade age',()=>{
 const q={micro:123_000_000,at:now-90000,cryptoGeneration:'current'};
 assert.equal(chartDisplayQuote(q,crypto,now),q);
 assert.equal(tickCandle(undefined,q,60000)?.time,0);
 assert.equal(chartDisplayQuote({...q,cryptoGeneration:'old'},crypto,now),undefined);
 assert.equal(chartDisplayQuote({...q,cryptoGeneration:undefined},crypto,now),undefined);
 for(const override of [{connected:false},{heartbeatSubscribed:false},{lastMessage:now-10001},{lastMessage:now+1},{leaseUntil:now}]){
  assert.equal(chartDisplayQuote(q,{kind:'crypto',cryptoStatus:{...crypto.cryptoStatus!,...override}},now),undefined);
 }
});
test('FX retains OANDA last native quote on its original timestamp, including closed sessions',()=>{
 const q={micro:145_000_000,at:0,source:'oanda'};
 assert.equal(chartDisplayQuote(q,fx,now),q);
 assert.equal(chartDisplayQuote({...q,source:'mock'},fx,now),undefined);
 assert.equal(chartDisplayQuote({...q,source:undefined},fx,now),undefined);
});
test('every display feed rejects corrupt or future original timestamps without replacing them',()=>{
 for(const [context,extra] of [[stock,{}],[crypto,{cryptoGeneration:'current'}],[fx,{source:'oanda'}]] as const){
  for(const at of [NaN,Infinity,-1,1.5,now+1,Number.MAX_SAFE_INTEGER+1]){
   const q={micro:100_000_000,at,...extra};
   assert.equal(chartDisplayQuote(q,context,now),undefined);
   assert.ok(Object.is(q.at,at));
  }
  for(const micro of [NaN,Infinity,0,-1,1.5])assert.equal(chartDisplayQuote({micro,at:now,...extra},context,now),undefined);
  assert.equal(chartDisplayQuote({micro:100,at:now,...extra,source:'wrong-feed'},context,now),undefined);
 }
});
test('chart keeps monotonic tick guard and original timestamp; caller supplies metadata',()=>{
 const chart=readFileSync('app/cached-chart.tsx','utf8');
 assert.match(chart,/chartDisplayQuote\(q,display\.current,Date\.now\(\)\)/);
 assert.match(chart,/q\.at<lastAt/);
 assert.match(chart,/tickCandle\(live\.get\(time\)\?\?chartCache\.get\(cacheKey\)\?\.rows\.find\(row=>row\.time===time\),q,width\)/);
 assert.doesNotMatch(chart,/at:\s*Date\.now\(/);
 assert.match(readFileSync('app/finance-client.tsx','utf8'),/displayContext=/);
});
