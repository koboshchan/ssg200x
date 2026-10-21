import test,{beforeEach,mock} from "node:test";
import assert from "node:assert/strict";
import {AppError} from "../lib/errors";
const calls:string[]=[];let signedIn=true,badTab=false;
mock.module("@clerk/nextjs/server",{namedExports:{auth:async()=>({userId:signedIn?"owner":null,sessionId:"session"})}});
mock.module("../lib/clerk-env.ts",{namedExports:{clerkConfigured:()=>true}});
mock.module("../lib/clerk-reads.ts",{namedExports:{
 currentClerkSession:async()=>{calls.push("session");},
 currentClerkUser:async()=>{calls.push("user");return {id:"owner",privateMetadata:{}};},
}});
mock.module("../lib/google-identity.ts",{namedExports:{verifiedGoogleEmail:()=>"owner@example.test"}});
mock.module("../lib/store.ts",{namedExports:{rateLimit:async(key:string,limit:number)=>{calls.push("budget:"+key+":"+limit);}}});
mock.module("../lib/site-maintenance.ts",{namedExports:{siteMaintenance:async()=>{calls.push("maintenance");return {blocked:false};}}});
mock.module("../lib/tab-guard.ts",{namedExports:{checkActionTab:async()=>{calls.push("tab");if(badTab)throw new AppError("Wrong tab",409);}}});
const {endpoint}=await import("../lib/api");
beforeEach(()=>{calls.length=0;signedIn=true;badTab=false;process.env.APP_ORIGIN="https://test.invalid";});
function request(method="POST",path="/api/transfers",input:unknown={action:"code",amount:"1"},origin="https://test.invalid"){
 return new Request("https://test.invalid"+path,{method,headers:{"origin":origin,"content-type":"application/json"},...(method==="GET"?{}:{body:typeof input==="string"?input:JSON.stringify(input)})});
}
async function execute(r:Request){return endpoint(r,async()=>{calls.push("handler");return {ok:true};});}
test("only exact valid receive-code generation skips generic endpoint budget",async()=>{
 const response=await execute(request());assert.equal(response.status,200);
 assert.deepEqual(calls,["session","user","maintenance","tab","handler"]);
 assert.equal(response.headers.get("cache-control"),"no-store");
});
for(const [label,r] of [
 ["list",()=>request("GET","/api/transfers?active=1")],
 ["history",()=>request("GET","/api/transfers")],
 ["cancel",()=>request("POST","/api/transfers",{action:"cancel",id:"code-id"})],
 ["lookup",()=>request("POST","/api/transfers",{action:"resolve",code:"cat dog"})],
 ["send",()=>request("POST","/api/transfers",{action:"send",code:"cat dog"})],
 ["other route",()=>request("POST","/api/wallet")],
 ["other method",()=>request("DELETE")],
 ["trailing slash",()=>request("POST","/api/transfers/")],
 ["unknown field",()=>request("POST","/api/transfers",{action:"code",amount:"1",owner:"other"})],
 ["invalid schema",()=>request("POST","/api/transfers",{action:"code",amount:1})],
 ["malformed JSON",()=>request("POST","/api/transfers","{")],
 ["oversized body",()=>request("POST","/api/transfers",JSON.stringify({action:"code",amount:"1",note:"x".repeat(3000)}))],
] as const){
 test(label+" retains shared budget",async()=>{await execute(r());assert.ok(calls.includes("budget:owner:180"));});
}
test("generation still requires sign-in",async()=>{signedIn=false;assert.equal((await execute(request())).status,401);assert.ok(!calls.includes("handler"));});
test("generation still requires same origin",async()=>{assert.equal((await execute(request("POST","/api/transfers",undefined,"https://evil.invalid"))).status,403);assert.ok(!calls.includes("handler"));});
test("generation still enforces tab policy",async()=>{badTab=true;assert.equal((await execute(request())).status,409);assert.ok(calls.includes("tab"));assert.ok(!calls.includes("handler"));});
test("body inspection does not consume the handler request",async()=>{
 const r=request();const response=await endpoint(r,async()=>r.json());assert.deepEqual(await response.json(),{action:"code",amount:"1"});
});
