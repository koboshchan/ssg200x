import {test} from "node:test";
import assert from "node:assert/strict";
import {FOREX_DEFAULTS,forexMarketOpen,parseForexRate,forexDecision,validForexPair,dailyForexCredits,forexCadence,type ForexStatus} from "../lib/forex-policy";
import {reserveForexBudget,type ForexBudget} from "../lib/forex-budget";
import {freshRoom,register} from "../lib/poker";
import {spot,openPosition,stockExecutable,liquidate} from "../lib/finance";
import {applyMarketTick} from "../lib/market-tick";
import {settleTriggers} from "../lib/position-triggers";
const at=Date.parse("2026-10-21T15:00:00Z"),status:ForexStatus={mode:"live",marketOpen:true,cadenceSeconds:660,dailyUsed:6,dailyLimit:800,message:"test"};
test("six explicit pairs, CNY not silently CNH, safe cadence",()=>{assert.deepEqual(FOREX_DEFAULTS,["AUD/JPY","CAD/USD","CNY/USD","EUR/USD","USD/JPY","GBP/USD"]);assert.ok(validForexPair("CNY/USD"));assert.ok(!validForexPair("ABC/DEF"));assert.ok(!validForexPair("USD/USD"));assert.equal(dailyForexCredits(6,660),786);assert.equal(forexCadence(1),660);assert.equal(forexCadence(1200),1200);});
test("forex Friday Sunday 17 New York closure handles EST EDT DST",()=>{
 for(const [date,open] of [["2026-07-10T20:59:59Z",true],["2026-07-10T21:00:00Z",false],["2026-07-12T20:59:59Z",false],["2026-07-12T21:00:00Z",true],["2026-01-09T21:59:59Z",true],["2026-01-09T22:00:00Z",false],["2026-01-11T21:59:59Z",false],["2026-01-11T22:00:00Z",true],["2026-03-08T20:59:59Z",false],["2026-03-08T21:00:00Z",true],["2026-11-01T21:59:59Z",false],["2026-11-01T22:00:00Z",true]] as const)assert.equal(forexMarketOpen(Date.parse(date)),open,date);
});
test("real provider strict10s exact symbol numerical rate and event timestamp only",()=>{
 const good={symbol:"EUR/USD",rate:1.1,timestamp:at/1000};
 assert.ok(parseForexRate(good,"EUR/USD",at+10000));assert.equal(parseForexRate(good,"EUR/USD",at+10001),null);
 for(const patch of [{timestamp:undefined},{timestamp:at/1000+1},{rate:"1.1"},{rate:0},{rate:Infinity},{symbol:"EUR/CNH"}])assert.equal(parseForexRate({...good,...patch},"EUR/USD",at),null);
});
test("mock, missing status, stale and nonUSD pairs never executable",()=>{
 const q={micro:1100000,at,source:"twelvedata" as const,quoteCurrency:"USD"};
 assert.ok(forexDecision("EUR/USD",q,status,at+10000).executable);assert.ok(!forexDecision("EUR/USD",q,status,at+10001).executable);
 assert.ok(!forexDecision("EUR/USD",{...q,source:"mock"},status,at).executable);
 assert.ok(!forexDecision("EUR/USD",q,{...status,mode:"unconfigured"},at).executable);
 assert.ok(!forexDecision("AUD/JPY",{...q,quoteCurrency:"JPY"},status,at).executable);
 assert.ok(!forexDecision("USD/JPY",{...q,quoteCurrency:"JPY"},status,at).executable);
});
const base=():ForexBudget=>({_id:"global",revision:0,day:"2026-10-21",used:0,recent:[],nextPollAt:0});
test("global budget 800 credits, rolling8 minute, restart cadence, midnight and clock regression",()=>{
 const b=reserveForexBudget(base(),6,at,660000)!;assert.equal(b.used,6);assert.equal(b.nextPollAt,at+660000);
 assert.equal(reserveForexBudget(b,6,at+600001,660000),null);
 assert.equal(reserveForexBudget(b,3,at+1),null);
 assert.equal(reserveForexBudget({...base(),used:799},2,at),null);
 assert.equal(reserveForexBudget({...base(),used:799},1,at)!.used,800);
 assert.equal(reserveForexBudget({...base(),used:800},1,Date.parse("2026-10-22T00:00:00Z"))!.used,1);
 assert.equal(reserveForexBudget(b,1,at-1),null);
 assert.equal(reserveForexBudget({...base(),day:"2026-10-22"},1,at),null);
 assert.equal(reserveForexBudget(base(),NaN,at),null);assert.equal(reserveForexBudget(base(),9,at),null);
});
test("USD forex accounting live-only, stale/mock ticks cannot liquidate or settle triggers",()=>{
 const old=process.env.TWELVEDATA_API_KEY;process.env.TWELVEDATA_API_KEY="unit-test-only";
 const r=Object.assign(freshRoom(),{perpFeePpm:0}),who={id:"fx",name:"FX",email:"fx@test",admin:true};register(r,who);
 r.forexStatus=status;r.forexQuotes={"EUR/USD":{micro:1100000,at,source:"twelvedata",quoteCurrency:"USD"}};
 applyMarketTick(r,{"EUR/USD":{micro:1100000,at}},at);
 spot(r,who,"EUR/USD","buy",1000,at);openPosition(r,who,"EUR/USD","long",1000,100,"fxp",at);
 assert.ok(stockExecutable(r,"EUR/USD",at));assert.ok(!stockExecutable(r,"EUR/USD",at+10001));
 const wallet=r.members[0].wallet;
 r.forexStatus={...status,mode:"mock"};r.forexQuotes["EUR/USD"]={micro:1,at:at+1,source:"mock",quoteCurrency:"USD"};
 applyMarketTick(r,{"EUR/USD":{micro:1,at:at+1}},at+1);liquidate(r,at+1);settleTriggers(r,at+1);
 assert.equal(r.members[0].positions!.length,1);assert.equal(r.members[0].wallet,wallet);
 assert.throws(()=>spot(r,who,"EUR/USD","buy",100,at+1),/Forex paused/);
 assert.throws(()=>spot(r,who,"AUD/JPY","buy",100,at+1));
 if(old===undefined)delete process.env.TWELVEDATA_API_KEY;else process.env.TWELVEDATA_API_KEY=old;
});


