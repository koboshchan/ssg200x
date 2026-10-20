import {isStockSymbol,type StockSymbol} from "./stock-config";
import type {StockExecutionState} from "./stock-policy";
import {isActiveSymbol} from "./market-shared";
import type {Room} from "./types";
import type {Quote} from "./finance";
import {settleTriggers} from "./position-triggers";
/** Run inside room CAS mutation so quote publication and settlements commit together. */
export function applyMarketTick(room:Room,quotes:Partial<Record<string,Quote>>,now=Date.now(),stockStates?:Partial<Record<StockSymbol,StockExecutionState>>){
 if(stockStates)room.stockExecution=stockStates;
 room.quotes??={};
 for(const [symbol,q] of Object.entries(quotes)){
  if(!isActiveSymbol(symbol)||!q||!Number.isSafeInteger(q.micro)||q.micro<=0||!Number.isSafeInteger(q.at)||q.at>now||(isStockSymbol(symbol)?now-q.at>=60000:now-q.at>10000))continue;
  if(isStockSymbol(symbol)){const state=room.stockExecution?.[symbol];if(!stockStates||!state?.tick||state.symbol!==symbol||state.tick.symbol!==symbol||state.tick.timestamp!==q.at||Math.round(state.tick.price*1e6)!==q.micro)continue;}
  const key=symbol as keyof typeof room.quotes,previous=room.quotes[key];
  if(!previous||q.at>previous.at)room.quotes[key]=q;
 }
 settleTriggers(room,now);
}
