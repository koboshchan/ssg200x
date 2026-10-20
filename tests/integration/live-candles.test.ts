import test from "node:test";
import assert from "node:assert/strict";
import {db,closeDatabase} from "../../lib/db";
import {candleRead,candleUpdate,GRANULARITIES} from "../../lib/candles";
import {siteMaintenance} from "../../lib/site-maintenance";
import {SYMBOLS} from "../../lib/market-shared";
test("stored history survives live writes and dormant jobs never gate maintenance or run", {skip:!process.env.MONGODB_URI},async()=>{
 if(!process.env.MONGODB_DB?.startsWith("fakebucks_test_nohistory_"))throw Error("Refusing shared database");
 const d=await db(),original=globalThis.fetch,at=Date.UTC(2026,9,19),symbol=SYMBOLS[0];
 globalThis.fetch=async()=>{throw Error("No external history allowed");};
 try{
  const old={_id:symbol+":1m:0",symbol,granularity:"1m",time:0,open:1,high:2,low:1,close:2,volume:3,source:"binance",quoteCurrency:"USDT",firstAt:0,lastAt:59999};
  await d.collection("candles").insertOne(old as never);
  await d.collection("candle_backfill").insertOne({_id:"dormant",status:"pending",attempts:4} as never);
  await d.collection("candle_history_state").insertOne({_id:"archive-12-month-v1",seeded:false} as never);
  assert.equal((await siteMaintenance(false)).blocked,false);
  await candleUpdate([{[symbol]:{micro:10_000_000,at}},{[symbol]:{micro:12_000_000,at:at+1000}},{[symbol]:{micro:9_000_000,at:at+500}}]);
  assert.deepEqual(await d.collection("candles").findOne({_id:old._id} as never),old);
  for(const g of Object.keys(GRANULARITIES)){
   const rows=await candleRead(symbol,g,at,at+60000);
   assert.equal(rows.length,1);assert.deepEqual([rows[0].open,rows[0].high,rows[0].low,rows[0].close],[10,12,9,12]);
  }
  assert.equal((await d.collection("candle_backfill").findOne({}))?.attempts,4);
  assert.equal(await d.collection("candle_backfill").countDocuments(),1);
  assert.equal(await d.collection("workers").countDocuments(),0);
  await d.collection("rooms").updateOne({_id:"main"} as never,{$set:{siteMaintenance:true}});
  assert.equal((await siteMaintenance(false)).blocked,true);assert.equal((await siteMaintenance(true)).blocked,false);
  await d.collection("rooms").updateOne({_id:"main"} as never,{$set:{siteMaintenance:false}});
  assert.equal((await siteMaintenance(false)).blocked,false);
 }finally{globalThis.fetch=original;await d.dropDatabase();await closeDatabase();}
});
