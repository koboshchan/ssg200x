import test from "node:test";
import assert from "node:assert/strict";
import {freshRoom} from "../lib/poker";
import {spot,openPosition,redeemLegacyHolding,closePosition,assetsBook,assetsMarket,legacyQuote} from "../lib/finance";
import {SYMBOLS,DELISTED_SYMBOLS,type Symbol} from "../lib/market-shared";
import {applyMarketTick} from "../lib/market-tick";
import {editPositionTriggers} from "../lib/position-triggers";
import {publicRoom} from "../lib/public";
const who={id:"u",name:"User",email:"user@example.com",admin:false};
const now=Date.now();
function fixture(symbol:Symbol){
 const r=freshRoom();
 r.members=[{...who,publicId:"pub",approved:true,wallet:100000,joined:0,holdings:[{symbol,units:100000000000,cost:100}],positions:[{id:"old",symbol,side:"long",entry:10,margin:1000,leverage:2,opened:0,takeProfit:11}],closedPositions:[]}];
 r.quotes={[symbol]:{micro:12,at:now-86400000}};return r;
}
const total=(r:ReturnType<typeof freshRoom>)=>r.members.reduce((n,m)=>n+m.wallet+assetsBook(m),r.house||0);
test("crypto discovery is exactly the approved six and legacy set contains all fourteen",()=>{
 assert.deepEqual(SYMBOLS,["BTC","ETH","BNB","XRP","SOL","LTC"]);
 assert.deepEqual(DELISTED_SYMBOLS,["ZEC","HYPE","DOGE","LINK","ADA","NEAR","XLM","BCH","UNI","AVAX","SUI","HBAR","TAO","SHIB"]);
});
for(const symbol of DELISTED_SYMBOLS){
 test(symbol+" rejects all stale-client order paths without mutating claims",()=>{
  for(const action of [(r:ReturnType<typeof fixture>)=>spot(r,who,symbol,"buy",100,now),(r:ReturnType<typeof fixture>)=>spot(r,who,symbol,"sell",100,now),(r:ReturnType<typeof fixture>)=>openPosition(r,who,symbol,"long",100,2,"new",now),(r:ReturnType<typeof fixture>)=>editPositionTriggers(r,who,"old",{takeProfit:15})]){
   const r=fixture(symbol),before=structuredClone(r);assert.throws(()=>action(r),/delisted/i);assert.deepEqual(r,before);
  }
 });
 test(symbol+" ignores new ticks, liquidation and automatic triggers, retaining original cache",()=>{
  const r=fixture(symbol),before=structuredClone(r);
  for(const micro of [1,30])applyMarketTick(r,{[symbol]:{micro,at:now}},now);
  assert.deepEqual(r,before);
 });
 test(symbol+" manual redemption and position close conserve claims and cannot pay twice",()=>{
  const r=fixture(symbol),before=total(r),m=r.members[0];
  const result=redeemLegacyHolding(r,who,symbol,now);assert.equal(result.returned,1);assert.equal(result.quote.at,now-86400000);assert.equal(total(r),before);
  closePosition(r,who,"old",now);assert.equal(m.closedPositions![0].exit,12);assert.equal(m.closedPositions![0].realizedPnl,400);assert.equal(total(r),before);
  const after=structuredClone(r);assert.throws(()=>redeemLegacyHolding(r,who,symbol,now));assert.throws(()=>closePosition(r,who,"old",now));assert.deepEqual(r,after);
 });
 test(symbol+" missing or invalid USD cache retains all funds with explicit pending valuation",()=>{
  for(const q of [undefined,{micro:0,at:now-1},{micro:-1,at:now-1},{micro:NaN,at:now-1},{micro:Infinity,at:now-1},{micro:1e14,at:now-1},{micro:12,at:now+86400000},{micro:12,at:-1},{micro:12,at:NaN},{micro:12,at:0.5}]){
   const r=fixture(symbol);r.quotes={[symbol]:q};const before=structuredClone(r);
   assert.equal(legacyQuote(r,symbol,now),null);
   assert.throws(()=>redeemLegacyHolding(r,who,symbol,now),/claim is retained/);
   assert.throws(()=>closePosition(r,who,"old",now),/claim is retained/);
   assert.deepEqual(r,before);assert.equal(assetsMarket(r,r.members[0]),1100);
   const p=publicRoom(r,who),a=p.legacyAssets.find(a=>a.symbol===symbol)!;
   assert.equal(a.status,"pending-valuation");assert.equal(a.quote,null);assert.equal(p.holdings[0].symbol,symbol);assert.equal(p.positions[0].symbol,symbol);
  }
 });
 test(symbol+" explicit cached valuation exposes original timestamp without mutating persisted history",()=>{
  const r=fixture(symbol),before=structuredClone(r),p=publicRoom(r,who),a=p.legacyAssets.find(a=>a.symbol===symbol)!;
  assert.equal(a.status,"delisted-cached");assert.deepEqual(a.quote,r.quotes![symbol]);
  // Public normalization initializes optional member arrays, but must retain asset claims/history.
  assert.deepEqual(r.members[0].holdings,before.members[0].holdings);assert.deepEqual(r.members[0].positions,before.members[0].positions);assert.deepEqual(r.quotes,before.quotes);
 });
}
