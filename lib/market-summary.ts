import {activeSymbols} from "./symbol-registry";
import type {Room} from "./types";
export type MarketSummary=Record<string,{micro:number|null;change:number|null}>;
/** Informational picker rows from the shared server quote book. No provider
 * requests, candle reads or trading/execution permissions belong in this view.
 * The baseline remains the first validated quote of the current UTC day.
 */
export function marketSummary(room:Room,now=Date.now()):MarketSummary{
 const today=new Date(now).toISOString().slice(0,10);
 return Object.fromEntries(activeSymbols(room).map(symbol=>{
  const quote=room.quotes?.[symbol],base=room.marketDay?.[symbol];
  const valid=!!quote&&Number.isSafeInteger(quote.micro)&&quote.micro>0&&Number.isSafeInteger(quote.at)&&quote.at>=0&&quote.at<=now;
  const micro=valid?quote.micro:null;
  const sameDay=valid&&new Date(quote.at).toISOString().slice(0,10)===today;
  const change=micro!==null&&sameDay&&base?.day===today&&Number.isSafeInteger(base.open)&&base.open>0?(micro/base.open-1)*100:null;
  return [symbol,{micro,change}];
 }));
}
