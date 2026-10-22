/** Plain-language forex trading status for the UI. */
export type FxExec={executable:boolean;reason?:string;validUntil:number};
const REASONS:Record<string,string>={market_closed:"The forex market is closed.",stream_unavailable:"The live rate stream is not connected.",clock_domain_mismatch:"Waiting for the rate feed to resync.",stale_quote_or_conversion:"The live rate or USD conversion is out of date.",unsupported_forex:"This pair is not supported.",fresh_live_USD_quote_required:"Waiting for a fresh live rate."};
export function fxReasonText(e:FxExec|undefined,quoteAt:number|undefined,now:number){
 if(!e)return "Forex trading is unavailable right now.";
 if(e.executable){
  if(now>=e.validUntil||quoteAt===undefined||now-quoteAt>10_000)return "Quote expired (older than 10 seconds). Waiting for a fresh live rate.";
  return "";
 }
 return REASONS[e.reason??""]??"Trading unavailable right now.";
}
