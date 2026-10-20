import test from "node:test";
import assert from "node:assert/strict";
import {createClerkReads} from "../runtime/clerk-reads.mjs";
test("many tabs share one in-flight profile batch, cache expires and names eventually refresh",async()=>{
 let now=1000,calls=0,generation="One";
 const reads=createClerkReads({now:()=>now});
 const clerk:any={users:{getUserList:async({userId}:any)=>{calls++;await Promise.resolve();return {data:userId.map((id:string)=>({id,firstName:generation}))};}}};
 const results=await Promise.all(Array.from({length:40},(_,i)=>reads.profiles(clerk,["alice","bob","user"+i])));
 assert.equal(calls,1);assert.equal(results[0][0]?.firstName,"One");
 generation="Two";now=5999;assert.equal((await reads.profiles(clerk,["alice"]))[0]?.firstName,"One");
 now=6000;assert.equal((await reads.profiles(clerk,["alice"]))[0]?.firstName,"Two");assert.equal(calls,2);
});
test("429 honors SDK retryAfter and shares one bounded retry across callers",async()=>{
 let now=1000,calls=0;const waits:number[]=[];
 const reads=createClerkReads({now:()=>now,sleep:async ms=>{waits.push(ms);now+=ms;}});
 const clerk:any={users:{getUser:async()=>{calls++;if(calls===1)throw {status:429,retryAfter:1};return {id:"a",privateMetadata:{admin:true}};}}};
 await Promise.all(Array.from({length:30},()=>reads.user(clerk,"a")));
 assert.equal(calls,2);assert.deepEqual(waits,[1000]);
});
test("failures never extend a stale admin grant, long cooldown does not retry",async()=>{
 let now=1000,calls=0,fail=false;
 const reads=createClerkReads({now:()=>now,sleep:async()=>assert.fail("long retry must not sleep")});
 const clerk:any={users:{getUser:async()=>{calls++;if(fail)throw {status:429,retryAfter:60};return {id:"a",privateMetadata:{admin:true}};}}};
 assert.equal((await reads.user(clerk,"a")).privateMetadata.admin,true);
 now=6000;fail=true;await assert.rejects(reads.user(clerk,"a"));assert.equal(calls,2);
 now=7000;await assert.rejects(reads.user(clerk,"a"));assert.equal(calls,2);
 now=66000;fail=false;clerk.users.getUser=async()=>{calls++;return {id:"a",privateMetadata:{admin:false}};};
 assert.equal((await reads.user(clerk,"a")).privateMetadata.admin,false);assert.equal(calls,3);
});
test("session revocation and admin removal are seen within five seconds, no sliding TTL",async()=>{
 let now=1000,status="active",admin=true,userCalls=0,sessionCalls=0;
 const reads=createClerkReads({now:()=>now});
 const clerk:any={users:{getUser:async()=>{userCalls++;return {id:"a",privateMetadata:{admin}};}},sessions:{getSession:async()=>{sessionCalls++;return {status,userId:"a"};}}};
 await Promise.all(Array.from({length:30},()=>Promise.all([reads.user(clerk,"a"),reads.session(clerk,"s")])));
 admin=false;status="revoked";now=5999;await reads.user(clerk,"a");await reads.session(clerk,"s");
 now=6000;assert.equal((await reads.user(clerk,"a")).privateMetadata.admin,false);assert.equal((await reads.session(clerk,"s")).status,"revoked");
 assert.equal(userCalls,2);assert.equal(sessionCalls,2);
});
test("concurrency stays at two and repeated 429 stops after one retry",async()=>{
 let now=1000,active=0,max=0,calls=0;
 const reads=createClerkReads({now:()=>now,sleep:async ms=>{now+=ms;}});
 const clerk:any={users:{getUser:async()=>{active++;max=Math.max(max,active);calls++;await Promise.resolve();active--;throw {status:429,retryAfter:1};}}};
 const result=await Promise.allSettled(Array.from({length:12},(_,i)=>reads.user(clerk,"u"+i)));
 assert.ok(max<=2);assert.ok(calls<=24);assert.ok(result.every(r=>r.status==="rejected"));
});
test("bounded cache evicts old entries and slow responses cannot extend authorization",async()=>{
 let now=1000,calls=0;
 const reads=createClerkReads({now:()=>now,capacity:2});
 const clerk:any={users:{getUser:async(id:string)=>{calls++;if(id==="slow")now+=6000;return {id};}}};
 await reads.user(clerk,"a");await reads.user(clerk,"b");await reads.user(clerk,"c");await reads.user(clerk,"a");assert.equal(calls,4);
 await assert.rejects(reads.user(clerk,"slow"),/expired/);await assert.rejects(reads.user(clerk,"slow"),/expired/);assert.equal(calls,6);
});
test("official SDK companion /users/count 429 is cooled down with its /users batch",async(t)=>{
 const {createClerkClient}=await import("@clerk/backend");
 let now=1000;const urls:string[]=[],waits:number[]=[];
 const {createServer}=await import("node:http");
 const server=createServer((req,res)=>{
  const url="http://fixture"+req.url;urls.push(url);
  res.setHeader("content-type","application/json");
  if(url.includes("/users/count")){
   if(urls.filter(u=>u.includes("/users/count")).length===1){
    res.writeHead(429,{"Retry-After":"1"});res.end(JSON.stringify({errors:[{code:"rate_limit_exceeded",message:"rate limited"}]}));return;
   }
   res.end(JSON.stringify({total_count:0}));return;
  }
  res.end("[]");
 });
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
 t.after(()=>new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve())));
 const address=server.address();assert.ok(address&&typeof address!=="string");
 const clerk=createClerkClient({secretKey:"sk_test_fixture_only",apiUrl:"http://127.0.0.1:"+address.port});
 const reads=createClerkReads({now:()=>now,sleep:async ms=>{waits.push(ms);now+=ms;}});
 await Promise.all(Array.from({length:20},()=>reads.profiles(clerk,["missing"])));
 assert.equal(urls.filter(u=>u.includes("/users/count")).length,2);
 assert.equal(urls.filter(u=>new URL(u).pathname==="/v1/users").length,2);
 assert.deepEqual(waits,[1000]);await reads.profiles(clerk,["missing"]);assert.equal(urls.length,4);
});
