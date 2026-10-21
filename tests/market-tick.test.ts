// These legacy accounting/trigger fixtures explicitly exercise the admin zero-fee mode.
import {test} from "node:test";
import assert from "node:assert/strict";
import {freshRoom,register} from "../lib/poker";
import {spot,openPosition,closePosition} from "../lib/finance";
import {publicRoom} from "../lib/public";
import {applyMarketTick} from "../lib/market-tick";
const who={id:"market",name:"Market",email:"market@test",admin:true};
test("cache ticks change 200x P/L, spot value and net worth; close pays current equity",()=>{
 const room=Object.assign(freshRoom(),{perpFeePpm:0}),at=Date.now();register(room,who);
 applyMarketTick(room,{BTC:{micro:100_000_000_000,at}},at);
 spot(room,who,"BTC","buy",10000,at);openPosition(room,who,"BTC","long",1000,200,"long",at);
 const before=publicRoom(room,who);assert.equal(before.positions[0].pnl,0);
 applyMarketTick(room,{BTC:{micro:100_100_000_000,at:at+200}},at+200);
 const after=publicRoom(room,who);assert.equal(after.positions[0].pnl,200);assert.equal(after.holdings[0].value,before.holdings[0].value+10);
 assert.equal(after.leaderboard[0].netWorth,before.leaderboard[0].netWorth+210);
 closePosition(room,who,"long",at+200);assert.equal(room.members[0].wallet,before.me.wallet+1200);
});
test("one tick liquidates at threshold exactly once and rejects stale or out-of-order overwrites",()=>{
 const room=Object.assign(freshRoom(),{perpFeePpm:0}),at=Date.now();register(room,who);
 applyMarketTick(room,{BTC:{micro:100_000_000_000,at}},at);openPosition(room,who,"BTC","long",1000,200,"long",at);
 applyMarketTick(room,{BTC:{micro:99_500_000_000,at:at+200}},at+200);
 assert.equal(room.members[0].positions?.length,0);assert.match(room.members[0].activity![0],/^Liquidated/);
 const house=room.house;applyMarketTick(room,{BTC:{micro:100_000_000_000,at}},at+201);assert.equal(room.quotes!.BTC!.micro,99_500_000_000);assert.equal(room.house,house);
 applyMarketTick(room,{BTC:{micro:1,at:at+300}},at+20000);assert.equal(room.quotes!.BTC!.micro,99_500_000_000);
});
test("live tick invokes persisted TP/SL at current mark and liquidation wins a gap",()=>{
 const at=Date.now();
 for(const mode of ["profit","stop","gap"]){
  const room=Object.assign(freshRoom(),{perpFeePpm:0});register(room,who);applyMarketTick(room,{BTC:{micro:100_000_000_000,at}},at);
  openPosition(room,who,"BTC","long",1000,200,"trigger",at,{takeProfit:100_100_000_000,stopLoss:99_900_000_000});
  const mark=mode==="profit"?100_200_000_000:mode==="stop"?99_800_000_000:99_400_000_000;
  applyMarketTick(room,{BTC:{micro:mark,at:at+200}},at+200);
  const member=room.members[0];assert.equal(member.positions!.length,0);
  assert.equal(member.wallet,mode==="profit"?100400:mode==="stop"?99600:99000);
  assert.match(member.activity![0],mode==="profit"?/^Take-profit/:mode==="stop"?/^Stop-loss/:/^Liquidated/);
  applyMarketTick(room,{BTC:{micro:mark,at:at+400}},at+400);assert.equal(member.activity!.length,1);
 }
});
