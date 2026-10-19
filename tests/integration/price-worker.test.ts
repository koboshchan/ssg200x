import type {AnyBulkWriteOperation,BulkWriteOptions} from "mongodb";
import {test,after} from "node:test";
import assert from "node:assert/strict";
import {db,closeDatabase,readRoom} from "../../lib/db";
import {mutate} from "../../lib/store";
import {register} from "../../lib/poker";
import {openPosition} from "../../lib/finance";
import {startPriceWorker,persistExchangeTicks} from "../../lib/prices";
import {candleRead} from "../../lib/candles";
if(!process.env.MONGODB_DB?.startsWith("fakebucks_test_"))throw new Error("Requires isolated test DB");
process.env.MONGODB_DB+="_price_worker";
after(async()=>{await(await db()).dropDatabase();await closeDatabase();});
test("persistent serial burst checks same-millisecond transient TP with no clients and retains candle extrema",async()=>{
 const who={id:"background",name:"Background",email:"background@test",admin:false},now=Date.now()-1000;
 await mutate(r=>{register(r,who);r.quotes={BTC:{micro:100_000_000_000,at:now}};openPosition(r,who,"BTC","long",1000,200,"background",now,{takeProfit:100_100_000_000});});
 await closeDatabase();
 await persistExchangeTicks([{symbol:"BTC",micro:100_200_000_000,at:now+1,sequence:1},{symbol:"BTC",micro:100_000_000_000,at:now+1,sequence:2}]);
 const room=await readRoom();assert.equal(room.members[0].positions!.length,0);assert.equal(room.members[0].wallet,100400);assert.match(room.members[0].activity![0],/^Take-profit/);assert.equal(room.quotes!.BTC!.micro,100_000_000_000);
 const bucket=Math.floor((now+1)/60000)*60000,rows=await candleRead("BTC","1m",bucket,bucket);
 assert.equal(rows[0].high,100200);assert.equal(rows[0].low,100000);assert.equal(rows[0].close,100000);
 const boundary=Math.floor(Date.now()/60000)*60000;
 await persistExchangeTicks([{symbol:"ETH",micro:2000e6,at:boundary-1,sequence:1},{symbol:"ETH",micro:2001e6,at:boundary,sequence:2}]);
 const rollover=await candleRead("ETH","1m",boundary-60000,boundary);assert.equal(rollover.length,2);assert.equal(rollover[0].close,2000);assert.equal(rollover[1].open,2001);
});
test("global worker is HMR-idempotent, acquires Mongo leader lease and unchanged REST cannot refresh stale marks",async()=>{
 const originalFetch=globalThis.fetch,originalWS=globalThis.WebSocket;let sockets=0,calls=0;
 class MockSocket{readyState=0;onopen=null;onmessage=null;onerror=null;onclose=null;constructor(){sockets++;}send(){}close(){this.readyState=3;}}
 globalThis.WebSocket=MockSocket as unknown as typeof WebSocket;
 globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({data:{currency:"USD",rates:{BTC:"0.00001"}}}));};
 let worker:ReturnType<typeof startPriceWorker>|undefined;
 try{
  await mutate(r=>{r.quotes!.BTC={micro:100_000_000_000,at:Date.now()-20000};});
  const old=(await readRoom()).quotes!.BTC!.at;
  worker=startPriceWorker();assert.equal(startPriceWorker(),worker);await worker.ready;
  assert.equal(sockets,1);assert.equal(calls,0);assert.equal((await readRoom()).quotes!.BTC!.at,old);
  const lease=await(await db()).collection("workers").findOne({_id:"coinbase-feed"} as never);assert.equal(lease!.owner,worker.owner);assert.ok(lease!.until>Date.now());
 }finally{worker?.stop();globalThis.fetch=originalFetch;globalThis.WebSocket=originalWS;}
});
test("renewal DB error closes upstream immediately and losing Mongo leadership never opens a socket",async()=>{
 const originalWS=globalThis.WebSocket,originalNow=Date.now;const sockets:MockSocket[]=[];
 class MockSocket{readyState=1;onopen=null;onmessage=null;onerror=null;onclose=null;constructor(){sockets.push(this);}send(){}close(){this.readyState=3;}}
 globalThis.WebSocket=MockSocket as unknown as typeof WebSocket;
 const database=await db(),prototype=Object.getPrototypeOf(database),originalCollection=prototype.collection;
 let worker:ReturnType<typeof startPriceWorker>|undefined,now=Date.now();
 try{
  await database.collection("workers").deleteOne({_id:"coinbase-feed"} as never);
  worker=startPriceWorker();clearInterval(worker.timer);await worker.ready;assert.equal(sockets.length,1);
  Date.now=()=>now+11000;
  prototype.collection=function(this:typeof database,...args:Parameters<typeof database.collection>){const collection=originalCollection.apply(this,args);if(args[0]==="workers")collection.updateOne=async()=>{throw Error("simulated Mongo loss");};return collection;} as typeof database.collection;
  await worker.runOnce();assert.equal(sockets[0].readyState,3);
  prototype.collection=originalCollection;
  Date.now=originalNow;
  await database.collection("workers").updateOne({_id:"coinbase-feed"} as never,{$set:{owner:"other-process",until:Date.now()+15000}});
  await worker.runOnce();assert.equal(sockets.length,1);assert.equal(worker.feed.connected,false);
 }finally{
  Date.now=originalNow;prototype.collection=originalCollection;worker?.stop();globalThis.WebSocket=originalWS;
 }
});
test("64-tick candle batch uses one ordered bulkWrite and preserves transient extrema",async()=>{
 const database=await db(),prototype=Object.getPrototypeOf(database),originalCollection=prototype.collection;let writes=0;
 prototype.collection=function(this:typeof database,...args:Parameters<typeof database.collection>){
  const collection=originalCollection.apply(this,args);
  if(args[0]==="candles"){const bulk=collection.bulkWrite.bind(collection);collection.bulkWrite=async (ops:AnyBulkWriteOperation[],options?:BulkWriteOptions)=>{writes++;assert.equal(options?.ordered,true);return bulk(ops,options);};}
  return collection;
 } as typeof database.collection;
 try{
  const at=Date.now()-100;const start=performance.now();
  await persistExchangeTicks(Array.from({length:64},(_,i)=>({symbol:"SOL",micro:(100+i%3)*1e6,at:at+i,sequence:i+1})));
  const elapsed=performance.now()-start;
  assert.equal(writes,1);
  const bucket=Math.floor(at/60000)*60000,rows=await candleRead("SOL","1m",bucket,bucket+60000);
  assert.equal(Math.max(...rows.map(r=>r.high)),102);assert.equal(Math.min(...rows.map(r=>r.low)),100);
  console.log("64-tick CAS + ordered candle batch duration ms",Math.round(elapsed));
 }finally{prototype.collection=originalCollection;}
});
test("delayed claim acknowledgement past expiry cannot open a socket",async()=>{
 const originalWS=globalThis.WebSocket,originalNow=Date.now;let sockets=0,now=Date.now();
 class MockSocket{readyState=1;onopen=null;onmessage=null;onerror=null;onclose=null;constructor(){sockets++;}send(){}close(){this.readyState=3;}}
 globalThis.WebSocket=MockSocket as unknown as typeof WebSocket;Date.now=()=>now;
 const database=await db(),prototype=Object.getPrototypeOf(database),originalCollection=prototype.collection;
 await database.collection("workers").deleteOne({_id:"coinbase-feed"} as never);
 prototype.collection=function(this:typeof database,...args:Parameters<typeof database.collection>){
  const collection=originalCollection.apply(this,args);
  if(args[0]==="workers"){const update=collection.updateOne.bind(collection);collection.updateOne=async(...params:Parameters<typeof collection.updateOne>)=>{const result=await update(...params);if((params[0] as {_id?:string})._id==="coinbase-feed"&&(params[1] as {$set?:{owner?:string}}).$set?.owner)now+=16000;return result;};}
  return collection;
 } as typeof database.collection;
 let worker:ReturnType<typeof startPriceWorker>|undefined;
 try{worker=startPriceWorker();clearInterval(worker.timer);await worker.ready;assert.equal(sockets,0);}
 finally{prototype.collection=originalCollection;Date.now=originalNow;worker?.stop();globalThis.WebSocket=originalWS;}
});
test("independent watchdog closes socket while a renewal promise remains blocked",async()=>{
 const originalWS=globalThis.WebSocket,originalNow=Date.now;const sockets:MockSocket[]=[];let now=Date.now();
 class MockSocket{readyState=1;onopen=null;onmessage=null;onerror=null;onclose=null;constructor(){sockets.push(this);}send(){}close(){this.readyState=3;}}
 globalThis.WebSocket=MockSocket as unknown as typeof WebSocket;Date.now=()=>now;
 const database=await db(),prototype=Object.getPrototypeOf(database),originalCollection=prototype.collection;
 await database.collection("workers").deleteOne({_id:"coinbase-feed"} as never);
 let worker:ReturnType<typeof startPriceWorker>|undefined,release:()=>void=()=>{};
 try{
  worker=startPriceWorker();await worker.ready;assert.equal(sockets.length,1);
  const blocked=new Promise<void>(resolve=>{release=resolve;});
  prototype.collection=function(this:typeof database,...args:Parameters<typeof database.collection>){
   const collection=originalCollection.apply(this,args);
   if(args[0]==="workers"){const update=collection.updateOne.bind(collection);collection.updateOne=async(...params:Parameters<typeof collection.updateOne>)=>{await blocked;return update(...params);};}
   return collection;
  } as typeof database.collection;
  now+=11000;const renewing=worker.runOnce();
  await new Promise<void>(resolve=>setImmediate(resolve));
  now+=4000;
  await new Promise<void>(resolve=>setTimeout(resolve,150));
  assert.equal(sockets[0].readyState,3);assert.equal(sockets.length,1);
  release();await renewing;
 }finally{prototype.collection=originalCollection;Date.now=originalNow;release();worker?.stop();globalThis.WebSocket=originalWS;}
});
