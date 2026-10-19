import {test,after} from "node:test";
import assert from "node:assert/strict";
import {db,closeDatabase,readRoom} from "../../lib/db";
import {mutate} from "../../lib/store";
import {register} from "../../lib/poker";
import {openPosition} from "../../lib/finance";
import {applyMarketTick} from "../../lib/market-tick";
import {publicRoom} from "../../lib/public";
import {candleUpdate,candleRead} from "../../lib/candles";
if(!process.env.MONGODB_DB?.startsWith("fakebucks_test_"))throw new Error("Requires isolated test DB");
process.env.MONGODB_DB+="_market_ticks";
after(async()=>{await(await db()).dropDatabase();await closeDatabase();});
test("Mongo CAS publishes marks, live P/L and liquidation as one version; candles persist OHLC roll",async()=>{
 const who={id:"tick",name:"Tick",email:"tick@test",admin:true},at=Math.floor(Date.now()/60000)*60000;
 await mutate(r=>{register(r,who);applyMarketTick(r,{BTC:{micro:100_000_000_000,at}},at);openPosition(r,who,"BTC","long",1000,200,"position",at);});
 const before=await readRoom();
 const up={BTC:{micro:100_100_000_000,at:at+200}};
 await mutate(r=>applyMarketTick(r,up,at+200));await candleUpdate(up);
 const marked=await readRoom();assert.equal(marked.version,before.version+1);assert.equal(publicRoom(marked,who).positions[0].pnl,200);
 const down={BTC:{micro:99_500_000_000,at:at+400}};
 await Promise.all([mutate(r=>applyMarketTick(r,down,at+400)),mutate(r=>applyMarketTick(r,down,at+400))]);await candleUpdate(down);
 const settled=await readRoom();assert.equal(settled.members[0].positions?.length,0);assert.equal(settled.members[0].activity?.length,1);
 await candleUpdate({BTC:{micro:101_000_000_000,at:at+60000}});
 const candles=await candleRead("BTC","1m",at,at+60000);
 assert.equal(candles.length,2);assert.equal(candles[0].open,100100);assert.equal(candles[0].high,100100);assert.equal(candles[0].low,99500);assert.equal(candles[0].close,99500);assert.equal(candles[1].open,101000);
});
test("every tick checks every user at exact long/short computed and override boundaries, margin forfeits once",async()=>{
 const at=Date.now(),entry=100_000_000_000;
 const scenarios=[{side:"long" as const,override:undefined,mark:99_500_000_000},{side:"short" as const,override:undefined,mark:100_500_000_000},{side:"long" as const,override:99_900_000_000,mark:99_900_000_000},{side:"short" as const,override:100_100_000_000,mark:100_100_000_000}];
 for(const [i,s] of scenarios.entries()){
  const alice={id:`boundary-${i}`,name:`Boundary ${i}`,email:`boundary${i}@test`,admin:true};
  const bob={id:`boundary-other-${i}`,name:`Other ${i}`,email:`other${i}@test`,admin:false};
  await mutate(r=>{
   applyMarketTick(r,{BTC:{micro:entry,at:at+i*1000}},at+i*1000);
   for(const who of [alice,bob]){register(r,who);openPosition(r,who,"BTC",s.side,1000,200,who.id,at+i*1000);const p=r.members.find(m=>m.id===who.id)!.positions![0];if(s.override!==undefined)p.liquidationOverride=s.override;}
  });
  const before=await readRoom(),house=before.house||0;
  const quote={BTC:{micro:s.mark,at:at+i*1000+200}};
  const {room:after}=await mutate(r=>applyMarketTick(r,quote,at+i*1000+200));
  assert.equal(after.house,house+2000);
  for(const who of [alice,bob]){
   const m=after.members.find(m=>m.id===who.id)!;
   assert.equal(m.positions!.length,0);assert.equal(m.wallet,99000);assert.equal(m.activity!.length,1);assert.match(m.activity![0],/^Liquidated .*0\.00 returned/);
   const view=publicRoom(after,who);assert.equal(view.positions.length,0);assert.equal(view.me.wallet,99000);assert.equal(view.leaderboard.find(m=>m.publicId===view.me.publicId)!.netWorth,99000);
  }
  await mutate(r=>applyMarketTick(r,quote,at+i*1000+200));
  const repeated=await readRoom();assert.equal(repeated.house,after.house);for(const who of [alice,bob])assert.equal(repeated.members.find(m=>m.id===who.id)!.activity!.length,1);
 }
});
