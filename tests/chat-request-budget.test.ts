import test from "node:test";
import assert from "node:assert/strict";
import {createRequestBudget,MAX_FAILURES,retryDelay} from "../lib/chat-request-budget";
test("fake clock sustained structured ACK rate limit stops at exactly four network attempts",async()=>{
 let clock=1,calls=0;const b=createRequestBudget(()=>clock,()=>.5);
 const transport=async()=>{calls++;return {ok:false,error:"rate_limited"};};
 for(let i=0;i<MAX_FAILURES;i++){
  await assert.rejects(b.request("a","keys:get",{},transport),/rate_limited/);
  const delay=b.status("a").until-clock,base=1000*2**i;
  assert.ok(delay>=base&&delay<=base*1.25);
  // Simulate effect rerenders and new clients sharing the same account coordinator.
  for(let j=0;j<100;j++)await assert.rejects(b.request("a","keys:get",{},transport),/rate_limited/);
  assert.equal(calls,i+1);clock=b.status("a").until;
 }
 clock+=100000;
 for(let i=0;i<100;i++)await assert.rejects(b.request("a","keys:get",{},transport),/rate_limited/);
 assert.equal(calls,4);assert.equal(b.status("a").stopped,true);
 b.reset("a");await assert.rejects(b.request("a","keys:get",{},transport));assert.equal(calls,5);
});
test("retryAfter explicit units and legacy seconds honored, manual retry cannot bypass cooldown",async()=>{
 for(const [value,unit,want] of [[30,undefined,30000],[5000,"ms",5000],[120,"seconds",120000]] as const){
  let clock=1,calls=0;const b=createRequestBudget(()=>clock,()=>0);
  const transport=async()=>{calls++;throw Object.assign(Error("rate_limited"),{retryAfter:value,retryAfterUnit:unit});};
  await assert.rejects(b.request("u","keys:get",{},transport));
  assert.equal(b.status("u").until-clock,want);b.reset("u");
  await assert.rejects(b.request("u","keys:get",{},transport));assert.equal(calls,1);
 }
 assert.equal(retryDelay("bad","ms"),0);
});
test("one in-flight transport across owners and unrelated accounts remain isolated",async()=>{
 const b=createRequestBudget(()=>1,()=>0);let finish!:(x:unknown)=>void,calls=0;
 const t=async()=>{calls++;return new Promise(r=>finish=r);};
 const first=b.request("a","keys:get",{},t);
 await assert.rejects(b.request("a","keys:get",{},t),/busy/);assert.equal(calls,1);
 assert.deepEqual(await b.request("other","keys:get",{},async()=>({ok:true})),{ok:true});
 finish({ok:true});await first;assert.equal(b.status("a").flight,undefined);
});
