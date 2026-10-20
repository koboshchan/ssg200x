import {STOCK_SYMBOLS} from "./stock-config";
import {stockExecutionPolicy} from "./stock-policy";
import type {Room} from "./types";
/** Safe, bounded UI status only. Never serialize provider env or raw events. */
export function publicStockState(room:Room,now=Date.now()){
 return Object.fromEntries(STOCK_SYMBOLS.map(symbol=>{
  const state=room.stockExecution?.[symbol];
  const quote=room.quotes?.[symbol];
  const matching=!!state?.tick&&quote?.micro===Math.round(state.tick.price*1e6)&&quote.at===state.tick.timestamp;
  const decision=matching&&state&&Number.isFinite(state.leaseUntil)&&now<state.leaseUntil!
   ?stockExecutionPolicy(state,now):{executable:false,reason:"lease_unverified"};
  return [symbol,{executable:decision.executable,reason:decision.reason,
   checkedAt:now,validUntil:state?Math.min(state.leaseUntil??0,(state.tick?.timestamp??0)+10000,(state.clock?.receivedAt??0)+60000,...state.sessions.filter(s=>now>=s.open&&now<s.close).map(s=>s.close)):0}];
 }));
}
