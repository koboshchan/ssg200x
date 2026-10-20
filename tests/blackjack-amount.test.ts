import test from "node:test";
import assert from "node:assert/strict";
import {blackjackInputCents as c,isBlackjackInputText as ok} from "../lib/blackjack-amount";
test("blackjack cents exact",()=>{
 assert.equal(c("10"),1000);assert.equal(c("0.01"),1);assert.equal(c("1.1"),110);assert.equal(c("19.99"),1999);assert.equal(c("1000.00"),100000);assert.equal(c("0.29"),29);
 for(const b of ["","1.","1.234","1e3","1,5","-1",".5"," 1","１","1.0.0","+1"])assert.equal(c(b),null,b);
});
test("blackjack input text filter",()=>{
 for(const g of ["","1","1.","1.5","1.55",".5"])assert.ok(ok(g),g);
 for(const b of ["1.555","e","1e3","1,5","-","1..","a1"])assert.ok(!ok(b),b);
});
