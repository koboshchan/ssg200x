import {forexDecision} from "./forex-policy";
import {forexLiveConfigured,forexMonotonic,forexClockDomain} from "./forex-config";
import {quoteFresh} from "./price-policy";
import {activeSymbol,stockSymbol,forexSymbol} from "./symbol-registry";
import {type StockSymbol} from "./stock-config";
import type {StockExecutionState} from "./stock-policy";
import type {Room} from "./types";
import type {Quote} from "./finance";
import {settleTriggers} from "./position-triggers";
/** Run inside room CAS mutation so quote publication and settlements commit together. */
export function applyMarketTick(room:Room,quotes:Partial<Record<string,Quote>>,now=Date.now(),stockStates?:Partial<Record<StockSymbol,StockExecutionState>>){
 if(stockStates)room.stockExecution=stockStates;
 room.quotes??={};
 for(const [symbol,q] of Object.entries(quotes)){
  if(!activeSymbol(symbol,room)||!q||!Number.isSafeInteger(q.micro)||q.micro<=0||(!forexSymbol(symbol,room)&&!quoteFresh(q.at,now,stockSymbol(symbol,room))))continue;
  if(stockSymbol(symbol,room)){const state=room.stockExecution?.[symbol];if(!stockStates||!state?.tick||state.symbol!==symbol||state.tick.symbol!==symbol||state.tick.timestamp!==q.at||Math.round(state.tick.price*1e6)!==q.micro)continue;}
  if(forexSymbol(symbol,room)){const f=room.forexQuotes?.[symbol];if(!forexLiveConfigured()||!forexDecision(symbol,f,room.forexStatus,now,forexMonotonic(),forexClockDomain).executable||!f||f.at!==q.at||f.micro!==q.micro)continue;}
  const key=symbol as keyof typeof room.quotes,previous=room.quotes[key];
  if(!previous||q.at>previous.at||(forexSymbol(symbol,room)&&q.at===previous.at)){
   room.quotes[key]=q;
   room.marketDay??={};
   const day=new Date(q.at).toISOString().slice(0,10);
   if(room.marketDay[symbol]?.day!==day)room.marketDay[symbol]={day,open:q.micro};
  }
 }
 settleTriggers(room,now);
}
