import {assertIsolatedQa} from "../runtime/isolated-qa.mjs";
import {getFeatureSettings,type FeatureSettings} from "../runtime/feature-settings.mjs";
import {ForexIsolation,forexStreamOptions} from "./forex-isolation";
import {forexObserver} from "./forex-observation";
import {createForexStream} from "./forex-feed";
import {quoteFresh} from "./price-policy";
import {marketSymbols} from "./symbol-registry";
import {applyStockPublication} from "./stock-publication";
import {StockRuntime} from "./stock-runtime";
import type {StockSocket} from "./stock-feed";
import {candleUpdate} from "./candles";
import {applyMarketTick} from "./market-tick";
import {mutate,mutateStockPublication} from "./store";
import {readRoom,db} from "./db";
import {randomUUID} from "node:crypto";
import {ExchangeFeed,type Tick} from "./exchange-feed";
type Worker={runOnce:()=>Promise<void>;ready:Promise<void>;owner:string;feed:ExchangeFeed;timer:ReturnType<typeof setInterval>;stop:()=>void};
const globalWorker=globalThis as typeof globalThis & {exchangePriceWorker?:Worker};
export async function persistExchangeTicks(ticks:Tick[],health?:import("./crypto-policy").CryptoStatus,owner?:string){

 // Queued prints can age out during a persistence failure or CAS retry.
 ticks=ticks.filter(t=>quoteFresh(t.at,Date.now())&&(!health||t.cryptoGeneration===health.generation));
 if(!ticks.length)return;
 const publish=(room:import("./types").Room)=>{
  if(health)room.cryptoStatus=health;
  for(const tick of ticks){
   if(!marketSymbols(room).crypto.includes(tick.symbol)||!quoteFresh(tick.at,Date.now()))continue;
   const previous=room.quotes?.[tick.symbol as keyof typeof room.quotes];
   if(previous&&previous.at>tick.at)continue;
   // Feed sequence validation proves these are newer trades, even within one millisecond.
   if(previous?.at===tick.at)delete room.quotes![tick.symbol as keyof typeof room.quotes];
   applyMarketTick(room,{[tick.symbol]:{micro:tick.micro,at:tick.at,cryptoGeneration:tick.cryptoGeneration}});
  }
 };
 if(owner)await mutateStockPublication(owner,publish);else await mutate(publish);
 // Preserve every print's high/low and bucket boundary, not just the last mark.
 await candleUpdate(ticks.filter(t=>quoteFresh(t.at,Date.now())).map(tick=>({[tick.symbol]:{micro:tick.micro,at:tick.at}})));
}
export function startPriceWorker(){
 if(process.env.SSG_ISOLATED_QA!==undefined) { assertIsolatedQa(); throw new Error("External feed workers disabled in isolated QA."); }
 if(globalWorker.exchangePriceWorker)return globalWorker.exchangePriceWorker;
 const owner=randomUUID();
 let running=false,leaseUntil=0,stopped=false;
 let flags:FeatureSettings|undefined;
 let lastHealthPublication=0,lastHealthState="";
 const cryptoOn=()=>!!flags&&(flags.enabled("cryptoPerps")||flags.enabled("cryptoSpot"));
 const stocksOn=()=>flags?.enabled("stocks")===true;
 const forexOn=()=>flags?.enabled("forex")===true;
 let feed:ExchangeFeed;
 let symbols=marketSymbols();
 const makeFeed=()=>new ExchangeFeed({symbols:()=>symbols.crypto,socket:()=>{if(stopped||!cryptoOn()||Date.now()>=leaseUntil-1000)throw new Error("Price lease unavailable");return new WebSocket("wss://ws-feed.exchange.coinbase.com");},apply:async ticks=>{if(stopped||!cryptoOn()||Date.now()>=leaseUntil)throw new Error("Price lease expired");await persistExchangeTicks(ticks,feed.health(leaseUntil),owner);},log:message=>console.warn(message)});
 feed=makeFeed();
 const forex=createForexStream({leaseId:()=>fx.leaseId(),observe:forexObserver(),owner,symbols:()=>symbols.forex,leader:()=>!stopped&&forexOn()&&fx.leader(),leaseUntil:()=>fx.leaseUntil()});
 const fx=new ForexIsolation({options:()=>({...forexStreamOptions(),enabled:forexOn()&&forexStreamOptions().enabled}),now:Date.now,step:()=>forex.step(),revoke:()=>forex.revoke(),claim:async id=>{
  const now=Date.now(),locks=(await db()).collection<{_id:string;owner:string;until:number}>("workers");
  await locks.updateOne({_id:id},{$setOnInsert:{owner:"",until:0}},{upsert:true}).catch(e=>{if(e.code!==11000)throw e;});
  return !!(await locks.updateOne({_id:id,$or:[{owner},{until:{$lte:now}}]},{$set:{owner,until:now+15000}})).matchedCount;
 },release:async id=>{
  await mutateStockPublication(owner,room=>{room.forexQuotes={};if(room.forexStatus)room.forexStatus={...room.forexStatus,stream:"down",leaseUntil:0,message:"FX stream disabled or lease revoked."};},undefined,id).catch(()=>{});
  await (await db()).collection<{_id:string;owner:string;until:number}>("workers").updateOne({_id:id,owner},{$set:{until:0}});}});
 const stocks=new StockRuntime({
  log:message=>console.warn(message),
  symbols:()=>symbols.stocks,env:process.env,leaseUntil:()=>leaseUntil-1000,isLeader:()=>!stopped&&stocksOn()&&Date.now()<leaseUntil-1000,
  socket:url=>{if(!stocksOn())throw new Error("Stocks temporarily disabled");return new WebSocket(url) as unknown as StockSocket;},
  fetch:async(...args)=>{if(!stocksOn())throw new Error("Stocks temporarily disabled");return fetch(...args);},now:Date.now,
  publish:async(current,ticks)=>{
   if(stopped||!stocksOn()||Date.now()>=leaseUntil-1000)throw new Error("Stock lease unavailable");
   if(ticks.length)await candleUpdate({});
   await mutateStockPublication(owner,room=>{
    if(stopped||!stocksOn()||Date.now()>=leaseUntil-1000)throw new Error("Stock lease revoked");
    applyStockPublication(room,current,ticks);
   },ticks.length?session=>candleUpdate(ticks.map(tick=>({[tick.symbol]:{micro:Math.round(tick.price*1e6),at:tick.timestamp}})),session):undefined);
  },
 });
 async function step(){
  if(running||stopped)return;running=true;
  try{
   if(!flags){
    flags=getFeatureSettings((await db()).collection("featureFlags"));await flags.ready;
    flags.subscribe(()=>{if(!stocksOn())stocks.revoke();if(!cryptoOn()){feed.stop();feed=makeFeed();}if(!forexOn())void fx.stop();});
   }
   await flags.ready;
   if(!forexOn())await fx.stop();
   if(!stocksOn())stocks.revoke();
   if(!cryptoOn()){feed.stop();feed=makeFeed();}
   const now=Date.now(),locks=(await db()).collection<{_id:string;owner:string;until:number}>("workers");
   if(leaseUntil-now<5000){
    try{
    await locks.updateOne({_id:"coinbase-feed"},{$setOnInsert:{owner:"",until:0}},{upsert:true}).catch(e=>{if(e.code!==11000)throw e;});
    const claim=await locks.updateOne({_id:"coinbase-feed",$or:[{owner},{until:{$lte:now}}]},{$set:{owner,until:now+15000}});
    // An acknowledged claim can already be expired after a delayed database response.
    if(stopped||!claim.matchedCount||Date.now()>=now+15000-1000){await fx.stop();stocks.revoke();feed.stop();feed=makeFeed();leaseUntil=0;return;}
    leaseUntil=now+15000;
    }catch{
     // Renewal uncertainty immediately revokes the existing connection, not just after expiry.
     await fx.stop();stocks.revoke();feed.stop();feed=makeFeed();leaseUntil=0;return;
    }
   }
   symbols=marketSymbols(await readRoom());
   await fx.step();
   if(stocksOn())void stocks.step();
   if(cryptoOn()){feed.step();feed.retryPending();
    const health=feed.health(leaseUntil),healthState=JSON.stringify([health.connected,health.heartbeatSubscribed,health.generation]);
    if(Date.now()-lastHealthPublication>=1000||healthState!==lastHealthState){
     await mutateStockPublication(owner,room=>{room.cryptoStatus=health;});
     lastHealthPublication=Date.now();lastHealthState=healthState;
    }}
   // No executable REST fallback. The v2 rates body has no provider event time:
   // changing values, HTTP Date/Age and receipt time cannot establish freshness.
   // Keep reconnecting the verified WS source; unhealthy transport pauses execution.

  }catch{await fx.stop();stocks.revoke();feed.stop();feed=makeFeed();leaseUntil=0;}
  finally{running=false;}
 }
 const timer=setInterval(()=>{if(leaseUntil&&Date.now()>=leaseUntil-1000){void fx.stop();stocks.revoke();feed.stop();feed=makeFeed();leaseUntil=0;}void step();},100);timer.unref();
 const worker:Worker={runOnce:step,ready:Promise.resolve(),owner,get feed(){return feed;},timer,stop(){
  stopped=true;clearInterval(timer);void fx.stop();forex.stop();stocks.stop();feed.stop();delete globalWorker.exchangePriceWorker;
  void db().then(d=>d.collection<{_id:string;owner:string;until:number}>("workers").updateOne({_id:"coinbase-feed",owner},{$set:{until:0}})).catch(()=>{});
 }};
 globalWorker.exchangePriceWorker=worker;
 process.once("SIGTERM",worker.stop);process.once("SIGINT",worker.stop);
 worker.ready=step();return worker;
}
/** Compatibility entry point. Starting is idempotent across HMR module evaluations. */
export async function refreshPrices(){startPriceWorker();}
