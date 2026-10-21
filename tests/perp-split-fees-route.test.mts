import test,{mock} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {AppError} from "../lib/errors";
import {freshRoom,register} from "../lib/poker";
import {publicRoom} from "../lib/public";
let room=freshRoom(),writes=0;
let who={id:"admin",name:"Admin",email:"admin@test",admin:true};register(room,who);
mock.module("../lib/api.ts",{namedExports:{
 endpoint:async(_request:Request,handler:(who:typeof who)=>Promise<unknown>)=>{
  try{return Response.json(await handler(who));}catch(e){return Response.json({error:e instanceof Error?e.message:"Error"},{status:e instanceof AppError?e.status:400});}
 },
 parse:async(request:Request,schema:{parse(value:unknown):unknown})=>schema.parse(await request.json())
}});
mock.module("../lib/store.ts",{namedExports:{rateLimit:async()=>{},mutate:async(fn:(room:typeof room)=>void)=>{
 const next=structuredClone(room);fn(next);room=next;writes++;return {room};
}}});
mock.module("../lib/public.ts",{namedExports:{freshPublicRoom:async(r:typeof room,w:typeof who)=>publicRoom(r,w)}});
const {POST:admin}=await import("../app/api/admin/route");
const {POST:finance}=await import("../app/api/finance/route");
const req=(body:object)=>new Request("https://test.invalid/api",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({requestId:randomUUID(),requestAt:Date.now(),...body})});
test("admin separate fees strict validation, access control, pair persistence and receipt replay",async()=>{
 const payload={type:"perp-fees",openingPercent:0.02,closingPercent:0.07};
 who={...who,admin:false};assert.equal((await admin(req(payload))).status,403);assert.equal(writes,0);who={...who,admin:true};
 for(const body of [{...payload,openingPercent:0.00001},{...payload,closingPercent:-1},{...payload,openingPercent:"0.02"},{...payload,admin:true},{type:"perp-fees",openingPercent:0.02}]){
  assert.equal((await admin(req(body))).status,400);assert.equal(writes,0);
 }
 const requestId=randomUUID();assert.equal((await admin(req({...payload,requestId}))).status,200);
 assert.equal(room.perpOpeningFeePpm,200);assert.equal(room.perpClosingFeePpm,700);
 assert.equal((await admin(req({...payload,openingPercent:0.1,requestId}))).status,200);
 assert.equal(room.perpOpeningFeePpm,200);
});
test("finance rejects either stale leg before charging and permits old client only when both rates match",async()=>{
 const order={type:"open",symbol:"BTC",side:"long",margin:10000,leverage:5};
 room.quotes={BTC:{micro:100000000,at:Date.now()}};
 for(const rates of [{expectedOpeningFeePpm:200,expectedClosingFeePpm:300},{expectedOpeningFeePpm:300,expectedClosingFeePpm:700},{expectedFeePpm:200},{}]){
  const before=structuredClone(room);assert.equal((await finance(req({...order,...rates}))).status,409);assert.deepEqual(room,before);
 }
 assert.equal((await finance(req({...order,expectedOpeningFeePpm:200,expectedClosingFeePpm:700}))).status,200);
 assert.equal(room.members[0].positions![0].openingFee,10);assert.equal(room.members[0].positions![0].closingFeePpm,700);
 assert.equal(room.auditPending!.at(-1)!.what,"finance-open");
 assert.equal((await admin(req({type:"perp-fees",openingPercent:0,closingPercent:0}))).status,200);
 assert.equal((await finance(req({...order,expectedFeePpm:0}))).status,200);
});
