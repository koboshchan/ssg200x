import {test,after} from "node:test";
import assert from "node:assert/strict";
import {db,readRoom,closeDatabase} from "../../lib/db";
import {mutate} from "../../lib/store";
import {register} from "../../lib/poker";
import {openPosition,closePosition,requireQuote} from "../../lib/finance";
import {startPriceWorker,persistExchangeTicks} from "../../lib/prices";
import {candleRead} from "../../lib/candles";
if(!process.env.MONGODB_DB?.startsWith("fakebucks_test_"))throw Error("Requires isolated test DB");
process.env.MONGODB_DB+="_fallback_freshness";
after(async()=>{await(await db()).dropDatabase();await closeDatabase();});
const who={id:"freshness",name:"Freshness",email:"freshness@test",admin:false};
test("unchanged or changed cached REST rates never publish, stamp, settle or race ahead of real WS provider time",async()=>{
 const originalNow=Date.now,originalFetch=globalThis.fetch,originalWS=globalThis.WebSocket;
 let now=originalNow(),fetches=0,rate="0.01";
 const sockets:MockSocket[]=[];
 class MockSocket{readyState=1;onopen=null;onmessage=null;onerror=null;onclose=null;constructor(){sockets.push(this);}send(){}close(){this.readyState=3;}}
 globalThis.WebSocket=MockSocket as unknown as typeof WebSocket;Date.now=()=>now;
 globalThis.fetch=async()=>{
  fetches++;return new Response(JSON.stringify({data:{currency:"USD",rates:{BTC:rate}}}),{headers:{Date:new Date(now).toUTCString(),Age:"0"}});
 };
 let worker:ReturnType<typeof startPriceWorker>|undefined;
 try{
  await mutate(r=>{register(r,who);r.quotes={BTC:{micro:100e6,at:now}};openPosition(r,who,"BTC","long",10000,5,"p",now,{stopLoss:90e6});});
  const providerAt=now,previous=(await readRoom()).quotes!.BTC!;
  worker=startPriceWorker();clearInterval(worker.timer);await worker.ready;
  now+=10001;await worker.runOnce(); // stale, unchanged cached body would claim fresh HTTP receipt
  rate="0.02";await worker.runOnce(); // changed cached body would previously liquidate at $50
  let room=await readRoom();
  assert.equal(fetches,0);assert.deepEqual(room.quotes!.BTC,previous);assert.equal(room.members[0].positions!.length,1);
  assert.throws(()=>requireQuote(room,"BTC",now),/paused/);
  await assert.rejects(mutate(r=>closePosition(r,who,"p",now)),/paused/);
  await assert.rejects(mutate(r=>openPosition(r,who,"BTC","long",1000,5,"extra",now)),/paused/);
  // A verified event slightly before receipt time must not be suppressed by a
  // hypothetical later REST receipt timestamp. There is no REST publication now.
  const eventAt=now-1;
  worker.feed.receive(JSON.stringify({type:"ticker",product_id:"BTC-USD",price:"110",sequence:1,time:new Date(eventAt).toISOString()}));
  for(let i=0;i<100;i++){room=await readRoom();if(room.quotes!.BTC!.at===eventAt)break;await new Promise(r=>setTimeout(r,5));}
  assert.equal(room.quotes!.BTC!.at,eventAt);assert.equal(room.quotes!.BTC!.micro,110e6);
  assert.equal(requireQuote(room,"BTC",now),110e6);
  rate="0.005";await worker.runOnce();assert.equal(fetches,0);assert.deepEqual((await readRoom()).quotes!.BTC,room.quotes!.BTC);
  // An expired but larger sequence cannot refresh provider age or trigger SL.
  worker.feed.receive(JSON.stringify({type:"ticker",product_id:"BTC-USD",price:"50",sequence:2,time:new Date(providerAt).toISOString()}));
  await new Promise(r=>setImmediate(r));assert.equal((await readRoom()).quotes!.BTC!.micro,110e6);
  assert.equal((await readRoom()).members[0].positions!.length,1);
 }finally{
  worker?.stop();Date.now=originalNow;globalThis.fetch=originalFetch;globalThis.WebSocket=originalWS;
 }
});
test("delayed queued stale prints cannot reach room quotes, trigger settlement or candle cache",async()=>{
 const now=Date.now(),at=now-10001,room=await readRoom(),before=structuredClone(room.quotes);
 await persistExchangeTicks([{symbol:"BTC",micro:50e6,at,sequence:99}]);
 assert.deepEqual((await readRoom()).quotes,before);
 const start=Math.floor(at/60000)*60000;
 const candles=await candleRead("BTC","1m",start,start+60000);
 assert.ok(candles.every(c=>c.low!==50),"expired cached tick cannot contaminate candle source");
});
