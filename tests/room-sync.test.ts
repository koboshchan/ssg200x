import {test} from "node:test";
import assert from "node:assert/strict";
import {mergeRoom,mergeMarket,coalescedRead,type MarketSnapshot} from "../lib/room-sync";
import {endpointBudget} from "../lib/read-policy";
import {freshRoom,register} from "../lib/poker";
import {publicRoom} from "../lib/public";
test("concurrent socket and fallback room reads share one request",async()=>{let calls=0;let finish!:(n:number)=>void;const load=coalescedRead(()=>{calls++;return new Promise<number>(resolve=>{finish=resolve;});});const a=load(),b=load();assert.equal(calls,1);finish(7);assert.deepEqual(await Promise.all([a,b]),[7,7]);const c=load();assert.equal(calls,2);finish(8);assert.equal(await c,8);});
test("market payload updates cash and portfolio and stale responses cannot rewind state; equal full snapshot allowed",()=>{
 const r=freshRoom(),who={id:"a",email:"a@test",name:"A",admin:true};register(r,who);const full=publicRoom(r,who);
 const market:MarketSnapshot={version:2,serverNow:123,quotes:{BTC:{micro:10,at:123}},holdings:[],positions:[],activity:["Liquidated"],leaderboard:[],wallet:99000,netWorth:99000};
 const live=mergeMarket(full,market)!;assert.equal(live.me.wallet,99000);assert.equal(live.quotes.BTC!.at,123);assert.equal(mergeRoom(live,full),live);assert.equal(mergeMarket(live,{...market,version:1}),live);
 assert.equal(mergeRoom(live,{...full,version:2,street:"showdown"}).street,"showdown");
});
test("room reads have isolated budget while writes and other reads retain normal limit",()=>{assert.deepEqual(endpointBudget("GET","/api/room","a"),{key:"room-read:a",limit:900});assert.deepEqual(endpointBudget("POST","/api/finance","a"),{key:"a",limit:180});assert.deepEqual(endpointBudget("GET","/api/admin","a"),{key:"a",limit:180});});
