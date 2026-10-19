import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { aggregateCandles, archivePlan, GRANULARITIES, parseArchive, parseKline, retryDelay, coinbasePages, parseCoinbaseCandles, assessBackfillSpace, historyPlan } from "../lib/candles";
const time=Date.UTC(2026,0,1);
const line=(at:number,o=10,h=15,l=8,c=12,v=2)=>[at,o,h,l,c,v,at+59999,0,1,0,0,0].join(",");
test("parses milliseconds and post-2025 microseconds identically",()=>{
 assert.deepEqual(parseKline(line(time),"BTC"),parseKline(line(time*1000),"BTC"));
 assert.equal(parseKline("open_time,open,high,low,close,volume","BTC"),null);
 assert.equal(parseKline("","BTC"),null);
});
test("rejects malformed and invalid market rows",()=>{
 for(const row of ["junk",line(time,20,15,8,12),line(time,10,15,8,12,-1),line(time+1),line(time,NaN),"1,,,,,"])assert.throws(()=>parseKline(row,"BTC"));
});
test("aggregation preserves OHLC order, sums volume once, and aligns UTC",()=>{
 const a=parseKline(line(time),"BTC")!,b=parseKline(line(time+60000,12,20,9,18,3),"BTC")!;
 const result=aggregateCandles([b,a,a],"5m");
 assert.equal(result.length,1);
 assert.deepEqual([result[0].time,result[0].open,result[0].high,result[0].low,result[0].close,result[0].volume],[time,10,20,8,18,5]);
 assert.equal(result[0].lastAt,time+119999);
 assert.deepEqual(aggregateCandles([b,a,a],"5m"),aggregateCandles([a,b],"5m"));
 for(const g of Object.keys(GRANULARITIES) as (keyof typeof GRANULARITIES)[])assert.equal(aggregateCandles([a],g)[0].time%GRANULARITIES[g],0);
});
test("ZIP parser filters exact requested range and accepts CRLF",()=>{
 const data=zipSync({"BTCUSDT-1m.csv":strToU8([line(time-60000),line(time*1000),line((time+60000)*1000)].join("\r\n"))});
 assert.equal(parseArchive(data,"BTC",time,time+60000).length,1);
 assert.throws(()=>parseArchive(zipSync({"bad.txt":strToU8("hello")}),"BTC",0,Infinity));
});
test("plan is deterministic and restart safe, fixed allowlist only, 360 days",()=>{
 const now=Date.UTC(2026,9,19,13);
 const plan=archivePlan(now);
 assert.deepEqual(plan,archivePlan(now));
 assert.equal(new Set(plan.map(j=>j._id)).size,plan.length);
 assert.equal(new Set(plan.map(j=>j.symbol)).size,20);
 assert.equal(plan[0].to-plan[0].from,360*86400000);
 for(const job of plan){assert.equal(job.status,"pending");assert.equal(job.attempts,0);assert.ok(job.kind==="monthly"?job.period<"2026-10":job.period>="2026-10-01"&&job.period<"2026-10-19");}
});
test("retry backoff is bounded",()=>{
 assert.equal(retryDelay(1),5000);
 assert.ok(retryDelay(2)>retryDelay(1));
 assert.ok(retryDelay(100)<=6*60*60*1000);
});

