/** Plain-language forex trading status for the UI. */
export type FxExec={executable:boolean;reason?:string;validUntil:number};
const REASONS:Record<string,string>={market_closed:"The forex market is closed.",stream_unavailable:"The live rate stream is not connected.",clock_domain_mismatch:"Waiting for the rate feed to resync.",stale_quote_or_conversion:"The live rate or USD conversion is out of date.",unsupported_forex:"This pair is not supported.",fresh_live_USD_quote_required:"Waiting for a fresh live rate.",stream_unhealthy:"The live rate stream heartbeat is overdue.",missing_current_generation_quote_or_conversion:"Waiting for a current-stream rate and USD conversion."};
export function fxReasonText(e:FxExec|undefined,quoteAt:number|undefined,now:number){
 if(!e)return "Forex trading is unavailable right now.";
 if(e.executable){
  if(now>=e.validUntil)return "The live stream health confirmation expired. Waiting for a healthy heartbeat.";
  if(quoteAt===undefined)return "Waiting for a current-stream rate.";
  return "";
 }
 return REASONS[e.reason??""]??"Trading unavailable right now.";
}

/** The server deadline covers shared stream health and every conversion leg. */
export function fxExecutable(e:FxExec|undefined,quote:{source:string;at:number}|undefined,now:number){
 return !!e?.executable&&now<e.validUntil&&quote?.source==="oanda"&&Number.isSafeInteger(quote.at)&&quote.at>=0&&quote.at<=now;
}
