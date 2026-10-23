import test,{mock} from "node:test";
import assert from "node:assert/strict";

const calls:string[]=[];
let failIndex=false;
const room={marketSymbols:{crypto:["BTC"],stocks:[],forex:[],delisted:[],revision:0}};
const rows=[{symbol:"BTC",time:60000},{symbol:"BTC",time:0}];
const collection={
 createIndex:async()=>{calls.push("index");if(failIndex)throw new Error("index unavailable");},
 bulkWrite:async(ops:unknown[],options:unknown)=>{calls.push("bulkWrite");assert.equal(ops.length,6);assert.deepEqual(options,{ordered:true});},
 findOne:async()=>{calls.push("findOne");return room;},
 find:()=>{
  calls.push("find");
  return {sort:(sort:unknown)=>{
   assert.deepEqual(sort,{time:-1});
   return {limit:(limit:number)=>{
    assert.equal(limit,1000);
    return {toArray:async()=>{calls.push("toArray");return [...rows];}};
   }};
  }};
 },
};
mock.module("../lib/db.ts",{namedExports:{
 db:async()=>{calls.push("db");return {collection:(name:string)=>{calls.push("collection:"+name);return collection;}};},
 readRoom:async()=>{calls.push("readRoom");return room;},
}});
const {candleUpdate,candleRead}=await import("../lib/candles");
const quote={BTC:{micro:100_000_000,at:60000}};

test("QA candle protection and cached indexes survive same-process environment switches",async()=>{
 const previous=process.env.QA_PROTECTED_COLLECTIONS,marker=process.env.SSG_ISOLATED_QA;
 delete process.env.SSG_ISOLATED_QA;
 try {
  for(const value of ["candles"," rooms, candles , audit ","candles,candles"]){
   process.env.QA_PROTECTED_COLLECTIONS=value;calls.length=0;
   await candleUpdate(quote);
   await candleUpdate(quote,{} as never);
   await candleUpdate({});
   assert.deepEqual(calls,[],"protected updates must return before ALL Mongo and room operations");
  }
  calls.length=0;
  assert.deepEqual(await candleRead("BTC","1m",0,60000),[...rows].reverse());
  assert.deepEqual(calls,["readRoom","db","collection:candles","find","toArray"]);

  // Protected reads must not cache a fake index success; first unprotected access creates it.
  delete process.env.QA_PROTECTED_COLLECTIONS;calls.length=0;failIndex=true;
  await assert.rejects(candleUpdate(quote),/index unavailable/);
  assert.deepEqual(calls,["db","collection:candles","index"]);
  failIndex=false;calls.length=0;
  await candleUpdate(quote);
  assert.deepEqual(calls,["db","collection:candles","index","readRoom","bulkWrite"]);

  // A cached index promise is not awaited in protected mode and is retained for normal mode.
  process.env.QA_PROTECTED_COLLECTIONS="candles";calls.length=0;
  await candleUpdate(quote);
  assert.deepEqual(calls,[]);
  await candleRead("BTC","1m",0,60000);
  assert.deepEqual(calls,["readRoom","db","collection:candles","find","toArray"]);
  for(const value of ["","rooms","CANDLES","candles_archive","notcandles","true","*"]){
   process.env.QA_PROTECTED_COLLECTIONS=value;calls.length=0;
   await candleUpdate(quote);
   assert.deepEqual(calls,["db","collection:candles","readRoom","bulkWrite"],value);
  }
  calls.length=0;
  await candleRead("BTC","1m",0,60000);
  assert.deepEqual(calls,["readRoom","db","collection:candles","find","toArray"]);
  process.env.SSG_ISOLATED_QA="1";
  for(const invalid of [undefined,"","CANDLES","candles,rooms"," candles"]){
   if(invalid===undefined)delete process.env.QA_PROTECTED_COLLECTIONS;
   else process.env.QA_PROTECTED_COLLECTIONS=invalid;
   calls.length=0;
   await assert.rejects(candleUpdate(quote),/Isolated QA requires/);
   await assert.rejects(candleRead("BTC","1m",0,60000),/Isolated QA requires/);
   assert.deepEqual(calls,[],"malformed isolated QA fails before every DB operation");
  }
 } finally {
  if(marker===undefined)delete process.env.SSG_ISOLATED_QA;else process.env.SSG_ISOLATED_QA=marker;
  if(previous===undefined)delete process.env.QA_PROTECTED_COLLECTIONS;
  else process.env.QA_PROTECTED_COLLECTIONS=previous;
 }
});
