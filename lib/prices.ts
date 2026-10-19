import {candleUpdate} from "./candles";
import {applyMarketTick} from "./market-tick";
import {mutate} from "./store";
import {readRoom,db} from "./db";
import {randomUUID} from "node:crypto";
import {pollingInterval,decodeRates} from "./price-policy";
import {ExchangeFeed,type Tick} from "./exchange-feed";
type Worker={ready:Promise<void>;owner:string;feed:ExchangeFeed;timer:ReturnType<typeof setInterval>;stop:()=>void};
const globalWorker=globalThis as typeof globalThis & {exchangePriceWorker?:Worker};
export async function persistExchangeTicks(ticks:Tick[]){
 await mutate(room=>{
  for(const tick of ticks){
   const previous=room.quotes?.[tick.symbol as keyof typeof room.quotes];
   if(previous&&previous.at>tick.at)continue;
   // Feed sequence validation proves these are newer trades, even within one millisecond.
   if(previous?.at===tick.at)delete room.quotes![tick.symbol as keyof typeof room.quotes];
   applyMarketTick(room,{[tick.symbol]:{micro:tick.micro,at:tick.at}});
  }
 });
 // Preserve every print's high/low and bucket boundary, not just the last mark.
 for(const tick of ticks)await candleUpdate({[tick.symbol]:{micro:tick.micro,at:tick.at}});
}
export function startPriceWorker(){
 if(globalWorker.exchangePriceWorker)return globalWorker.exchangePriceWorker;
 const owner=randomUUID();
 let running=false,leaseUntil=0,nextRest=0,stopped=false;
 let feed:ExchangeFeed;
 const makeFeed=()=>new ExchangeFeed({socket:()=>new WebSocket("wss://ws-feed.exchange.coinbase.com"),apply:async ticks=>{if(stopped||Date.now()>=leaseUntil)throw new Error("Price lease expired");await persistExchangeTicks(ticks);},log:message=>console.warn(message)});
 feed=makeFeed();
 async function step(){
  if(running||stopped)return;running=true;
  try{
   const now=Date.now(),locks=(await db()).collection<{_id:string;owner:string;until:number}>("workers");
   if(leaseUntil-now<5000){
    await locks.updateOne({_id:"coinbase-feed"},{$setOnInsert:{owner:"",until:0}},{upsert:true}).catch(e=>{if(e.code!==11000)throw e;});
    const claim=await locks.updateOne({_id:"coinbase-feed",$or:[{owner},{until:{$lte:now}}]},{$set:{owner,until:now+15000}});
    if(!claim.matchedCount){if(leaseUntil){feed.stop();feed=makeFeed();}leaseUntil=0;return;}
    leaseUntil=now+15000;
   }
   feed.step();feed.retryPending();
   const stale=feed.staleSymbols();
   if(!stale.length||now<nextRest)return;
   const room=await readRoom();nextRest=now+pollingInterval(room);
   const response=await fetch("https://api.coinbase.com/v2/exchange-rates?currency=USD",{cache:"no-store",signal:AbortSignal.timeout(3000)});
   if(!response.ok){
    if(response.status===429)nextRest=Date.now()+Math.max(1000,Math.min(60000,Number(response.headers.get("retry-after"))*1000||5000));
    return;
   }
   const quotes=decodeRates(await response.json(),Date.now());
   const fallback:typeof quotes={};
   const current=await readRoom();
   for(const symbol of feed.staleSymbols()){
    const q=quotes[symbol],previous=current.quotes?.[symbol as keyof typeof current.quotes];
    // Rates has no provider event time. An unchanged response cannot prove freshness.
    if(q&&q.micro!==previous?.micro)fallback[symbol]=q;
   }
   if(Object.keys(fallback).length){
    await mutate(r=>{const safe=Object.fromEntries(Object.entries(fallback).filter(([s,q])=>feed.staleSymbols().includes(s as never)&&(!r.quotes?.[s as keyof typeof r.quotes]||r.quotes[s as keyof typeof r.quotes]!.at<q.at)));applyMarketTick(r,safe);});
    await candleUpdate(fallback);
   }
  }catch{if(Date.now()>=leaseUntil){feed.stop();feed=makeFeed();leaseUntil=0;}}
  finally{running=false;}
 }
 const timer=setInterval(()=>{void step();},100);timer.unref();
 const worker:Worker={ready:Promise.resolve(),owner,get feed(){return feed;},timer,stop(){
  stopped=true;clearInterval(timer);feed.stop();delete globalWorker.exchangePriceWorker;
  void db().then(d=>d.collection<{_id:string;owner:string;until:number}>("workers").updateOne({_id:"coinbase-feed",owner},{$set:{until:0}})).catch(()=>{});
 }};
 globalWorker.exchangePriceWorker=worker;
 process.once("SIGTERM",worker.stop);process.once("SIGINT",worker.stop);
 worker.ready=step();return worker;
}
/** Compatibility entry point. Starting is idempotent across HMR module evaluations. */
export async function refreshPrices(){startPriceWorker();}
