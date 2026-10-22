import {quoteFresh} from "./price-policy";
export const FOREX_DEFAULTS=["AUD/JPY","CAD/USD","CNY/USD","EUR/USD","USD/JPY","GBP/USD"];
export const FOREX_PATTERN=/^[A-Z]{3}\/[A-Z]{3}$/;
const currencies=new Set("USD EUR GBP AUD CAD JPY CNY CNH CHF NZD SEK NOK DKK SGD HKD KRW INR MXN BRL ZAR TRY PLN CZK HUF THB".split(" "));
export function validForexPair(symbol:string){return FOREX_PATTERN.test(symbol)&&symbol.slice(0,3)!==symbol.slice(4)&&symbol.split("/").every(c=>currencies.has(c));}
const ny=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",weekday:"short",hour:"2-digit",hourCycle:"h23"});
export function forexMarketOpen(now:number){if(!Number.isFinite(now))return false;const p=Object.fromEntries(ny.formatToParts(now).map(p=>[p.type,p.value]));const h=Number(p.hour);return p.weekday!=="Sat"&&!(p.weekday==="Fri"&&h>=17)&&!(p.weekday==="Sun"&&h<17);}
export type ForexQuote={micro:number;at:number;source:"mock"|"twelvedata";quoteCurrency:string};
export type ForexStatus={mode:"mock"|"live"|"unconfigured";marketOpen:boolean;cadenceSeconds:number;dailyUsed:number;dailyLimit:800;message:string;day?:string;nextPollAt?:number;errors?:Record<string,string>};
export function parseForexRate(input:unknown,symbol:string,now:number):ForexQuote|null{
 const r=input as Record<string,unknown>|null;
 if(!r||r.symbol!==symbol||typeof r.rate!=="number"||!Number.isFinite(r.rate)||r.rate<=0||typeof r.timestamp!=="number")return null;
 const micro=Math.round(r.rate*1e6),at=r.timestamp*1000;
 if(!Number.isSafeInteger(micro)||micro<=0||!quoteFresh(at,now)||!forexMarketOpen(now)||!forexMarketOpen(at))return null;
 return {micro,at,source:"twelvedata",quoteCurrency:symbol.slice(4)};
}
export function forexDecision(symbol:string,q:ForexQuote|undefined,status:ForexStatus|undefined,now:number){
 const deny=(reason:string)=>({executable:false,reason,validUntil:0});
 if(!validForexPair(symbol))return deny("unsupported_forex");
 if(!forexMarketOpen(now))return deny("market_closed");
 if(!status||status.mode!=="live"||q?.source!=="twelvedata")return deny("mock_or_unconfigured");
 if(symbol.slice(4)!=="USD")return deny("USD conversion unavailable; read-only");
 if(!q||!Number.isSafeInteger(q.micro)||q.micro<=0||q.quoteCurrency!=="USD"||!quoteFresh(q.at,now))return deny("stale_quote");
 return {executable:true,reason:"fresh_USD_quote",validUntil:q.at+10000};
}
export function forexCadence(value:unknown){const n=Number(value);return Number.isSafeInteger(n)&&n>=660&&n<=86400?n:660;}
/** Reserve six quotes every 660s: 131 rounds * 6 = 786 maximum/day.
 * Validation also consumes credits. Persistent absolute budget remains authoritative. */
export function dailyForexCredits(pairs:number,cadenceSeconds:number){return Math.ceil(86400/cadenceSeconds)*pairs;}
