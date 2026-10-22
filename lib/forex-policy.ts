import {quoteFresh} from "./price-policy";
export const FOREX_DEFAULTS=["EUR/USD","USD/JPY","GBP/USD","USD/CNH","USD/CAD","AUD/USD","USD/CHF","AUD/JPY"];
export const FOREX_PATTERN=/^[A-Z]{3}\/[A-Z]{3}$/;
// Explicit supported practice instruments; no silent CNY/CNH substitution or inverse duplicates.
export function validForexPair(symbol:string){return FOREX_DEFAULTS.includes(symbol);}
const ny=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",weekday:"short",hour:"2-digit",hourCycle:"h23"});
export function forexMarketOpen(now:number){if(!Number.isFinite(now))return false;const p=Object.fromEntries(ny.formatToParts(now).map(p=>[p.type,p.value]));const h=Number(p.hour);return p.weekday!=="Sat"&&!(p.weekday==="Fri"&&h>=17)&&!(p.weekday==="Sun"&&h<17);}
export type ForexQuote={micro:number;at:number;source:"mock"|"oanda";quoteCurrency:string;received?:number;receiptMono?:number;nativeMicro?:number;usdMicro?:number;quoteUsd?:number;legs?:{at:number;received:number;receiptMono:number}[]};
export type ForexStatus={mode:"mock"|"live"|"unconfigured";stream?:"streaming"|"connecting"|"reconnecting"|"down";marketOpen:boolean;message:string;leaseUntil?:number;clockDomain?:string;errors?:Record<string,string>;cadenceSeconds?:number;dailyUsed?:number;dailyLimit?:number;nextPollAt?:number};
export function forexDecision(symbol:string,q:ForexQuote|undefined,status:ForexStatus|undefined,now:number,mono?:number,clockDomain?:string){
 const deny=(reason:string)=>({executable:false,reason,validUntil:0});
 if(!validForexPair(symbol))return deny("unsupported_forex");
 if(!forexMarketOpen(now))return deny("market_closed");
 if(!status||status.mode!=="live"||status.stream!=="streaming"||q?.source!=="oanda"||!(status.leaseUntil!>now))return deny("stream_unavailable");
 if(clockDomain!==undefined&&status.clockDomain!==clockDomain)return deny("clock_domain_mismatch");
 const legs=q?.legs;
 if(!q||!Number.isSafeInteger(q.micro)||q.micro<=0||!Number.isFinite(q.quoteUsd)||q.quoteUsd!<=0||!Number.isSafeInteger(q.usdMicro)||q.usdMicro!<=0||!legs?.length||!legs.every(l=>quoteFresh(l.at,now)&&quoteFresh(l.received,now)&&(mono===undefined||Number.isFinite(l.receiptMono)&&mono>=l.receiptMono&&mono-l.receiptMono<=10000)))return deny("stale_quote_or_conversion");
 return {executable:true,reason:"fresh_live_USD_conversion",validUntil:Math.min(status.leaseUntil!,...legs.map(l=>Math.min(l.at,l.received)+10000))};
}
