import {marketClosedState,type MarketHours} from "./market-hours";
type Status={executable:boolean;validUntil:number;reason:string;marketHours?:MarketHours};
/** Shared row/ticket reason. Server remains the authority at confirmation. */
export function stockPauseReason(state:Status|undefined,now:number){
 if(!state)return "Stock feed status unavailable";
 // A closed provider session outranks an expired trade or worker lease.
 if(state.marketHours){
  const hours=marketClosedState("stocks",state.marketHours,now);
  if(hours.closed===true)return hours.label;
  if(hours.closed===null)return hours.label;
 }
 if(state.reason==="market_closed")return "Market closed";
 if(state.reason==="calendar_unavailable")return "Market calendar unavailable";
 if(state.reason==="closed_or_calendar_unverified")return "Stock market closed or calendar unverified";
 if(now>=state.validUntil)return "Stock execution status expired";
 if(state.executable)return "";
 const reasons:Record<string,string>={
  unsupported_stock:"Stock is not supported",invalid_time:"Stock clock unavailable",
  unauthorized_feed:"Stock feed authorization unavailable",lease_expired:"Stock worker lease expired",
  lease_unverified:"Stock worker lease unverified",disconnected:"Stock feed disconnected",
  closed_or_calendar_unverified:"Stock market closed or calendar unverified",
  stale_or_invalid_tick:"Stock trade stale or unavailable",
 };
 return reasons[state.reason]??"Stock execution unavailable";
}
