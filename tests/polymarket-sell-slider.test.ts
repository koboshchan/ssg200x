import {test} from "node:test";
import assert from "node:assert/strict";
import {sharesAtPercent,percentOfShares} from "../lib/polymarket-sell-slider";
test("100% preserves the exact holding without dust",()=>{
 for(const held of [0.000001,17.123456,99999.999999,1.000001])assert.equal(sharesAtPercent(held,100),held);
});
test("partial snaps truncate to micros and never oversell",()=>{
 for(const p of [0,25,50,75,100]){
 const shares=sharesAtPercent(17.123457,p);
 assert(shares<=17.123457);assert.equal(Math.round(shares*1e6),shares*1e6);
 assert(Math.abs(percentOfShares(17.123457,shares)-p)<0.00001);
 }
 assert.equal(sharesAtPercent(0,100),0);
 assert.equal(percentOfShares(0,12),0);
 assert.equal(percentOfShares(10,20),100);
 assert.equal(sharesAtPercent(0.000001,25),0);
});
