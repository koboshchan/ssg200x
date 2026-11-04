import test from "node:test";
import assert from "node:assert/strict";
import {MIN_HOUSE_EDGE_BPS,MAX_HOUSE_EDGE_BPS,validHouseEdgeBps,houseEdgeBps,edgeRatio,rationalPayout} from "../lib/house-edge";
import {freshRoom} from "../lib/poker";

test("edge bounds, missing settings and strict basis points",()=>{
 const r=freshRoom();assert.equal(houseEdgeBps(r),0);
 assert.equal(MIN_HOUSE_EDGE_BPS,-1000);assert.equal(MAX_HOUSE_EDGE_BPS,1000);
 for(const v of [-1000,-1,0,200,1000])assert.ok(validHouseEdgeBps(v));
 for(const v of [-1001,1001,.1,NaN,Infinity,"0",null,undefined])assert.equal(validHouseEdgeBps(v),false);
 assert.deepEqual(edgeRatio(-1000),{num:11000,den:10000});
 assert.deepEqual(edgeRatio(0),{num:10000,den:10000});
 assert.deepEqual(edgeRatio(200),{num:9800,den:10000});
 assert.throws(()=>edgeRatio(1001));
});

test("unbiased cent rounding has exact rational mean over every accepted ticket",()=>{
 for(const bps of [-1000,0,200]){
  const {num,den}=edgeRatio(bps);
  // 2 bytes produce 65536 tickets; rejection drops 60000..65535 for d=10000.
  let sum=0;
  for(let ticket=0;ticket<60000;ticket++){
   const bytes=[Math.floor(ticket/256),ticket%256];let at=0;
   const p=rationalPayout(103,num,den,()=>bytes[at++]);
   assert.ok(Number.isSafeInteger(p)&&p>=0);sum+=p;
  }
  assert.equal(BigInt(sum)*BigInt(den),60000n*103n*BigInt(num));
 }
});
test("rounding is once only, rejects biased tail and never uses randomness for exact amounts",()=>{
 assert.equal(rationalPayout(100,2,1,()=>{throw Error("unneeded");}),200);
 const bytes=[255,255,0,0];let at=0;
 assert.equal(rationalPayout(1,1,10000,()=>bytes[at++]),1);
 assert.equal(at,4);
 assert.equal(rationalPayout(1,1,10000,()=>1),0);
});
test("invalid or overflowing payout cannot mutate a ledger",()=>{
 for(const [bet,n,d] of [[-1,1,1],[.5,1,1],[100,-1,1],[100,1,0],[100,1.5,2],[100,NaN,1],[Number.MAX_SAFE_INTEGER,2,1]]){
  assert.throws(()=>rationalPayout(bet,n,d));
 }
 assert.equal(rationalPayout(0,1,1),0);
 assert.throws(()=>rationalPayout(1,1,3,()=>256));
});
