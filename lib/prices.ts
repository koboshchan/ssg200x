import {quoteFresh} from "./price-policy";
import {marketSymbols} from "./symbol-registry";
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
export async function persistExchangeTicks(ticks:Tick[]){

 // Queued prints can age out during a persistence failure or CAS retry.
 ticks=ticks.filter(t=>quoteFresh(t.at,Date.now()));
 if(!ticks.length)return;
 await mutate(room=>{
  for(const tick of ticks){
   if(!marketSymbols(room).crypto.includes(tick.symbol)||!quoteFresh(tick.at,Date.now()))continue;
   const previous=room.quotes?.[tick.symbol as keyof typeof room.quotes];
   if(previous&&previous.at>tick.at)continue;
   // Feed sequence validation proves these are newer trades, even within one millisecond.
   if(previous?.at===tick.at)delete room.quotes![tick.symbol as keyof typeof room.quotes];
   applyMarketTick(room,{[tick.symbol]:{micro:tick.micro,at:tick.at}});
  }
 });
 // Preserve every print's high/low and bucket boundary, not just the last mark.
 await candleUpdate(ticks.filter(t=>quoteFresh(t.at,Date.now())).map(tick=>({[tick.symbol]:{micro:tick.micro,at:tick.at}})));
}
export function startPriceWorker(){
 if(globalWorker.exchangePriceWorker)return globalWorker.exchangePriceWorker;
 const owner=randomUUID();
 let running=false,leaseUntil=0,stopped=false;
 let feed:ExchangeFeed;
 let symbols=marketSymbols();
 const makeFeed=()=>new ExchangeFeed({symbols:()=>symbols.crypto,socket:()=>{if(stopped||Date.now()>=leaseUntil-1000)throw new Error("Price lease unavailable");return new WebSocket("wss://ws-feed.exchange.coinbase.com");},apply:async ticks=>{if(stopped||Date.now()>=leaseUntil)throw new Error("Price lease expired");await persistExchangeTicks(ticks);},log:message=>console.warn(message)});
 feed=makeFeed();
 const stocks=new StockRuntime({
  symbols:()=>symbols.stocks,env:process.env,leaseUntil:()=>leaseUntil-1000,isLeader:()=>!stopped&&Date.now()<leaseUntil-1000,
  socket:url=>new WebSocket(url) as unknown as StockSocket,fetch,now:Date.now,
  publish:async(states,tick)=>{
   if(stopped||Date.now()>=leaseUntil-1000)throw new Error("Stock lease unavailable");
   if(tick)await candleUpdate({});
   await mutateStockPublication(owner,room=>{
    if(stopped||Date.now()>=leaseUntil-1000)throw new Error("Stock lease revoked");
    const quotes=tick?{[tick.symbol]:{micro:Math.round(tick.price*1e6),at:tick.timestamp}}:{};
    applyMarketTick(room,quotes,Date.now(),states);
   },tick?session=>candleUpdate({[tick.symbol]:{micro:Math.round(tick.price*1e6),at:tick.timestamp}},session):undefined);
  },
 });
 async function step(){
  if(running||stopped)return;running=true;
  try{
   const now=Date.now(),locks=(await db()).collection<{_id:string;owner:string;until:number}>("workers");
   if(leaseUntil-now<5000){
    try{
    await locks.updateOne({_id:"coinbase-feed"},{$setOnInsert:{owner:"",until:0}},{upsert:true}).catch(e=>{if(e.code!==11000)throw e;});
    const claim=await locks.updateOne({_id:"coinbase-feed",$or:[{owner},{until:{$lte:now}}]},{$set:{owner,until:now+15000}});
    // An acknowledged claim can already be expired after a delayed database response.
    if(stopped||!claim.matchedCount||Date.now()>=now+15000-1000){stocks.revoke();feed.stop();feed=makeFeed();leaseUntil=0;return;}
    leaseUntil=now+15000;
    }catch{
     // Renewal uncertainty immediately revokes the existing connection, not just after expiry.
     stocks.revoke();feed.stop();feed=makeFeed();leaseUntil=0;return;
    }
   }
   symbols=marketSymbols(await readRoom());
   void stocks.step();
   feed.step();feed.retryPending();
   // No executable REST fallback. The v2 rates body has no provider event time:
   // changing values, HTTP Date/Age and receipt time cannot establish freshness.
   // Keep reconnecting the verified WS source; expired marks pause all execution.

  }catch{stocks.revoke();feed.stop();feed=makeFeed();leaseUntil=0;}
  finally{running=false;}
 }
 const timer=setInterval(()=>{if(leaseUntil&&Date.now()>=leaseUntil-1000){stocks.revoke();feed.stop();feed=makeFeed();leaseUntil=0;}void step();},100);timer.unref();
 const worker:Worker={runOnce:step,ready:Promise.resolve(),owner,get feed(){return feed;},timer,stop(){
  stopped=true;clearInterval(timer);stocks.stop();feed.stop();delete globalWorker.exchangePriceWorker;
  void db().then(d=>d.collection<{_id:string;owner:string;until:number}>("workers").updateOne({_id:"coinbase-feed",owner},{$set:{until:0}})).catch(()=>{});
 }};
 globalWorker.exchangePriceWorker=worker;
 process.once("SIGTERM",worker.stop);process.once("SIGINT",worker.stop);
 worker.ready=step();return worker;
}
/** Compatibility entry point. Starting is idempotent across HMR module evaluations. */
export async function refreshPrices(){startPriceWorker();}
