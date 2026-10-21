import {test} from "node:test";
import assert from "node:assert/strict";
import {setLimits} from "../lib/admin";
import {freshRoom,register,assertRoom} from "../lib/poker";
import {spot,openPosition} from "../lib/finance";
import {sellAllSpot} from "../lib/spot-sell-all";
import {financeSchema} from "../lib/finance-input";
import {validTradeLimit} from "../lib/trade-limit";
const admin={id:"admin",name:"Admin",email:"admin@test",admin:true};
test("admin can save positive cent caps above a million with audited finite-safe validation",()=>{
 const r=freshRoom();register(r,admin);
 for(const n of [.01,1,1_000_000.01,25_000_000,1_000_000_000]){
  setLimits(r,admin,n,200);assert.equal(r.limits!.maxTrade,n);
 }
 for(const n of [0,-1,NaN,Infinity,-Infinity,.001,1.001,Number.MAX_VALUE,Number.MAX_SAFE_INTEGER]){
  const old=structuredClone(r);assert.equal(validTradeLimit(n),false);
  assert.throws(()=>setLimits(r,admin,n,200));assert.deepEqual(r,old);
 }
 assert.throws(()=>setLimits(r,{...admin,admin:false},25_000_000,200));
 assert.equal(r.auditPending!.at(-1)!.what,"trading-limits");
});
test("saved cap alone gates funded large spot orders, sell-all and perps; lowered limits still block",()=>{
 const r=Object.assign(freshRoom(),{perpFeePpm:0}),m=register(r,admin);
 m.wallet+=500_000_000;m.adjustments=500_000_000;r.issuance=(r.issuance||0)+500_000_000;
 r.quotes={BTC:{micro:100_000_000_000,at:Date.now()}};
 setLimits(r,admin,3_000_000,200);
 spot(r,admin,"BTC","buy",200_000_000);
 assert.throws(()=>spot(r,admin,"BTC","buy",300_000_001),/host/);
 setLimits(r,admin,1_000_000,200);
 assert.throws(()=>sellAllSpot(r,admin,"BTC"),/host/);
 setLimits(r,admin,3_000_000,200);sellAllSpot(r,admin,"BTC");
 openPosition(r,admin,"BTC","long",200_000_000,1,"large");
 assert.throws(()=>openPosition(r,admin,"BTC","long",160_000_000,2,"notional"),/host/);
 setLimits(r,admin,1_000_000,200);
 assert.throws(()=>openPosition(r,admin,"BTC","long",100_000_001,1,"lowered"),/host/);
 assertRoom(r);
 const input={type:"spot",requestId:crypto.randomUUID(),requestAt:Date.now(),symbol:"BTC",side:"buy",amount:200_000_000};
 assert.equal(financeSchema.safeParse(input).success,true);
 for(const amount of [Infinity,Number.MAX_SAFE_INTEGER+1,100.5])assert.equal(financeSchema.safeParse({...input,amount}).success,false);
});
