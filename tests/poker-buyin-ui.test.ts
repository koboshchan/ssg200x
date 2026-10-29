import {test} from "node:test";
import assert from "node:assert/strict";
import {pokerBuyInRange,defaultPokerBuyInDollars,pokerBuyInStatus} from "../lib/poker-buyin-ui";
test("per-table ranges are 20-100 big blinds",()=>{
 assert.deepEqual(pokerBuyInRange("01"),{min:4000,max:20000});
 assert.deepEqual(pokerBuyInRange("02"),{min:40000,max:200000});
 assert.deepEqual(pokerBuyInRange("03"),{min:200000,max:1000000});
});
test("default buy-in is the table max and resets per table",()=>{
 assert.equal(defaultPokerBuyInDollars("01"),"200");
 assert.equal(defaultPokerBuyInDollars("02"),"2000");
 assert.equal(defaultPokerBuyInDollars("03"),"10000");
});
test("wallet-bound status disables join until affordable",()=>{
 assert.equal(pokerBuyInStatus("02",200000,500000).ok,true);
 assert.equal(pokerBuyInStatus("02",200000,100000).ok,false);
 assert.equal(pokerBuyInStatus("02",30000,500000).ok,false);
 assert.equal(pokerBuyInStatus("02",200100,500000).ok,false);
 assert.equal(pokerBuyInStatus("03",null,500000).ok,false);
 assert.match(pokerBuyInStatus("03",1000000,150000).hint,/at least \$2000/);
 assert.match(pokerBuyInStatus("02",200000,100000).hint,/wallet has \$1000/);
 assert.equal(pokerBuyInStatus("01",4000,4000).ok,true);
});
