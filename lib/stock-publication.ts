import {applyMarketTick} from "./market-tick";
import type {StockExecutionState,StockTick} from "./stock-policy";
import type {StockSymbol} from "./stock-config";
import type {Room} from "./types";
/** Called inside each fenced Mongo transaction attempt, never before its reads.
 * Refresh ownership/connection/calendar metadata but replay accepted prints in
 * arrival order. Metadata coalesces; intermediate trigger crossings never do. */
export function applyStockPublication(room:Room,current:()=>Record<StockSymbol,StockExecutionState>,ticks:readonly StockTick[],now=Date.now()){
 const states=current();
 for(const [symbol,state] of Object.entries(states)){
  const quote=room.quotes?.[symbol],prior=room.stockExecution?.[symbol]?.tick;
  states[symbol]={...state,tick:state.tick&&room.stockExecution?.[symbol]?.feedEpoch===state.feedEpoch&&prior&&quote&&prior.timestamp===quote.at&&Math.round(prior.price*1e6)===quote.micro?prior:null};
 }
 for(const tick of ticks){
  const state=states[tick.symbol];
  if(!state)continue;
  states[tick.symbol]={...state,tick};
  applyMarketTick(room,{[tick.symbol]:{micro:Math.round(tick.price*1e6),at:tick.timestamp}},now,{...states});
 }
 applyMarketTick(room,{},now,states);
}
