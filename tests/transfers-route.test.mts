import test,{beforeEach,mock} from "node:test";
import assert from "node:assert/strict";
const who={id:"authenticated-owner",admin:false},calls:unknown[][]=[];
mock.module("../lib/api.ts",{namedExports:{
 endpoint:async(_r:Request,handler:(w:typeof who)=>Promise<unknown>)=>{calls.push(["endpoint"]);return Response.json(await handler(who));},
 parse:async(r:Request,schema:{parse:(v:unknown)=>unknown})=>schema.parse(await r.json()),
}});
mock.module("../lib/store.ts",{namedExports:{rateLimit:async(...args:unknown[])=>{calls.push(["rate",...args]);}}});
mock.module("../lib/transfer-rate-limit.ts",{namedExports:{limitTransferGuess:async(_r:Request,id:string)=>{calls.push(["guess",id]);}}});
mock.module("../lib/transfers.ts",{namedExports:{
 activeReceiveCodes:async(w:typeof who)=>{calls.push(["list",w]);return [{id:"id",code:"cat dog",amount:100,note:"request",expiresAt:123}];},
 cancelReceiveCode:async(w:typeof who,id:string)=>{calls.push(["cancel",w,id]);return {cancelled:true};},
 createReceiveCode:async(w:typeof who,input:unknown)=>{calls.push(["code",w,input]);return {id:"id",code:"cat dog",amount:100,note:"request",expiresAt:123};},
 resolveReceiveCode:async(w:typeof who,code:string)=>{calls.push(["resolve",w,code]);return {publicId:"recipient",name:"Old name",amount:100,note:"request",expiresAt:123};},
 sendTransfer:async(w:typeof who,input:unknown)=>{calls.push(["send",w,input]);return {id:"transfer"};},
}});
mock.module("../lib/db.ts",{namedExports:{db:async()=>({collection:()=>({findOne:async()=>({members:[{id:"recipient-internal",publicId:"recipient"}]})})})}});
mock.module("../lib/server-names.ts",{namedExports:{
 currentProfiles:async()=>new Map([["recipient-internal",{name:"Current name",avatar:null}]]),
 currentTransferHistory:async(w:typeof who,all:boolean)=>{calls.push(["history",w,all]);return [];},
 currentTransferResult:async(id:string)=>({id,amount:100}),
}});
const {GET,POST}=await import("../app/api/transfers/route");
beforeEach(()=>{calls.length=0;});
const request=(input:unknown)=>new Request("https://test.invalid/api/transfers",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input)});
test("owner list is explicit and uses authenticated identity, not caller owner/all query",async()=>{
 const response=await GET(new Request("https://test.invalid/api/transfers?active=1&all=1&owner=other"));
 assert.equal((await response.json()).codes[0].code,"cat dog");assert.deepEqual(calls,[["endpoint"],["list",who]]);
});
test("history response remains unchanged",async()=>{
 assert.deepEqual(await(await GET(new Request("https://test.invalid/api/transfers?all=1"))).json(),{transfers:[]});
 assert.deepEqual(calls,[["endpoint"],["history",who,true]]);
});
test("generation skips shared transfer minute cap and guess budgets",async()=>{
 const input={action:"code",amount:"1",note:"request"};
 assert.equal((await(await POST(request(input))).json()).id,"id");
 assert.deepEqual(calls,[["endpoint"],["code",who,input]]);
});
test("cancellation only accepts a request id and passes authenticated owner",async()=>{
 assert.deepEqual(await(await POST(request({action:"cancel",id:"id"}))).json(),{cancelled:true});
 assert.deepEqual(calls,[["endpoint"],["cancel",who,"id"]]);
});
test("send retains transfer minute cap and every guess limit",async()=>{
 const input={action:"send",code:"cat dog",recipient:"recipient",requestId:"12345678-1234-4234-8234-123456789012"};
 assert.deepEqual(await(await POST(request(input))).json(),{transfer:{id:"transfer",amount:100}});
 assert.deepEqual(calls.slice(0,3),[["endpoint"],["rate","transfers:"+who.id,20],["guess",who.id]]);
 assert.deepEqual(calls[3],["send",who,input]);
});
test("resolve retains its tighter minute and guess caps and returns no owner code/id",async()=>{
 const result=await(await POST(request({action:"resolve",code:"cat dog"}))).json();
 assert.equal(result.amount,100);assert.ok(!("code" in result));assert.ok(!("id" in result));
 assert.deepEqual(calls.slice(0,3),[["endpoint"],["rate","transfers:"+who.id,10],["guess",who.id]]);
});
test("unknown and cross-owner body fields fail strict schemas before service calls",async()=>{
 for(const input of [{action:"cancel",id:"id",ownerId:"other"},{action:"code",amount:"1",ownerId:"other"},{action:"list"},{action:"cancel",id:""}]){
  calls.length=0;await assert.rejects(()=>POST(request(input)));assert.deepEqual(calls,[["endpoint"]]);
 }
});
