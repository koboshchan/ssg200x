import {StockRuntime} from "./stock-runtime";
import type {StockSocket} from "./stock-feed";
import {SYMBOLS} from "./market-shared";
import {candleUpdate} from "./candles";
import {applyMarketTick} from "./market-tick";
import {mutate,mutateStockPublication} from "./store";
import {readRoom,db} from "./db";
import {randomUUID} from "node:crypto";
import {pollingInterval,decodeRates} from "./price-policy";
import {ExchangeFeed,type Tick} from "./exchange-feed";
type Worker={runOnce:()=>Promise<void>;ready:Promise<void>;owner:string;feed:ExchangeFeed;timer:ReturnType<typeof setInterval>;stop:()=>void};
const globalWorker=globalThis as typeof globalThis & {exchangePriceWorker?:Worker};
export async function persistExchangeTicks(ticks:Tick[]){
 ticks=ticks.filter(tick=>(SYMBOLS as readonly string[]).includes(tick.symbol));
 if(!ticks.length)return;
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
 await candleUpdate(ticks.map(tick=>({[tick.symbol]:{micro:tick.micro,at:tick.at}})));
}
export function startPriceWorker(){
 if(globalWorker.exchangePriceWorker)return globalWorker.exchangePriceWorker;
 const owner=randomUUID();
 let running=false,leaseUntil=0,nextRest=0,stopped=false;
 let feed:ExchangeFeed;
 const makeFeed=()=>new ExchangeFeed({socket:()=>{if(stopped||Date.now()>=leaseUntil-1000)throw new Error("Price lease unavailable");return new WebSocket("wss://ws-feed.exchange.coinbase.com");},apply:async ticks=>{if(stopped||Date.now()>=leaseUntil)throw new Error("Price lease expired");await persistExchangeTicks(ticks);},log:message=>console.warn(message)});
 feed=makeFeed();
 const stocks=new StockRuntime({
  env:process.env,leaseUntil:()=>leaseUntil-1000,isLeader:()=>!stopped&&Date.now()<leaseUntil-1000,
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
   void stocks.step();
   feed.step();feed.retryPending();
   const stale=feed.staleSymbols();
   if(!stale.length||now<nextRest)return;
   const room=await readRoom(),interval=pollingInterval(room);nextRest=now+interval;
   const budget=(await db()).collection<{_id:string;nextAt:number}>("workers");
   await budget.updateOne({_id:"coinbase-history-budget"},{$setOnInsert:{nextAt:0}},{upsert:true}).catch(e=>{if(e.code!==11000)throw e;});
   if(!(await budget.updateOne({_id:"coinbase-history-budget",nextAt:{$lte:now}},{$set:{nextAt:now+Math.max(334,interval)}})).matchedCount)return;
   const response=await fetch("https://api.coinbase.com/v2/exchange-rates?currency=USD",{cache:"no-store",signal:AbortSignal.timeout(3000)});
   if(!response.ok){
    if(response.status===429){nextRest=Date.now()+Math.max(1000,Math.min(60000,Number(response.headers.get("retry-after"))*1000||5000));await budget.updateOne({_id:"coinbase-history-budget"},{$max:{nextAt:nextRest}});}
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
