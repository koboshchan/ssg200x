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
  assert.equal(sockets,1);assert.equal(calls,1);assert.equal((await readRoom()).quotes!.BTC!.at,old);
  const lease=await(await db()).collection("workers").findOne({_id:"coinbase-feed"} as never);assert.equal(lease!.owner,worker.owner);assert.ok(lease!.until>Date.now());
 }finally{worker?.stop();globalThis.fetch=originalFetch;globalThis.WebSocket=originalWS;}
});
