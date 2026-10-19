import {test} from "node:test";
import assert from "node:assert/strict";
import {mergeRoom,mergeMarket,settledNotices,type MarketSnapshot} from "../lib/room-sync";
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
