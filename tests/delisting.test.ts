import test from "node:test";
import assert from "node:assert/strict";
import {freshRoom} from "../lib/poker";
import {spot,openPosition,redeemLegacyHolding,closePosition,assetsBook,assetsMarket,legacyQuote} from "../lib/finance";
import {SYMBOLS} from "../lib/market-shared";
import {applyMarketTick} from "../lib/market-tick";
import {publicRoom} from "../lib/public";
const who={id:"u",name:"User",email:"user@example.com",admin:false};
const now=Date.now();
function fixture(){
 const r=freshRoom();
 r.members=[{...who,publicId:"pub",approved:true,wallet:100000,joined:0,holdings:[{symbol:"SHIB",units:100000000000,cost:100}],positions:[{id:"old",symbol:"SHIB",side:"long",entry:10,margin:1000,leverage:2,opened:0,takeProfit:11}]}];
 r.quotes={SHIB:{micro:12,at:now-86400000}};
 return r;
}
test("SHIB leaves active market discovery",()=>{
 assert.ok(!(SYMBOLS as readonly string[]).includes("SHIB"));
});
test("reject stale-client new SHIB orders without financial writes",()=>{
 for(const run of [(r:ReturnType<typeof fixture>)=>spot(r,who,"SHIB","buy",100,now),(r:ReturnType<typeof fixture>)=>openPosition(r,who,"SHIB","long",100,2,"new",now)]){
  const r=fixture(),before=structuredClone(r);assert.throws(()=>run(r),/delisted/);assert.deepEqual(r,before);
 }
});
test("feed cannot overwrite legacy settlement quote or automatically close old position",()=>{
 const r=fixture(),before=structuredClone(r);
 applyMarketTick(r,{SHIB:{micro:30,at:now}},now);
 assert.deepEqual(r,before);
});
test("redeem entire legacy quantity once, preserving wallet plus house plus book claims",()=>{
 const r=fixture(),m=r.members[0],before=m.wallet+(r.house||0)+assetsBook(m);
 const result=redeemLegacyHolding(r,who,"SHIB",now);
 assert.equal(result.returned,1);assert.equal(result.quote.at,now-86400000);
 assert.equal(m.holdings!.length,0);assert.equal(m.wallet,100001);
 assert.equal(m.wallet+(r.house||0)+assetsBook(m),before);
 const after=structuredClone(r);assert.throws(()=>redeemLegacyHolding(r,who,"SHIB",now));assert.deepEqual(r,after);
});
test("manual legacy position close uses persisted quote and conserves isolated margin accounting",()=>{
 const r=fixture(),m=r.members[0],before=m.wallet+(r.house||0)+assetsBook(m);
 closePosition(r,who,"old",now);
 assert.equal(m.positions!.length,0);assert.equal(m.closedPositions![0].exit,12);
 assert.equal(m.closedPositions![0].realizedPnl,400);
 assert.equal(m.wallet+(r.house||0)+assetsBook(m),before);
 const after=structuredClone(r);assert.throws(()=>closePosition(r,who,"old",now));assert.deepEqual(r,after);
});
test("missing, future or corrupt valuation preserves claims and performs no financial writes",()=>{
 for(const q of [undefined,{micro:0,at:now-1},{micro:12,at:now+86400000},{micro:NaN,at:now-1},{micro:12,at:-1}]){
  const r=fixture();r.quotes={SHIB:q};const before=structuredClone(r);
  assert.equal(legacyQuote(r,"SHIB",now),null);
  assert.throws(()=>redeemLegacyHolding(r,who,"SHIB",now),/claim is retained/);
  assert.throws(()=>closePosition(r,who,"old",now),/claim is retained/);
  assert.deepEqual(r,before);assert.equal(assetsMarket(r,r.members[0]),1100);
 }
});
test("public portfolio retains legacy positions and holdings with explicit pending valuation",()=>{
 const r=fixture();r.quotes={};
 const result=publicRoom(r,who);
 assert.equal(result.holdings[0].symbol,"SHIB");assert.equal(result.positions[0].symbol,"SHIB");
 const legacy=result.legacyAssets.find(a=>a.symbol==="SHIB")!;
 assert.equal(legacy.status,"pending-valuation");
 assert.equal(legacy.quote,null);
});
