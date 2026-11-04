import {test} from "node:test";
import assert from "node:assert/strict";
import {freshRoom,register} from "../lib/poker";
import {casinoLimits} from "../lib/casino-limits";
import {adminCasinoSnapshot,changeCasinoLimits} from "../lib/admin-casino-limits";
import {MIN_HOUSE_EDGE_BPS,MAX_HOUSE_EDGE_BPS} from "../lib/house-edge";
const admin={id:"a",name:"Admin",email:"a@test",admin:true},user={id:"u",name:"User",email:"u@test",admin:false};
const setup=()=>{const r=freshRoom();register(r,admin,0);register(r,user,0);return r;};
const base=(r:ReturnType<typeof freshRoom>,extra:object={})=>({rouletteMaxTotal:100000,blackjackMaxHand:100000,expectedVersion:casinoLimits(r).revision,...extra});
test("house edge defaults to 0 and bounds are -1000..1000",()=>{
 assert.equal(MIN_HOUSE_EDGE_BPS,-1000);assert.equal(MAX_HOUSE_EDGE_BPS,1000);
 const r=setup();assert.equal(casinoLimits(r).houseEdgeBps,0);
 assert.equal(adminCasinoSnapshot(r,admin).casinoLimits.houseEdgeBps,0);
 r.casinoLimits={...casinoLimits(r),houseEdgeBps:5000};assert.equal(casinoLimits(r).houseEdgeBps,0);
});
test("admin only, persisted, audited, and omitted field preserves value",()=>{
 const r=setup();
 assert.throws(()=>changeCasinoLimits(r,user,base(r,{houseEdgeBps:100}) as never),/Administrator/);
 assert.equal(casinoLimits(r).revision,0);
 changeCasinoLimits(r,admin,base(r,{houseEdgeBps:-1000}) as never);
 assert.equal(casinoLimits(structuredClone(r)).houseEdgeBps,-1000);assert.equal(casinoLimits(r).revision,1);
 assert.equal(r.auditPending!.at(-1)!.what,"casino-limits");
 changeCasinoLimits(r,admin,base(r) as never);assert.equal(casinoLimits(r).houseEdgeBps,-1000);
 changeCasinoLimits(r,admin,base(r,{houseEdgeBps:1000}) as never);assert.equal(casinoLimits(r).houseEdgeBps,1000);
 changeCasinoLimits(r,admin,base(r,{houseEdgeBps:0}) as never);assert.equal(casinoLimits(r).houseEdgeBps,0);
});
test("invalid edge values rejected without mutation; stale revision rejected",()=>{
 for(const v of [1001,-1001,0.5,NaN,Infinity,"100",null,Number.MAX_SAFE_INTEGER]){
  const r=setup(),before=structuredClone(r);
  assert.throws(()=>changeCasinoLimits(r,admin,base(r,{houseEdgeBps:v}) as never),/basis points/);
  assert.deepEqual(r,before);
 }
 const r=setup();changeCasinoLimits(r,admin,base(r,{houseEdgeBps:100}) as never);
 assert.throws(()=>changeCasinoLimits(r,admin,{...base(r,{houseEdgeBps:200}),expectedVersion:0} as never),/changed/);
 assert.equal(casinoLimits(r).houseEdgeBps,100);
});
