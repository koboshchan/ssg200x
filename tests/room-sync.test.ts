import {test} from "node:test";
import assert from "node:assert/strict";
import {trailingRead,mergeRoom,mergeMarket,settledNotices,type MarketSnapshot} from "../lib/room-sync";
import {endpointBudget} from "../lib/read-policy";
import {freshRoom,register} from "../lib/poker";
import {publicRoom} from "../lib/public";
test("market payload updates cash and portfolio and stale responses cannot rewind state; equal full snapshot allowed",()=>{
 const r=freshRoom(),who={id:"a",email:"a@test",name:"A",admin:true};register(r,who);const full=publicRoom(r,who);
 const market:MarketSnapshot={version:2,serverNow:123,quotes:{BTC:{micro:10,at:123}},holdings:[],positions:[],activity:["Liquidated"],leaderboard:[],wallet:99000,netWorth:99000};
 const live=mergeMarket(full,market)!;assert.equal(live.me.wallet,99000);assert.equal(live.quotes.BTC!.at,123);assert.equal(mergeRoom(live,full),live);assert.equal(mergeMarket(live,{...market,version:1}),live);
 assert.equal(mergeRoom(live,{...full,version:2,street:"showdown"}).street,"showdown");
});
test("room reads have isolated budget while writes and other reads retain normal limit",()=>{assert.deepEqual(endpointBudget("GET","/api/room","a"),{key:"room-read:a",limit:900});assert.deepEqual(endpointBudget("POST","/api/finance","a"),{key:"a",limit:180});assert.deepEqual(endpointBudget("GET","/api/admin","a"),{key:"a",limit:180});});
test("notices parse only settled positions",()=>{
 assert.deepEqual(settledNotices(["Opened long BTC","Liquidated long BTC · 0.00 returned · position p1","Take-profit · Closed long ETH · position p2 · filled at $1"]).map(x=>x.id),["p1","p2"]);});
test("trailing read queues one rerun and recovers after rejection, including while dirty",async()=>{
 let calls=0;const gates:Array<{ok:(n:number)=>void;fail:(e:Error)=>void}>=[];const load=trailingRead(()=>new Promise<number>((ok,fail)=>{calls++;gates.push({ok,fail});}));
 const a=load(),b=load(),c=load();assert.equal(calls,1);gates[0].ok(1);await new Promise(r=>setTimeout(r));assert.equal(calls,2);gates[1].ok(2);assert.deepEqual(await Promise.all([a,b,c]),[2,2,2]);assert.equal(calls,2);
 const d=load(),e=load();const settled=Promise.allSettled([d,e]);gates[2].fail(new Error("boom"));const [rd,re]=await settled;assert.equal(rd.status,"rejected");assert.equal(re.status,"rejected");assert.equal(calls,3);
 const f=load();assert.equal(calls,4);gates[3].ok(9);assert.equal(await f,9);
 const g=load(),h=load();gates[4].ok(5);await new Promise(r=>setTimeout(r));gates[5].fail(new Error("late"));assert.equal((await Promise.allSettled([g,h]))[0].status,"rejected");const i=load();assert.equal(calls,7);gates[6].ok(1);await i;
});
