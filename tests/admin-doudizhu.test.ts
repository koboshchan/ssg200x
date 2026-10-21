import {test} from "node:test";
import assert from "node:assert/strict";
import {freshRoom} from "../lib/poker";
import {adminDoudizhuSnapshot,changeDoudizhuMaxBeansPerDollar,doudizhuMaxBeansPerDollar,doudizhuBeansSchema} from "../lib/admin-doudizhu";
const admin={id:"a",name:"Admin",email:"a@test",admin:true};
const user={...admin,admin:false};
test("default maximum is 1000000 beans per dollar; reads and writes require admin",()=>{
 const r=freshRoom(),before=structuredClone(r);
 assert.equal(doudizhuMaxBeansPerDollar(r),1000000);
 assert.deepEqual(adminDoudizhuSnapshot(r,admin),{maxBeansPerDollar:1000000});
 assert.throws(()=>adminDoudizhuSnapshot(r,user),/Administrator/);
 assert.throws(()=>changeDoudizhuMaxBeansPerDollar(r,user,{maxBeansPerDollar:5,expectedMaxBeansPerDollar:1000000}),/Administrator/);
 assert.deepEqual(r,before);
});
test("strict schema rejects invalid bean ratios and unknown properties without mutation",()=>{
 for(const value of [0,-1,1.5,NaN,Infinity,1_000_000_000_001,"5",null,undefined]){
  for(const key of ["maxBeansPerDollar","expectedMaxBeansPerDollar"]){
   const r=freshRoom(),before=structuredClone(r);
   assert.throws(()=>changeDoudizhuMaxBeansPerDollar(r,admin,{maxBeansPerDollar:5,expectedMaxBeansPerDollar:1000000,[key]:value} as never));
   assert.deepEqual(r,before);
  }
 }
 assert.equal(doudizhuBeansSchema.safeParse({maxBeansPerDollar:5,expectedMaxBeansPerDollar:1000000,extra:true}).success,false);
});
test("bounded updates are durable and audited; stale edits fail and completed retries do not audit again",()=>{
 const r=freshRoom();
 changeDoudizhuMaxBeansPerDollar(r,admin,{maxBeansPerDollar:1,expectedMaxBeansPerDollar:1000000});
 assert.equal(doudizhuMaxBeansPerDollar(structuredClone(r)),1);
 assert.equal(r.auditPending?.length,1);
 assert.deepEqual([r.auditPending![0].old,r.auditPending![0].new],[1000000,1]);
 const before=structuredClone(r);
 changeDoudizhuMaxBeansPerDollar(r,admin,{maxBeansPerDollar:1,expectedMaxBeansPerDollar:1000000});
 assert.deepEqual(r,before);
 assert.throws(()=>changeDoudizhuMaxBeansPerDollar(r,admin,{maxBeansPerDollar:5,expectedMaxBeansPerDollar:1000000}),/changed/);
 assert.deepEqual(r,before);
 changeDoudizhuMaxBeansPerDollar(r,admin,{maxBeansPerDollar:1_000_000_000,expectedMaxBeansPerDollar:1});
 assert.equal(doudizhuMaxBeansPerDollar(r),1_000_000_000);
});
test("lowering maximum preserves waiting and active games, escrow and wallets",()=>{
 const r=freshRoom();
 // The setting must not inspect or rewrite any existing game's state.
 r.doudizhu=[{code:"waiting",phase:"waiting",base:50000,players:[{userId:"u",escrow:6400000}]},{code:"active",phase:"playing",base:100000000,players:[{userId:"v",escrow:12800000}]}] as unknown as NonNullable<typeof r.doudizhu>;
 const games=structuredClone(r.doudizhu),members=structuredClone(r.members);
 changeDoudizhuMaxBeansPerDollar(r,admin,{maxBeansPerDollar:1,expectedMaxBeansPerDollar:1000000});
 assert.deepEqual(r.doudizhu,games);assert.deepEqual(r.members,members);
});
