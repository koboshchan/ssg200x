import {test} from "node:test";
import assert from "node:assert/strict";
import {freshRoom,register} from "../lib/poker";
import {spot,openPosition} from "../lib/finance";
import {publicStockState} from "../lib/stock-room-policy";
import {publicRoom} from "../lib/public";
// JS module is also consumed directly by the custom server without a TS loader.
// @ts-expect-error runtime JavaScript has no generated declarations
import {marketPayload} from "../runtime/market-payload.mjs";
test("socket payload uses verified identity only and matches private market calculations",()=>{
 const r=freshRoom(),now=Date.now(),who={id:"alice-private",name:"Alice",email:"alice-secret@test",admin:true};register(r,who);register(r,{id:"bob-private",name:"Bob",email:"bob-secret@test",admin:false});
 r.quotes={BTC:{micro:100_000_000_000,at:now}};spot(r,who,"BTC","buy",10000,now);openPosition(r,who,"BTC","long",1000,200,"alice-position",now);r.quotes.BTC!.micro+=100_000_000;
 const payload=marketPayload(r,who.id,now),full=publicRoom(r,who);
 assert.deepEqual(payload.holdings,full.holdings);assert.equal(payload.positions[0].pnl,full.positions[0].pnl);assert.equal(payload.positions[0].equity,full.positions[0].equity);assert.equal(payload.positions[0].liquidation,full.positions[0].liquidation);assert.equal(payload.wallet,full.me.wallet);assert.deepEqual(payload.leaderboard,full.leaderboard);assert.equal(payload.netWorth,full.leaderboard.find(m=>m.publicId===full.me.publicId)!.netWorth);
 assert.equal(marketPayload(r,"unknown"),null);const bob=marketPayload(r,"bob-private",now);assert.deepEqual(bob.positions,[]);assert.deepEqual(bob.holdings,[]);
 const serialized=JSON.stringify(payload);for(const secret of ["alice-private","bob-private","alice-secret@test","bob-secret@test","receipts","adminUsers"])assert.equal(serialized.includes(secret),false);
 assert.equal(marketPayload(r,"bob-private",now).wallet,100000);
});

test("roulette escrow stays in private net worth and public standings",()=>{
 const r=freshRoom(),who={id:"escrow",name:"Escrow",email:"escrow@test",admin:false};register(r,who);
 const room=r as typeof r & {roulette:unknown};room.roulette={round:1,started:Date.now(),bets:[{userId:who.id,bet:{kind:"red",amount:2500}}],history:[]};r.members[0].wallet-=2500;
 const payload=marketPayload(r,who.id);assert.equal(payload.netWorth,100000);assert.equal(payload.leaderboard[0].netWorth,100000);assert.equal(payload.wallet,97500);
});

test("SPY socket execution status matches the shared stock policy",()=>{
 const r=freshRoom(),who={id:"spy-holder",name:"Holder",email:"spy@test",admin:false};
 register(r,who);const now=Date.parse("2026-10-19T15:00:00Z");
 const close=Date.parse("2026-10-19T20:00:00Z");
 r.stockExecution={SPY:{symbol:"SPY",leaseUntil:now+10000,connected:true,leader:true,authorized:true,
  tick:{symbol:"SPY",price:600,timestamp:now-100,receivedAt:now,feed:"alpaca-iex"},
  clock:{timestamp:now,receivedAt:now,isOpen:true,nextOpen:now+86400000,nextClose:close},
  sessions:[{date:"2026-10-19",open:Date.parse("2026-10-19T13:30:00Z"),close}]}};
 r.quotes={SPY:{micro:600_000_000,at:now-100}};
 assert.equal(marketPayload(r,who.id,now).stockExecution.SPY.executable,true);
 assert.equal(marketPayload(r,who.id,now).stockExecution.SPY.executable,publicStockState(r,now).SPY.executable);
 assert.equal(marketPayload(r,who.id,close).stockExecution.SPY.executable,false);
});
test("socket execution status uses persisted dynamic stock registry",()=>{
 const r=freshRoom(),who={id:"registry",name:"Registry",email:"registry@test",admin:false};register(r,who);
 r.marketSymbols={crypto:[],stocks:["GOOG"],delisted:["SPY"],revision:1};
 assert.deepEqual(Object.keys(marketPayload(r,who.id).stockExecution),["GOOG"]);
 assert.deepEqual(Object.keys(publicStockState(r)),["GOOG"]);
});
