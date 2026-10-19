import test from "node:test";
import assert from "node:assert/strict";
import {Collection} from "mongodb";
import {candleUpdate,candleRead,GRANULARITIES} from "../lib/candles";
import {db,closeDatabase} from "../lib/db";

test("Mongo candle batches use one ordered write and preserve older/equal/newer OHLC semantics",{skip:!process.env.CANDLE_MONGO_TEST},async()=>{
 assert.ok(process.env.MONGODB_DB?.startsWith("fakebucks_test_candles_"));
 const database=await db(),bulk=Collection.prototype.bulkWrite;
 let calls=0,ordered:unknown,operationCount=0;
 Collection.prototype.bulkWrite=async function(operations,options){
  if(this.collectionName==="candles"){calls++;ordered=options?.ordered;operationCount=operations.length;}
  return bulk.call(this,operations,options);
 };
 const time=Date.UTC(2026,0,1);
 try{
 await database.dropDatabase();
 await candleUpdate([
  {BTC:{micro:10_000_000,at:time+2000}},
  {BTC:{micro:12_000_000,at:time+4000}},
  {BTC:{micro:8_000_000,at:time+1000}},
  {BTC:{micro:15_000_000,at:time+4000}},
  {BTC:{micro:7_000_000,at:time+3000},ETH:{micro:20_000_000,at:time+3000}},
  {BTC:{micro:9_000_000,at:time+1000}},
 ]);
 assert.equal(calls,1);assert.equal(ordered,true);assert.equal(operationCount,7*6);
 for(const g of Object.keys(GRANULARITIES)){
  const [row]=await candleRead("BTC",g,time-86400000,time+60000);
  assert.deepEqual([row.open,row.high,row.low,row.close,row.firstAt,row.lastAt,row.volume],[8,15,7,15,time+1000,time+4000,0]);
 }
 // Equal timestamps affect close in array order, never change first open.
 calls=0;
 await candleUpdate([{BTC:{micro:11_000_000,at:time+4000}},{BTC:{micro:13_000_000,at:time+4000}}]);
 assert.equal(calls,1);
 assert.equal((await candleRead("BTC","1m",time,time+60000))[0].close,13);
 // Old object API stays valid; a newer tick changes close, not historical extrema.
 await candleUpdate({BTC:{micro:14_000_000,at:time+5000}});
 const [row]=await candleRead("BTC","1m",time,time+60000);
 assert.deepEqual([row.open,row.high,row.low,row.close,row.lastAt],[8,15,7,14,time+5000]);
 calls=0;await candleUpdate([]);await candleUpdate([{BTC:{micro:NaN,at:time}}]);
 assert.equal(calls,0);
 }finally{Collection.prototype.bulkWrite=bulk;await database.dropDatabase();await closeDatabase();}
});
