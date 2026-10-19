import {SYMBOLS} from "../lib/market-shared";
import {test} from "node:test";
import assert from "node:assert/strict";
import {pollingInterval,decodeRates} from "../lib/price-policy";
import {freshRoom,register} from "../lib/poker";
test("idle REST budget1/s and open perps budget5/s across all symbols",()=>{const r=freshRoom();assert.equal(pollingInterval(r),1000);const m=register(r,{id:"a",name:"A",email:"a@test",admin:true});m.positions=[{id:"p",symbol:"BTC",side:"long",entry:1e11,margin:1000,leverage:5,opened:0}];assert.equal(pollingInterval(r),200);});
test("single batched USD rates invert to USD-per-coin micro values",()=>{const q=decodeRates({data:{currency:"USD",rates:{...Object.fromEntries(SYMBOLS.map(s=>[s,"1"])),BTC:"0.00001",ETH:"0.0005",SOL:"0.01",DOGE:"10"}}},123);assert.equal(q.BTC.micro,100_000_000_000);assert.equal(q.DOGE.micro,100_000);assert.equal(q.SOL.at,123);assert.throws(()=>decodeRates({data:{currency:"USD",rates:{BTC:0}}},123));});
