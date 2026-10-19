import {test} from "node:test";
import assert from "node:assert/strict";
import {freshRoom,register} from "../lib/poker";
import {spot,openPosition,closePosition} from "../lib/finance";
import {publicRoom} from "../lib/public";
import {applyMarketTick} from "../lib/market-tick";
const who={id:"market",name:"Market",email:"market@test",admin:true};
test("cache ticks change 200x P/L, spot value and net worth; close pays current equity",()=>{
 const room=freshRoom(),at=Date.now();register(room,who);
 applyMarketTick(room,{BTC:{micro:100_000_000_000,at}},at);
 spot(room,who,"BTC","buy",10000,at);openPosition(room,who,"BTC","long",1000,200,"long",at);
 const before=publicRoom(room,who);assert.equal(before.positions[0].pnl,0);
 applyMarketTick(room,{BTC:{micro:100_100_000_000,at:at+200}},at+200);
 const after=publicRoom(room,who);assert.equal(after.positions[0].pnl,200);assert.equal(after.holdings[0].value,before.holdings[0].value+10);
 assert.equal(after.leaderboard[0].netWorth,before.leaderboard[0].netWorth+210);
 closePosition(room,who,"long",at+200);assert.equal(room.members[0].wallet,before.me.wallet+1200);
});
test("one tick liquidates at threshold exactly once and rejects stale or out-of-order overwrites",()=>{
 const room=freshRoom(),at=Date.now();register(room,who);
 applyMarketTick(room,{BTC:{micro:100_000_000_000,at}},at);openPosition(room,who,"BTC","long",1000,200,"long",at);
 applyMarketTick(room,{BTC:{micro:99_500_000_000,at:at+200}},at+200);
 assert.equal(room.members[0].positions?.length,0);assert.match(room.members[0].activity![0],/^Liquidated/);
 const house=room.house;applyMarketTick(room,{BTC:{micro:100_000_000_000,at}},at+201);assert.equal(room.quotes!.BTC!.micro,99_500_000_000);assert.equal(room.house,house);
 applyMarketTick(room,{BTC:{micro:1,at:at+300}},at+20000);assert.equal(room.quotes!.BTC!.micro,99_500_000_000);
});
