import test from "node:test";
import assert from "node:assert/strict";
import {freshRoom,register} from "../lib/poker";
import {spot,redeemLegacyHolding,netPnl,openPosition,closePosition} from "../lib/finance";
import {sellAllSpot} from "../lib/spot-sell-all";
import {tradingMetric,tradingSnapshot,tradingPerformance,PERFORMANCE_PERIODS,type TradingSnapshot} from "../lib/trading-performance";
const who={id:"private-id",name:"Alice",email:"private@test.test",admin:false};
const now=40*86400_000;
function fixture(){const r=freshRoom();register(r,who,now);r.quotes={BTC:{micro:100_000_000,at:now,cryptoGeneration:"test"}};r.cryptoStatus={connected:true,heartbeatSubscribed:true,generation:"test",lastMessage:now,leaseUntil:now+10000};return r;}
function sample(at:number,pnl=0,capital=1000):TradingSnapshot{return {publicId:"0123456789abcdef",at,bucket:Math.floor(at/60_000),expiresAt:new Date(at+32*86400_000),pnl,capital};}
function history(duration:number,offset=0){return Array.from({length:duration/60_000+1},(_,i)=>sample(now-duration-offset+i*60_000));}
test("real baseline exact boundaries for all four windows; no invented precollection history",()=>{
 for(const [period,duration] of PERFORMANCE_PERIODS){
  const out=tradingPerformance(sample(now,100),history(duration));
  assert.deepEqual(out.periods.find(p=>p.period===period),{period,pnl:100,percent:10});
 }
 assert.ok(tradingPerformance(sample(now),[]).periods.every(p=>p.pnl===null&&p.reason==="baseline_unavailable"));
});
test("baseline at or before boundary, inclusive two-minute tolerance, gaps never interpolate",()=>{
 const h=history(3600_000);
 assert.equal(tradingPerformance(sample(now,100),h.slice(1)).periods[0].reason,"baseline_unavailable");
 assert.equal(tradingPerformance(sample(now,100),history(3600_000,120_000)).periods[0].pnl,100);
 assert.equal(tradingPerformance(sample(now,100),[sample(now-3600_000-120_001),...history(3600_000).slice(1)]).periods[0].reason,"baseline_unavailable");
 h.splice(10,3);
 assert.equal(tradingPerformance(sample(now),h).periods[0].reason,"snapshot_gap");
 assert.equal(tradingPerformance(sample(now),history(3600_000).slice(0,-3)).periods[0].reason,"snapshot_gap");
});
test("zero trading capital has absolute PnL but no percentage; no cash networth denominator",()=>{
 const h=history(3600_000);h[0].capital=0;
 assert.deepEqual(tradingPerformance(sample(now,123),h).periods[0],{period:"1h",pnl:123,percent:null,reason:"zero_baseline_capital"});
});
test("invalid valuations and unrelated or future samples cannot fill a baseline",()=>{
 const h=history(3600_000);h[10].pnl=null;
 assert.equal(tradingPerformance(sample(now),h).periods[0].reason,"valuation_unavailable");
 assert.equal(tradingPerformance({...sample(now),pnl:null},[]).periods[0].reason,"valuation_unavailable");
 assert.equal(tradingPerformance(sample(now),[...history(3600_000).map(s=>({...s,publicId:"other"})),sample(now+1)]).periods[0].reason,"baseline_unavailable");
});
test("normal partial spot sales and exact full sales preserve PnL without double counting",()=>{
 const r=fixture(),m=r.members[0];
 spot(r,who,"BTC","buy",1000,now);
 assert.deepEqual(tradingMetric(r,m,now),{pnl:0,capital:1000});
 r.quotes!.BTC!.micro=200_000_000;
 assert.equal(tradingMetric(r,m,now).pnl,1000);
 spot(r,who,"BTC","sell",1000,now);
 assert.equal(m.realizedSpotPnl,500);
 assert.deepEqual(tradingMetric(r,m,now),{pnl:1000,capital:500});
 sellAllSpot(r,who,"BTC",now);
 assert.deepEqual(tradingMetric(r,m,now),{pnl:1000,capital:0});
 assert.equal(m.realizedSpotPnl,1000);
});
test("legacy redemption moves spot unrealized into cumulative realized including losses",()=>{
 const r=fixture(),m=r.members[0];
 r.marketSymbols={crypto:[],stocks:[],forex:[],delisted:["BTC"],revision:1};
 m.holdings=[{symbol:"BTC",units:10_000_000,cost:1500}];
 assert.equal(tradingMetric(r,m,now).pnl,-500);
 redeemLegacyHolding(r,who,"BTC",now);
 assert.equal(m.realizedSpotPnl,-500);assert.equal(tradingMetric(r,m,now).pnl,-500);
});
test("perps metric uses fee-net unrealized and closed realized including liquidation",()=>{
 const r=fixture(),m=r.members[0];
 r.perpOpeningFeePpm=1000;r.perpClosingFeePpm=1000;
 openPosition(r,who,"BTC","long",1000,2,"p1",now);
 const p=m.positions![0],metric=tradingMetric(r,m,now);
 assert.equal(metric.capital,1000);assert.equal(metric.pnl,netPnl(p,r.quotes!.BTC!.micro));assert.ok(metric.pnl<0);
 closePosition(r,who,"p1",now);
 assert.equal(tradingMetric(r,m,now).pnl,m.closedPositions![0].realizedPnl);
 openPosition(r,who,"BTC","long",1000,2,"p2",now);
 r.quotes!.BTC!.micro=1;
 closePosition(r,who,"p2",now);
 assert.equal(tradingMetric(r,m,now).pnl,m.closedPositions!.reduce((s,p)=>s+p.realizedPnl,0));
});
test("wallet cashflows, games, adjustments and prediction values never change trading PnL",()=>{
 const r=fixture(),m=r.members[0],baseline=tradingMetric(r,m,now);
 m.wallet+=99999999;m.adjustments=100000;m.spins=[{id:"spin",number:1,stake:100,returned:3600,at:now}];
 r.house=500000;r.issuance=1000000;
 assert.deepEqual(tradingMetric(r,m,now),baseline);
});
test("stale, future or missing live marks unavailable, never cost fallback; snapshot is readonly",()=>{
 const r=fixture(),m=r.members[0];spot(r,who,"BTC","buy",1000,now);
 const before=structuredClone(r);tradingSnapshot(r,m,now);assert.deepEqual(r,before);
 for(const at of [now-10001,now+1]){
  r.cryptoStatus!.lastMessage=at;assert.equal(tradingSnapshot(r,m,now).pnl,null);
 }
 r.cryptoStatus!.lastMessage=now;
 r.quotes!.BTC!.at=now+1;assert.equal(tradingSnapshot(r,m,now).pnl,null);
 r.quotes!.BTC!.at=now;
 delete r.quotes!.BTC;assert.equal(tradingSnapshot(r,m,now).pnl,null);
});
test("fresh account empty trades yields measured zero, existing realized offset cancels prospectively",()=>{
 const r=fixture(),m=r.members[0];assert.deepEqual(tradingMetric(r,m,now),{pnl:0,capital:0});
 const h=history(3600_000);for(const s of h)s.pnl=123456;
 assert.equal(tradingPerformance(sample(now,123556),h).periods[0].pnl,100);
});
