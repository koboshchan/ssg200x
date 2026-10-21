import test from "node:test";
import assert from "node:assert/strict";
import {PendingFinanceController} from "../lib/pending-finance";
import {freshRoom} from "../lib/poker";
import {checkFinanceRequest,financeFingerprint,reconcileFinanceRequest,recordFinanceRequest} from "../lib/finance-requests";
const input={type:"close",positionId:"position",requestId:"key",requestAt:1000};
test("fingerprint is stable across object key order, binds timestamp and nested payload",()=>{
 assert.equal(financeFingerprint(input),financeFingerprint({...input}));
 assert.notEqual(financeFingerprint(input),financeFingerprint({...input,requestAt:1001}));
 assert.equal(financeFingerprint({...input,nested:{b:2,a:1}}),financeFingerprint({...input,nested:{a:1,b:2}}));
});
test("committed receipt acknowledges original key after execution expiry; cancellation fences late arrivals",()=>{
 const r=freshRoom();recordFinanceRequest(r,"user",input,"committed",1000);
 assert.equal(checkFinanceRequest(r,"user",input,150000),true);
 assert.throws(()=>checkFinanceRequest(r,"user",{...input,positionId:"different"},150000),/different order/);
 const other={...input,requestId:"other"};assert.equal(reconcileFinanceRequest(r,"user",other,1000),"cancelled");
 assert.throws(()=>checkFinanceRequest(r,"user",other,1001),/cancelled/);
});
test("old absent receipt reports uncertain expired state consistently and cannot be resubmitted",()=>{
 const r=freshRoom(),now=2*24*60*60*1000;
 assert.equal(reconcileFinanceRequest(r,"user",input,now),"expired");
 assert.equal(reconcileFinanceRequest(r,"user",input,now+1000),"expired");
 assert.throws(()=>checkFinanceRequest(r,"user",input,now+1000));
});
const storage=()=>{const m=new Map<string,string>();return {getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v);},removeItem:(k:string)=>{m.delete(k);}};};
const wait=async(check:()=>boolean)=>{for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,1));}assert.fail("not settled");};
test("offline/connecting blocks all submits and recovery retries failed status without resubmitting",async()=>{
 const saved=storage();saved.setItem("key",JSON.stringify(input));let posts=0,allow=false;
 const c=new PendingFinanceController({storage:saved,key:"key",headers:()=>({}),room:()=>{},change:()=>{},fetch:async(path)=>{
  if(path==="/api/finance"){posts++;throw new Error("should not submit");}
  if(!allow)throw new Error("down");return Response.json({outcome:"cancelled",room:{}});
 }});
 await c.submit({},1000);assert.equal(posts,0);
 c.connection(true);await wait(()=>!c.working);assert.equal(c.ready,false);assert.ok(c.pending);
 allow=true;await c.sync();assert.equal(c.ready,true);assert.equal(c.pending,null);assert.equal(posts,0);
});
test("storage failures fail closed before sending; a later successful check recovers",async()=>{
 let fail=false,posts=0;const saved=storage();
 const c=new PendingFinanceController({storage:{...saved,setItem:(k,v)=>{if(fail)throw new Error("storage full");saved.setItem(k,v);}},key:"key",headers:()=>({}),room:()=>{},change:()=>{},fetch:async(path)=>{if(path==="/api/finance")posts++;return Response.json({});}});
 c.connection(true);await wait(()=>c.ready);fail=true;await c.submit({},1000);
 assert.equal(posts,0);assert.equal(c.pending,null);assert.match(c.error,/storage full/);
 fail=false;await c.sync();assert.equal(c.ready,true);
});
test("malformed persisted intent never silently clears or submits a fresh order",async()=>{
 const saved=storage();saved.setItem("key","not json");let requests=0;
 const c=new PendingFinanceController({storage:saved,key:"key",headers:()=>({}),room:()=>{},change:()=>{},fetch:async()=>{requests++;return Response.json({});}});
 c.connection(true);await wait(()=>!c.working);assert.equal(c.ready,false);assert.equal(requests,0);assert.equal(saved.getItem("key"),"not json");
});
