type Status={executable:boolean;validUntil:number;reason:string};
/** Shared row/ticket reason. Server remains the authority at confirmation. */
export function stockPauseReason(state:Status|undefined,now:number){
 if(!state)return "Stock feed status unavailable";
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
