import test,{mock} from "node:test";
import assert from "node:assert/strict";
import {AppError} from "../lib/errors";
import {freshRoom} from "../lib/poker";
import type {Identity} from "../lib/types";
let room=freshRoom(),writes=0;
let who:Identity={id:"admin",name:"Admin",email:"a@test",admin:true};
mock.module("../lib/api.ts",{namedExports:{
 endpoint:async(_r:Request,h:(who:Identity)=>Promise<unknown>)=>{try{return Response.json(await h(who));}catch(e){return Response.json({error:e instanceof Error?e.message:"Error"},{status:e instanceof AppError?e.status:400});}},
 parse:async(request:Request,schema:{parse(value:unknown):unknown})=>schema.parse(await request.json())
}});
mock.module("../lib/db.ts",{namedExports:{readRoom:async()=>structuredClone(room),db:async()=>{throw new Error("no db");}}});
mock.module("../lib/store.ts",{namedExports:{rateLimit:async()=>{},mutate:async(fn:(r:typeof room)=>void)=>{const n=structuredClone(room);fn(n);room=n;writes++;return {room};}}});
const {GET,POST}=await import("../app/api/admin/casino-limits/route");
const post=(body:unknown)=>POST(new Request("https://t.invalid/x",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}));
const get=()=>GET(new Request("https://t.invalid/x"));
const ok={rouletteMaxTotal:100000,blackjackMaxHand:100000};
test("non-admin cannot read or write house edge",async()=>{
 who={...who,admin:false};const w=writes;
 assert.equal((await get()).status,403);assert.equal((await post({...ok,houseEdgeBps:100,expectedVersion:0})).status,403);
 assert.equal(writes,w);who={...who,admin:true};
});
test("route default, strict integer bps bounds, compat without field, CAS",async()=>{
 assert.equal((await (await get()).json()).casinoLimits.houseEdgeBps,0);
 for(const v of [1001,-1001,0.5,"5",null]){const w=writes;assert.equal((await post({...ok,houseEdgeBps:v,expectedVersion:0})).status>=400,true);assert.equal(writes,w);}
 let res=await post({...ok,houseEdgeBps:-250,expectedVersion:0});assert.equal(res.status,200);
 let data=await res.json();assert.equal(data.casinoLimits.houseEdgeBps,-250);assert.equal(data.casinoLimits.revision,1);
 res=await post({...ok,expectedVersion:1});assert.equal((await res.json()).casinoLimits.houseEdgeBps,-250);
 assert.equal((await post({...ok,houseEdgeBps:1000,expectedVersion:1})).status,409);
 res=await post({...ok,houseEdgeBps:1000,expectedVersion:2});assert.equal((await res.json()).casinoLimits.houseEdgeBps,1000);
});
