import {validForexPair} from "./forex-policy";
import {ensure} from "./errors";
import {audit} from "./audit";
import {marketSymbols,SYMBOL_PATTERN,MAX_ACTIVE_STOCKS,type MarketSymbols} from "./symbol-registry";
import type {Room,Identity} from "./types";
export type SymbolChange={action:"add"|"remove";kind:"crypto"|"stocks"|"forex";symbol:string;expectedVersion:number;confirmed?:boolean};
export function symbolImpact(room:Room,symbol:string){
 let holdings=0,positions=0,accounts=0;
 for(const member of room.members){
  const h=(member.holdings??[]).filter(h=>h.symbol===symbol&&h.units>0).length;
  const p=(member.positions??[]).filter(p=>p.symbol===symbol).length;
  holdings+=h;positions+=p;if(h||p)accounts++;
 }
 return {holdings,positions,accounts};
}
export function adminSymbolSnapshot(room:Room,who:Identity){
 ensure(who.admin,"Administrator access required.",403);
 const symbols=marketSymbols(room);
 return {marketSymbols:symbols,version:symbols.revision,affected:Object.fromEntries([...symbols.crypto,...symbols.stocks,...symbols.forex].map(s=>[s,symbolImpact(room,s)]))};
}
export async function validateProviderSymbol(kind:SymbolChange["kind"],symbol:string,request:typeof fetch=fetch,env:Readonly<Record<string,string|undefined>>=process.env){
 ensure(kind==="forex"?validForexPair(symbol):SYMBOL_PATTERN.test(symbol),"Use a valid uppercase symbol.");
 if(kind==="forex"){
  ensure(env.OANDA_API_TOKEN&&env.OANDA_ACCOUNT_ID,"OANDA credentials required to validate pairs.",503);
  const url=new URL("https://api-fxpractice.oanda.com/v3/accounts/"+encodeURIComponent(env.OANDA_ACCOUNT_ID)+"/instruments");url.searchParams.set("instruments",symbol.replace("/","_"));
  const response=await request(url,{headers:{Authorization:"Bearer "+env.OANDA_API_TOKEN},signal:AbortSignal.timeout(5000),cache:"no-store",redirect:"error"});
  ensure(response.ok,"Forex metadata validation unavailable.",503);const v=await response.json();
  ensure(Array.isArray(v.instruments)&&v.instruments.some((i:{name?:string;type?:string})=>i.name===symbol.replace("/","_")&&i.type==="CURRENCY"),"Unsupported OANDA practice pair; no substitutions.");return;
 }
 let response:Response;
 if(kind==="crypto"){
  response=await request("https://api.exchange.coinbase.com/products/"+encodeURIComponent(symbol+"-USD"),{signal:AbortSignal.timeout(5000),cache:"no-store"});
 }else{
  ensure(env.ALPACA_KEY_ID&&env.ALPACA_SECRET,"Alpaca credentials are not configured.",503);
  response=await request("https://paper-api.alpaca.markets/v2/assets/"+encodeURIComponent(symbol),{headers:{"APCA-API-KEY-ID":env.ALPACA_KEY_ID,"APCA-API-SECRET-KEY":env.ALPACA_SECRET},signal:AbortSignal.timeout(5000),cache:"no-store"});
 }
 ensure(response.status!==404,"Provider does not list this USD symbol.",400);
 ensure(response.ok,"Provider validation unavailable. Try again.",503);
 const value=await response.json();
 if(kind==="crypto")ensure(value.id===symbol+"-USD"&&value.base_currency===symbol&&value.quote_currency==="USD"&&value.status==="online"&&value.trading_disabled!==true,"Coinbase USD product is unavailable.");
 else ensure(value.symbol===symbol&&value.class==="us_equity"&&value.status==="active"&&value.tradable===true,"Alpaca asset is not an active tradable US equity.");
}
export function changeMarketSymbol(room:Room,who:Identity,input:SymbolChange){
 ensure(who.admin,"Administrator access required.",403);
 ensure(input.kind==="forex"?validForexPair(input.symbol):SYMBOL_PATTERN.test(input.symbol),"Use a valid uppercase symbol.");
 const current=marketSymbols(room);
 ensure(current.revision===input.expectedVersion,"Market list changed. Refresh and confirm again.",409);
 const next=structuredClone(current),symbol=input.symbol;
 if(input.action==="add"){
  ensure(![...next.crypto,...next.stocks,...next.forex].includes(symbol),"Symbol is already listed.",409);
  if(input.kind==="stocks")ensure(next.stocks.length<MAX_ACTIVE_STOCKS,"At most 30 active stocks.",409);
  if(input.kind==="forex")ensure(next.forex.length<8,"At most eight active forex pairs.",409);
  next[input.kind].push(symbol);next.delisted=next.delisted.filter(s=>s!==symbol);
  // Re-listing must not make old cached stock execution state executable.
  if(room.stockExecution)delete room.stockExecution[symbol];
 }else{
  ensure(next[input.kind].includes(symbol),"Symbol is not listed.",404);
  ensure(input.confirmed===true,"Confirm removal and affected claims first.",409);
  if(input.kind==="forex"){const impact=symbolImpact(room,symbol);if(symbol==="USD/JPY"&&next.forex.includes("AUD/JPY")){const dependent=symbolImpact(room,"AUD/JPY");ensure(!dependent.holdings&&!dependent.positions,"Conversion pair supports open AUD/JPY claims.",409);}ensure(impact.holdings===0&&impact.positions===0,"Forex pair has open claims. Close positions and sell holdings using fresh live rates before removal.",409);}
  // Empty markets are supported. Never dispose of holdings, positions or quote cache.
  next[input.kind]=next[input.kind].filter(s=>s!==symbol);
  if(!next.delisted.includes(symbol))next.delisted.push(symbol);
 }
 next.revision++;
 audit(room,who,"market-symbol-"+input.action,symbol,current,next);
 room.marketSymbols=next;
}
