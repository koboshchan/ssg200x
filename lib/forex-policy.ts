export const FOREX_DEFAULTS=["EUR/USD","USD/JPY","GBP/USD","USD/CNH","USD/CAD","AUD/USD","USD/CHF","AUD/JPY"];
export const FOREX_PATTERN=/^[A-Z]{3}\/[A-Z]{3}$/;
// Explicit supported practice instruments; no silent CNY/CNH substitution or inverse duplicates.
export function validForexPair(symbol:string){return FOREX_DEFAULTS.includes(symbol);}
const ny=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",weekday:"short",hour:"2-digit",hourCycle:"h23"});
export function forexMarketOpen(now:number){if(!Number.isFinite(now))return false;const p=Object.fromEntries(ny.formatToParts(now).map(p=>[p.type,p.value]));const h=Number(p.hour);return p.weekday!=="Sat"&&!(p.weekday==="Fri"&&h>=17)&&!(p.weekday==="Sun"&&h<17);}
export type ForexQuote={micro:number;at:number;source:"mock"|"oanda";quoteCurrency:string;received?:number;receiptMono?:number;nativeMicro?:number;usdMicro?:number;quoteUsd?:number;legs?:{at:number;received:number;receiptMono:number;generation?:string}[]};
export type ForexStatus={mode:"mock"|"live"|"unconfigured";stream?:"streaming"|"connecting"|"reconnecting"|"down";marketOpen:boolean;message:string;leaseUntil?:number;clockDomain?:string;generation?:string;lastFrameWall?:number;lastFrameMono?:number;errors?:Record<string,string>};
export function forexDecision(symbol:string,q:ForexQuote|undefined,status:ForexStatus|undefined,now:number,mono?:number,clockDomain?:string){
 const deny=(reason:string)=>({executable:false,reason,validUntil:0});
 if(!validForexPair(symbol))return deny("unsupported_forex");
 if(!forexMarketOpen(now))return deny("market_closed");
 if(!status||status.mode!=="live"||status.stream!=="streaming"||q?.source!=="oanda"||!(status.leaseUntil!>now))return deny("stream_unavailable");
 if(clockDomain!==undefined&&status.clockDomain!==clockDomain)return deny("clock_domain_mismatch");
 const legs=q?.legs;
 if(!status.generation||!Number.isFinite(status.lastFrameWall)||!Number.isFinite(status.lastFrameMono)||now<status.lastFrameWall!||now-status.lastFrameWall!>15000||(mono!==undefined&&(mono<status.lastFrameMono!||mono-status.lastFrameMono!>15000)))return deny("stream_unhealthy");
 if(!q||!Number.isSafeInteger(q.micro)||q.micro<=0||!Number.isFinite(q.quoteUsd)||q.quoteUsd!<=0||!Number.isSafeInteger(q.usdMicro)||q.usdMicro!<=0||!legs?.length||!legs.every(l=>l.generation===status.generation&&Number.isSafeInteger(l.at)&&l.at>=0&&l.at<=now&&Number.isSafeInteger(l.received)&&l.received>=0&&l.received<=now&&(mono===undefined||Number.isFinite(l.receiptMono)&&mono>=l.receiptMono)))return deny("missing_current_generation_quote_or_conversion");
 return {executable:true,reason:"healthy_stream_current_generation_price",validUntil:Math.min(status.leaseUntil!,status.lastFrameWall!+15001)};
}
