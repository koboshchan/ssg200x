import test, {mock} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {candleEnsure,coinbasePages} from "../lib/candles";
import {db,closeDatabase} from "../lib/db";

test("Mongo page leases dedupe slow requests across processes, cache completions and fence recovery", {skip:!process.env.CANDLE_MONGO_TEST},async()=>{
 assert.ok(process.env.MONGODB_DB?.startsWith("fakebucks_test_candles_"));
 const database=await db(),original=globalThis.fetch;
 const capacity=mock.method(fs,"statfs",async()=>({bavail:10*1024**3,bsize:1}) as Awaited<ReturnType<typeof fs.statfs>>);
 const coverage=database.collection<{_id:string;leaseOwner?:string;leaseUntil?:number;status?:string;completedToken?:string}>("candle_coverage");
 const workers=database.collection<{_id:string;nextAt:number}>("workers");
 const from=Date.UTC(2026,0,1),to=from+60000,id="BTC:1m:"+coinbasePages(from,to,60000)[0].from;
 let count=0;
 const reset=async()=>{await database.dropDatabase();};
 const budget=async()=>{await workers.updateOne({_id:"coinbase-history-budget"},{$set:{nextAt:0}},{upsert:true});};
 function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};}
 try{
 await reset();
 let entered=deferred(),release=deferred();
 globalThis.fetch=(async()=>{count++;entered.resolve();await release.promise;return new Response("[]");}) as typeof fetch;
 const first=candleEnsure("BTC","1m",from,to);
 await entered.promise;
 await new Promise(r=>setTimeout(r,400));
 assert.equal((await candleEnsure("BTC","1m",from,to)).status,"pending");
 const child=await promisify(execFile)(process.execPath,["--import","tsx","-e",`require('node:fs/promises').statfs=async()=>({bavail:10*1024**3,bsize:1});const c=require('./lib/candles.ts');const d=require('./lib/db.ts');global.fetch=async()=>{throw Error('duplicate upstream request')};c.candleEnsure('BTC','1m',${from},${to}).then(x=>{console.log(JSON.stringify(x));return d.closeDatabase()}).catch(e=>{console.error(e);process.exit(1)})`],{env:process.env});
 assert.equal(JSON.parse(child.stdout.trim()).status,"pending");
 assert.equal(count,1);
 release.resolve();
 assert.equal((await first).status,"cached");
 assert.equal((await candleEnsure("BTC","1m",from,to)).status,"cached");
 assert.equal(count,1);
 assert.equal((await coverage.findOne({_id:id}))?.leaseOwner,undefined);

 // Complete a different request after this caller's initial cache read,
 // but before its claim. The post-claim recheck must suppress stale work.
 await reset();count=0;
 capacity.mock.mockImplementationOnce(async()=>{
  await coverage.updateOne({_id:id},{$set:{status:"done",completedToken:"racing-completion",expiresAt:Number.MAX_SAFE_INTEGER}},{upsert:true});
  return {bavail:10*1024**3,bsize:1} as Awaited<ReturnType<typeof fs.statfs>>;
 });
 globalThis.fetch=(async()=>{count++;throw Error("stale pre-read refetched");}) as typeof fetch;
 assert.equal((await candleEnsure("BTC","1m",from,to)).status,"cached");
 assert.equal(count,0);

 // A crashed owner's expired lease is recoverable, including after fetch errors.
 await coverage.updateOne({_id:id},{$set:{status:"pending",leaseOwner:"dead-process",leaseUntil:Date.now()-1}});
 await budget();
 globalThis.fetch=(async()=>{count++;throw Error("network down");}) as typeof fetch;
 assert.equal((await candleEnsure("BTC","1m",from,to)).status,"retry");
 assert.equal((await coverage.findOne({_id:id}))?.leaseOwner,undefined);
 await budget();
 globalThis.fetch=(async()=>{count++;return new Response("[]");}) as typeof fetch;
 assert.equal((await candleEnsure("BTC","1m",from,to)).status,"cached");

 // A displaced owner must publish neither coverage nor rows, or clear successor.
 await coverage.updateOne({_id:id},{$set:{status:"pending"}});
 await budget();entered=deferred();release=deferred();
 globalThis.fetch=(async()=>{entered.resolve();await release.promise;return new Response(JSON.stringify([[from/1000,8,15,10,12,2]]));}) as typeof fetch;
 const displaced=candleEnsure("BTC","1m",from,to);await entered.promise;
 await coverage.updateOne({_id:id},{$set:{leaseOwner:"successor",leaseUntil:Date.now()+30000}});
 release.resolve();
 assert.equal((await displaced).status,"pending");
 assert.equal((await coverage.findOne({_id:id}))?.leaseOwner,"successor");
 assert.equal(await database.collection("candles").countDocuments(),0);

 // Exact window calls coalesce while active, but sequential refresh is intentional.
 await reset();entered=deferred();release=deferred();count=0;
 globalThis.fetch=(async()=>{count++;entered.resolve();await release.promise;return new Response("[]");}) as typeof fetch;
 const window={from,to};
 const refresh=candleEnsure("BTC","1m",from,to-1,window);await entered.promise;
 await new Promise(r=>setTimeout(r,400));
 assert.equal((await candleEnsure("BTC","1m",from,to-1,window)).status,"pending");
 release.resolve();assert.equal((await refresh).status,"cached");assert.equal(count,1);
 await budget();
 assert.equal((await candleEnsure("BTC","1m",from,to-1,window)).status,"cached");assert.equal(count,2);
 }finally{globalThis.fetch=original;capacity.mock.restore();await database.dropDatabase();await closeDatabase();}
});