// Opt-in Mongo coverage. This deliberately refuses any shared/production database.
test("Mongo persistence, out-of-order snapshots, partial-import retry, leases and missing archive",{skip:!process.env.CANDLE_MONGO_TEST},async()=>{
 if(!process.env.MONGODB_DB?.startsWith("fakebucks_test_candles_"))throw new Error("Refusing non-test candle database");
 const {db,closeDatabase}=await import("../lib/db");
 process.env.CANDLE_ARCHIVE_BACKFILL_ENABLED="1";
 const {candleUpdate,candleRead,backfillStep}=await import("../lib/candles");
 const {createHash}=await import("node:crypto");
 const database=await db(),fetchOriginal=globalThis.fetch;
 try {
 await database.dropDatabase();
 await candleUpdate({BTC:{micro:10_000_000,at:time+1000}});
 await candleUpdate({BTC:{micro:12_000_000,at:time+3000}});
 await candleUpdate({BTC:{micro:8_000_000,at:time+2000}});
 await candleUpdate({BTC:{micro:8_000_000,at:time+2000}});
 const [point]=await candleRead("BTC","1m",time,time+60000);
 assert.deepEqual([point.open,point.high,point.low,point.close,point.volume],[10,12,8,12,0]);
 assert.equal((await database.collection("candles").countDocuments()),6);
 const plan=archivePlan();
 await database.collection<{_id:string;status?:string}>("candle_backfill").insertMany(plan.map(j=>({...j,status:"done"})));
 const target=plan.find(j=>j.symbol==="ETH"&&j.kind==="monthly"&&Date.parse(j.period+"-15T00:00:00Z")>=j.from)!;
 const targetTime=Date.parse(target.period+"-15T00:00:00Z");
 await database.collection<{_id:string;status?:string}>("candle_backfill").updateOne({_id:target._id},{$set:{status:"pending"}});
 const zip=zipSync({"ETHUSDT-1m.csv":strToU8([line(targetTime*1000),line((targetTime+60000)*1000)].join("\n"))});
 let requests=0;
 globalThis.fetch=(async(input:unknown)=>{requests++;return String(input).endsWith(".CHECKSUM")?new Response(createHash("sha256").update(zip).digest("hex")+" archive.zip"):new Response(zip);}) as typeof fetch;
 assert.equal((await backfillStep()).status,"processed");
 const firstCount=await database.collection("candles").countDocuments();
 // Simulate a crash before the completion marker. Re-import must not duplicate volume or rows.
 await database.collection<{_id:string;status?:string}>("candle_backfill").updateOne({_id:target._id},{$set:{status:"pending"}});
 await database.collection<{_id:string;nextAt:number}>("workers").updateOne({_id:"candle-backfill"},{$set:{nextAt:0}});
 assert.equal((await backfillStep()).status,"processed");
 assert.equal(await database.collection("candles").countDocuments(),firstCount);
 const history=await candleRead("ETH","5m",targetTime,targetTime+300000);
 assert.equal(history[0].volume,4);
 assert.equal(requests,4);
 const missing=plan.find(j=>j.symbol==="HYPE"&&j.kind==="monthly")!;
 await database.collection<{_id:string;status?:string}>("candle_backfill").updateOne({_id:missing._id},{$set:{status:"pending"}});
 await database.collection<{_id:string;nextAt:number}>("workers").updateOne({_id:"candle-backfill"},{$set:{nextAt:0}});
 globalThis.fetch=(async()=>new Response("missing",{status:404})) as typeof fetch;
 await backfillStep();
 assert.equal((await database.collection<{_id:string;status?:string}>("candle_backfill").findOne({_id:missing._id}))?.status,"missing");
 } finally {globalThis.fetch=fetchOriginal;await database.dropDatabase();await closeDatabase();}
});

test("Coinbase pages go backwards, never exceed 300 buckets, and preserve overlapping request keys",()=>{
 const pages=coinbasePages(time,time+700*60000,60000);
 assert.ok(pages.length>=3);
 for(const p of pages)assert.equal((p.to-p.from)/60000,300);
 assert.ok(pages[0].from>pages[1].from);
 const overlap=coinbasePages(time+60000,time+699*60000,60000);
 assert.deepEqual(pages,overlap);
});
test("Coinbase rows decode OHLCV seconds and never synthesize empty buckets",()=>{
 const row=[time/1000,8,15,10,12,2];
 const parsed=parseCoinbaseCandles([row,row],"BTC","1m",time,time+60000);
 assert.equal(parsed.length,1);
 assert.deepEqual([parsed[0].open,parsed[0].high,parsed[0].low,parsed[0].close,parsed[0].volume],[10,15,8,12,2]);
 assert.deepEqual(parseCoinbaseCandles([],"BTC","1m",time,time+60000),[]);
 assert.deepEqual(parseCoinbaseCandles([row],"BTC","1m",time+60000,time+120000),[]);
 assert.throws(()=>parseCoinbaseCandles([[time/1000,20,15,10,12,2]],"BTC","1m",time,time+60000));
 assert.throws(()=>parseCoinbaseCandles(Array(301).fill(row),"BTC","1m",time,time+60000));
 assert.equal(GRANULARITIES["6h"],21600000);
});

test("archive space guard blocks low or unknown free capacity before download",()=>{
 assert.equal(assessBackfillSpace(1024**3).blocked,true);
 assert.equal(assessBackfillSpace(NaN).blocked,true);
 assert.equal(assessBackfillSpace(2*1024**3).blocked,false);
 assert.match(assessBackfillSpace(1).reason!,/blocked/);
});

test("background year plan includes all 20 symbols and six granularities, deterministic deduped pages",()=>{
 const now=Date.UTC(2026,9,19,13),plan=historyPlan(now);
 assert.equal(new Set(plan.map(j=>j.symbol)).size,20);
 assert.equal(new Set(plan.map(j=>j.granularity)).size,6);
 assert.equal(new Set(plan.map(j=>j._id)).size,plan.length);
 assert.deepEqual(plan,historyPlan(now));
 const btc=plan.filter(j=>j.symbol==="BTC"&&j.granularity==="1m");
 assert.ok(btc.length>=1728&&btc.length<=1730);
 assert.ok(plan.every(j=>j.background&&j.status==="pending"));
});
