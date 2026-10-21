import test,{mock} from "node:test";
import assert from "node:assert/strict";
import {AppError} from "../lib/errors";
import {freshRoom} from "../lib/poker";
import type {Identity} from "../lib/types";
let room=freshRoom(),reads=0,writes=0;
let who:Identity={id:"admin",name:"Admin",email:"a@test",admin:true};
mock.module("../lib/api.ts",{namedExports:{
 endpoint:async(_request:Request,handler:(who:Identity)=>Promise<unknown>)=>{
  try{return Response.json(await handler(who));}
  catch(e){return Response.json({error:e instanceof Error?e.message:"Error"},{status:e instanceof AppError?e.status:400});}
 },
 parse:async(request:Request,schema:{parse(value:unknown):unknown})=>schema.parse(await request.json())
}});
mock.module("../lib/db.ts",{namedExports:{readRoom:async()=>{reads++;return structuredClone(room);},db:async()=>{throw new Error("Unexpected audit database access");}}});
mock.module("../lib/store.ts",{namedExports:{rateLimit:async()=>{},mutate:async(fn:(room:typeof room)=>void)=>{
 const next=structuredClone(room);fn(next);room=next;writes++;return {room};
}}});
const {GET,POST}=await import("../app/api/admin/casino-limits/route");
const request=(body?:unknown)=>new Request("https://test.invalid/api/admin/casino-limits",body===undefined?{}:{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
test("admin route rejects ordinary identity before reads, parses or mutation",async()=>{
 who={...who,admin:false};const before=[reads,writes];
 assert.equal((await GET(request())).status,403);
 assert.equal((await POST(request({rouletteMaxTotal:100,blackjackMaxHand:100,expectedVersion:0}))).status,403);
 assert.deepEqual([reads,writes],before);who={...who,admin:true};
});
test("admin route returns defaults and updates persisted snapshot with stale-edit protection",async()=>{
 assert.equal((await GET(request())).status,200);
 const response=await POST(request({rouletteMaxTotal:50000,blackjackMaxHand:20000,pokerMaxBuyIn:250000,expectedVersion:0}));
 assert.equal(response.status,200);assert.deepEqual((await response.json()).casinoLimits,{rouletteMaxTotal:50000,blackjackMaxHand:20000,pokerMaxBuyIn:250000,revision:1});
 const before=structuredClone(room);
 assert.equal((await POST(request({rouletteMaxTotal:100,blackjackMaxHand:100,expectedVersion:0}))).status,409);
 assert.deepEqual(room,before);
});
test("admin route rejects malformed bounds, decimals, strings and unknown properties without mutation",async()=>{
 const before=structuredClone(room),count=writes;
 for(const value of [0,101,100.5,-100,100000100,"100",null]){
  const response=await POST(request({rouletteMaxTotal:value,blackjackMaxHand:100,expectedVersion:1}));assert.equal(response.status,400);
 }
 assert.equal((await POST(request({rouletteMaxTotal:100,blackjackMaxHand:100,expectedVersion:1,admin:true}))).status,400);
 for(const pokerMaxBuyIn of [0,100,9900,10001,10000.5,100000100,"10000",null])assert.equal((await POST(request({rouletteMaxTotal:100,blackjackMaxHand:100,pokerMaxBuyIn,expectedVersion:1}))).status,400);
 assert.equal(writes,count);assert.deepEqual(room,before);
});