// Each regression owns and restores process configuration; never use provider credentials.
import {forexLiveConfigured} from "../lib/forex-config";
import {closePosition} from "../lib/finance";
import {changeMarketSymbol} from "../lib/admin-symbols";
import {MongoClient} from "mongodb";
import {randomUUID} from "node:crypto";
function testEnv(values:Record<string,string|undefined>){
 const previous=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));
 for(const [k,v] of Object.entries(values))if(v===undefined)delete process.env[k];else process.env[k]=v;
 return ()=>{for(const [k,v]of Object.entries(previous))if(v===undefined)delete process.env[k];else process.env[k]=v;};
}
function liveFixture(){
 const r=freshRoom(),who={id:"audit-fx",name:"FX",email:"audit@test",admin:true};register(r,who);
 r.forexStatus={...status};r.forexQuotes={"EUR/USD":{micro:1100000,at,source:"twelvedata",quoteCurrency:"USD"}};
 r.quotes={"EUR/USD":{micro:1100000,at}};return {r,who};
}
test("server config cannot be authorized by persisted live mode after restart",()=>{
 assert.equal(forexLiveConfigured({NODE_ENV:"production",FOREX_DEMO_MOCK:"1"}),false);
 assert.equal(forexLiveConfigured({NODE_ENV:"production",TWELVEDATA_API_KEY:"  "}),false);
 assert.equal(forexLiveConfigured({NODE_ENV:"development",TWELVEDATA_API_KEY:"test",FOREX_DEMO_MOCK:"1"}),false);
 assert.equal(forexLiveConfigured({NODE_ENV:"production",TWELVEDATA_API_KEY:"test",FOREX_DEMO_MOCK:"1"}),true);
 const restore=testEnv({NODE_ENV:"production",TWELVEDATA_API_KEY:"unit-test-only",FOREX_DEMO_MOCK:"1"});
 try{
  const {r,who}=liveFixture();openPosition(r,who,"EUR/USD","long",1000,100,"restart",at);
  const restored=JSON.parse(JSON.stringify(r)) as typeof r;delete process.env.TWELVEDATA_API_KEY;
  const before=JSON.stringify(restored);
  assert.equal(stockExecutable(restored,"EUR/USD",at+1),false);
  assert.throws(()=>spot(restored,who,"EUR/USD","buy",100,at+1),/Forex paused/);
  assert.throws(()=>closePosition(restored,who,"restart",at+1),/Forex paused/);
  restored.forexQuotes!["EUR/USD"]={micro:1,at:at+1,source:"twelvedata",quoteCurrency:"USD"};
  applyMarketTick(restored,{"EUR/USD":{micro:1,at:at+1}},at+1);
  assert.equal(restored.quotes!["EUR/USD"]!.micro,1100000);
  restored.forexQuotes!["EUR/USD"]={micro:1100000,at,source:"twelvedata",quoteCurrency:"USD"};
  liquidate(restored,at+1);settleTriggers(restored,at+1);
  assert.equal(JSON.stringify(restored),before);
  process.env.TWELVEDATA_API_KEY="unit-test-only";
  assert.equal(stockExecutable(restored,"EUR/USD",at+10001),false);
  assert.throws(()=>closePosition(restored,who,"restart",at+10001),/Forex paused/);
 }finally{restore();}
});
test("forex duplicates rejected without consuming capacity or incrementing revision",()=>{
 const {r,who}=liveFixture();r.marketSymbols={crypto:[],stocks:[],forex:["EUR/USD"],delisted:[],revision:0};
 assert.throws(()=>changeMarketSymbol(r,who,{action:"add",kind:"forex",symbol:"EUR/USD",expectedVersion:0}),/already listed/);
 assert.deepEqual(r.marketSymbols.forex,["EUR/USD"]);assert.equal(r.marketSymbols.revision,0);
});
test("real Mongo forex budget CAS, durable restart, fenced candle and missing-key regression",async t=>{
 const uri=process.env.FOREX_TEST_MONGODB_URI??"mongodb://127.0.0.1:27517/?replicaSet=rs0";
 const client=new MongoClient(uri,{serverSelectionTimeoutMS:2000});
 try{await client.connect();}catch{await client.close();t.skip("Dedicated forex Mongo replica set unavailable");return;}
 const name="forex_audit_"+randomUUID().replaceAll("-",""),database=client.db(name);
 const restore=testEnv({MONGODB_URI:uri,MONGODB_DB:name,NODE_ENV:"production",TWELVEDATA_API_KEY:"unit-test-only",FOREX_DEMO_MOCK:"1"});
 const originalNow=Date.now;Date.now=()=>at;
 const {db,closeDatabase}=await import("../lib/db");
 try{
  await closeDatabase();
  const {reserveForexCredits}=await import("../lib/forex-feed");
  const results=await Promise.all(Array.from({length:20},()=>reserveForexCredits(1,at)));
  assert.equal(results.filter(Boolean).length,8);assert.equal((await database.collection("providerBudgets").findOne({}))!.used,8);
  await closeDatabase();assert.equal(await reserveForexCredits(1,at),null);
  await database.collection("providerBudgets").updateOne({},{$set:{used:799,recent:[],nextPollAt:at+660000}});
  const last=await Promise.all(Array.from({length:12},()=>reserveForexCredits(1,at)));
  assert.equal(last.filter(Boolean).length,1);assert.equal((await database.collection("providerBudgets").findOne({}))!.used,800);
  await closeDatabase();assert.equal(await reserveForexCredits(1,at),null);
  await database.collection("providerBudgets").updateOne({},{$set:{used:0,recent:[]}});
  assert.equal(await reserveForexCredits(6,at+60000,660000),null);

  const {r}=liveFixture();await database.collection("rooms").insertOne(r as never);
  await database.collection("workers").insertOne({_id:"coinbase-feed",owner:"audit-owner",until:at+15000} as never);
  const {candleUpdate}=await import("../lib/candles");const {mutateStockPublication}=await import("../lib/store");
  // Precreate the unique index outside transactions, as the production warmup does.
  await candleUpdate({});
  const snapshot={"EUR/USD":{micro:1100000,at}};
  await candleUpdate(snapshot);assert.equal(await database.collection("candles").countDocuments(),0);
  await mutateStockPublication("audit-owner",()=>{},session=>candleUpdate(snapshot,session));
  assert.equal(await database.collection("candles").countDocuments(),6);
  await database.collection("candles").deleteMany({});delete process.env.TWELVEDATA_API_KEY;
  await closeDatabase(); // Actual connection restart with persisted live state, no worker clearing it.
  await mutateStockPublication("audit-owner",()=>{},session=>candleUpdate(snapshot,session));
  assert.equal(await database.collection("candles").countDocuments(),0);
  const persisted=await (await db()).collection<typeof r>("rooms").findOne({_id:"main"});
  assert.equal(stockExecutable(persisted!,"EUR/USD",at),false);
  assert.throws(()=>spot(persisted!,{id:"audit-fx",name:"FX",email:"audit@test",admin:true},"EUR/USD","buy",100,at),/Forex paused/);
  process.env.TWELVEDATA_API_KEY="unit-test-only";
  await assert.rejects(mutateStockPublication("wrong-owner",()=>{},session=>candleUpdate(snapshot,session)),/lease revoked/);
  assert.equal(await database.collection("candles").countDocuments(),0);
  // Expiry during the candle callback must roll back BOTH room and candle writes.
  const beforeExpiry=await database.collection("rooms").findOne({_id:"main"} as never);
  await assert.rejects(mutateStockPublication("audit-owner",room=>{room.forexCadenceSeconds=1200;},async session=>{
   await candleUpdate(snapshot,session);Date.now=()=>at+2000;
  }),/publication expired/);
  Date.now=()=>at;
  assert.equal((await database.collection("rooms").findOne({_id:"main"} as never))!.version,beforeExpiry!.version);
  assert.equal((await database.collection("rooms").findOne({_id:"main"} as never))!.forexCadenceSeconds,beforeExpiry!.forexCadenceSeconds);
  assert.equal(await database.collection("candles").countDocuments(),0);
  // Even matching persisted marks must not authorize fractional/unsafe candle micro values.
  for(const micro of [1.5,Number.MAX_SAFE_INTEGER+1,0,-1]){
   await mutateStockPublication("audit-owner",room=>{
    room.forexQuotes!["EUR/USD"]={micro,at,source:"twelvedata",quoteCurrency:"USD"};
    room.quotes!["EUR/USD"]={micro,at};
   },session=>candleUpdate({"EUR/USD":{micro,at}},session));
   assert.equal(await database.collection("candles").countDocuments(),0,String(micro));
  }
  await mutateStockPublication("audit-owner",room=>{
   room.forexQuotes!["EUR/USD"]={micro:1100000,at,source:"twelvedata",quoteCurrency:"USD"};
   room.quotes!["EUR/USD"]={micro:1100000,at};
  });
  // Exercise the actual poll entrypoint, not only its helper, with a stale owner.
  await database.collection("providerBudgets").updateOne({},{$set:{used:0,recent:[],nextPollAt:0}});
  const {pollForex}=await import("../lib/forex-feed");
  await assert.rejects(pollForex(()=>true,"wrong-owner",async()=>Response.json({symbol:"EUR/USD",rate:1.1,timestamp:at/1000})),/lease revoked/);
  assert.equal(await database.collection("candles").countDocuments(),0);
 }finally{Date.now=originalNow;await closeDatabase();restore();await database.dropDatabase();await client.close();}
});

