import {mutateStockPublication} from "./store";
import {marketSymbols} from "./symbol-registry";
import {applyMarketTick} from "./market-tick";
import {candleUpdate} from "./candles";
import {forexMarketOpen,forexDecision,type ForexQuote,type ForexStatus} from "./forex-policy";
import {forexMonotonic,forexClockDomain} from "./forex-config";
import {OandaStream,type OandaTick} from "./oanda-stream";
/** Native midpoint is displayed. Accounting is USD per base unit. For USD-base
 * instruments it is exactly $1; AUD/JPY is native AUDJPY / USDJPY. All native
 * legs must be independently fresh. Never add a conversion subscription. */
export function convertedForexQuotes(ticks:OandaTick[],pairs:string[]):Record<string,ForexQuote>{
 const map=new Map(ticks.map(t=>[t.symbol,t])),out:Record<string,ForexQuote>={};
 for(const symbol of pairs){const t=map.get(symbol);if(!t)continue;
  let usd=t.price;const legs=[t];
  if(symbol.startsWith("USD/"))usd=1;
  else if(!symbol.endsWith("/USD")){const conversion=map.get("USD/"+symbol.slice(4));if(!conversion||!pairs.includes(conversion.symbol))continue;usd=t.price/conversion.price;legs.push(conversion);}
  const micro=Math.round(t.price*1e6),usdMicro=Math.round(usd*1e6);if(!Number.isSafeInteger(micro)||micro<=0||!Number.isSafeInteger(usdMicro)||usdMicro<=0)continue;
  out[symbol]={micro,nativeMicro:micro,usdMicro,quoteUsd:usd/t.price,at:Math.min(...legs.map(l=>l.at)),received:t.received,receiptMono:t.mono,source:"oanda",quoteCurrency:symbol.slice(4),legs:legs.map(l=>({at:l.at,received:l.received,receiptMono:l.mono,generation:l.generation}))};
 }return out;
}
export function createForexStream(o:{owner:string;leaseId?:()=>string;symbols:()=>string[];leader:()=>boolean;leaseUntil:()=>number;request?:typeof fetch;observe?:(tick:OandaTick)=>void}){
 return new OandaStream({symbols:o.symbols,token:process.env.OANDA_API_TOKEN??"",account:process.env.OANDA_ACCOUNT_ID??"",leader:o.leader,now:Date.now,mono:forexMonotonic,request:o.request??fetch,observe:o.observe,
 publish:async(ticks,state,valid=()=>true,health)=>{
  if(!valid()||!o.leader())return; // Lost owners cannot clear a new owner's stream state.
  const status:ForexStatus={mode:state==="unconfigured"?"unconfigured":"live",stream:state==="live"?"streaming":state==="connecting"?"connecting":"down",marketOpen:forexMarketOpen(Date.now()),leaseUntil:o.leaseUntil(),clockDomain:forexClockDomain,...health,message:"OANDA practice stream. Native midpoint display; USD accounting conversion. Last valid current-generation prices are tradable while shared stream heartbeat/data health is within 15 seconds."};
  await candleUpdate({});let snapshots:Record<string,{micro:number;at:number}>={};
  await mutateStockPublication(o.owner,room=>{
   if(!valid()||!o.leader())throw new Error("Forex lease revoked");
   const now=Date.now(),mono=forexMonotonic(),pairs=marketSymbols(room).forex;
   room.forexStatus=status;room.forexQuotes=state==="live"?convertedForexQuotes(ticks,pairs):{};
   snapshots={};
   for(const [symbol,q] of Object.entries(room.forexQuotes))if(forexDecision(symbol,q,status,now,mono,forexClockDomain).executable)snapshots[symbol]={micro:q.micro,at:q.at};
   for(const member of room.members)for(const p of member.positions??[]){const q=room.forexQuotes[p.symbol];if(p.fx&&q&&forexDecision(p.symbol,q,status,now,mono,forexClockDomain).executable)p.fx={...p.fx,quoteUsd:q.quoteUsd!};}
   applyMarketTick(room,snapshots,now);
  },session=>candleUpdate(snapshots,session),o.leaseId?.());
 }});
}
