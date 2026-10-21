import test,{mock} from "node:test";
import assert from "node:assert/strict";
import {AppError} from "../lib/errors";
import {marketSymbols} from "../lib/symbol-registry";
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

let providers=0;
globalThis.fetch=async(url: string|URL|Request)=>{
 providers++;const symbol=String(url).split("/").at(-1)!;
 return Response.json({symbol,class:"us_equity",status:"active",tradable:true});
};
process.env.ALPACA_KEY_ID="fixture";process.env.ALPACA_SECRET="fixture";
const {GET,POST}=await import("../app/api/admin/symbols/route");
const request=(body?:unknown)=>new Request("https://test.invalid/api/admin/symbols",body===undefined?{}:{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
test("symbol admin route rejects ordinary users before reads, validation and writes",async()=>{
 who={...who,admin:false};const before=[reads,writes,providers];
 assert.equal((await GET(request())).status,403);
 assert.equal((await POST(request({action:"add",kind:"stocks",symbol:"GOOG",expectedVersion:0}))).status,403);
 assert.deepEqual([reads,writes,providers],before);who={...who,admin:true};
});
test("symbol route adds verified equity, enforces CAS and returns affected removal counts",async()=>{
 assert.equal((await GET(request())).status,200);
 const body={action:"add",kind:"stocks",symbol:"GOOG",expectedVersion:0};
 assert.equal((await POST(request(body))).status,200);
 assert.ok(marketSymbols(room).stocks.includes("GOOG"));
 assert.equal((await POST(request({...body,symbol:"META"}))).status,409);
 assert.equal((await POST(request({action:"remove",kind:"stocks",symbol:"GOOG",expectedVersion:1}))).status,409);
 assert.equal((await POST(request({action:"remove",kind:"stocks",symbol:"GOOG",expectedVersion:1,confirmed:true}))).status,200);
 assert.ok(marketSymbols(room).delisted.includes("GOOG"));
});
test("symbol route rejects oversized, invalid, lowercase or unknown fields before provider access",async()=>{
 const count=providers,before=structuredClone(room);
 for(const symbol of ["../bad","lower","TOOLONGSYMBOL1234","",{$ne:null}]){
  assert.equal((await POST(request({action:"add",kind:"stocks",symbol,expectedVersion:2}))).status,400);
 }
 assert.equal((await POST(request({action:"add",kind:"stocks",symbol:"META",expectedVersion:2,admin:true}))).status,400);
 assert.equal(providers,count);assert.deepEqual(room,before);
});
test("symbol route rejects 31st stock without mutating persisted registry",async()=>{
 room.marketSymbols={crypto:[],stocks:Array.from({length:30},(_,i)=>"S"+i),delisted:[],revision:0};
 const before=structuredClone(room);
 assert.equal((await POST(request({action:"add",kind:"stocks",symbol:"META",expectedVersion:0}))).status,409);
 assert.deepEqual(room,before);
});