import {financeSchema} from "../lib/finance-input";
test("actual finance schema accepts explicit forex symbols without loosening malformed symbols",()=>{
 const base={requestId:randomUUID(),requestAt:at};
 for(const symbol of [...FOREX_DEFAULTS,"BTC","AAPL","BRK.B"]){
  for(const input of [
   {...base,type:"spot",symbol,side:"buy",amount:100},
   {...base,type:"open",symbol,side:"long",margin:100,leverage:1},
   {...base,type:"sell-all-spot",symbol},
  ])assert.equal(financeSchema.safeParse(input).success,true,JSON.stringify(input));
 }
 for(const symbol of ["eur/USD","EUR//USD","USD/USD","ABC/DEF","EUR/USD?x=1","EUR/USD/JPY"," EUR/USD"]){
  assert.equal(financeSchema.safeParse({...base,type:"spot",symbol,side:"buy",amount:100}).success,false,symbol);
 }
});
test("forex removal refuses holdings or positions without changing claims, allows empty pairs",()=>{
 const restore=testEnv({NODE_ENV:"production",TWELVEDATA_API_KEY:"unit-test-only",FOREX_DEMO_MOCK:undefined});
 try{
  for(const kind of ["holding","position"] as const){
   const {r,who}=liveFixture();r.marketSymbols={crypto:[],stocks:[],forex:["EUR/USD"],delisted:[],revision:0};
   if(kind==="holding")spot(r,who,"EUR/USD","buy",100,at);
   else openPosition(r,who,"EUR/USD","long",100,1,"claim",at);
   const before=JSON.stringify(r);
   assert.throws(()=>changeMarketSymbol(r,who,{action:"remove",kind:"forex",symbol:"EUR/USD",expectedVersion:0,confirmed:true}),/open claims/);
   assert.equal(JSON.stringify(r),before);
  }
  const {r,who}=liveFixture();r.marketSymbols={crypto:[],stocks:[],forex:["EUR/USD"],delisted:[],revision:0};
  changeMarketSymbol(r,who,{action:"remove",kind:"forex",symbol:"EUR/USD",expectedVersion:0,confirmed:true});
  assert.deepEqual(r.marketSymbols.forex,[]);assert.equal(r.marketSymbols.revision,1);
 }finally{restore();}
});


test("forex decisions reject corrupt micro values even with exact matching live marks",()=>{
 const restore=testEnv({NODE_ENV:"production",TWELVEDATA_API_KEY:"unit-test-only",FOREX_DEMO_MOCK:undefined});
 try{
  const {r}=liveFixture();
  for(const micro of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]){
   const q={micro,at,source:"twelvedata" as const,quoteCurrency:"USD"};
   r.forexQuotes!["EUR/USD"]=q;r.quotes!["EUR/USD"]={micro,at};
   assert.equal(forexDecision("EUR/USD",q,status,at).executable,false,String(micro));
   assert.equal(stockExecutable(r,"EUR/USD",at),false,String(micro));
  }
  r.forexQuotes!["EUR/USD"]={micro:1100000,at,source:"twelvedata",quoteCurrency:"USD"};
  r.quotes!["EUR/USD"]={micro:1100001,at};
  assert.equal(stockExecutable(r,"EUR/USD",at),false);
 }finally{restore();}
});
