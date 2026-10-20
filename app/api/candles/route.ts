import {endpoint} from "@/lib/api";
import {rateLimit} from "@/lib/store";
import {ensure} from "@/lib/errors";
import {isTradingSymbol} from "@/lib/market-shared";
import {candleRead,GRANULARITIES} from "@/lib/candles";
export const GET=(request:Request)=>endpoint(request,async who=>{
 await rateLimit("candles:"+who.id,120);
 const p=new URL(request.url).searchParams;
 const symbol=p.get("symbol")||"BTC",g=p.get("granularity")||"1h";
 ensure(isTradingSymbol(symbol)&&Object.hasOwn(GRANULARITIES,g),"Unsupported chart.");
 const to=Number(p.get("to")||Date.now()),from=Number(p.get("from")||(to-30*86400000));
 ensure(Number.isSafeInteger(to)&&Number.isSafeInteger(from)&&from>=0&&to>=from&&to-from<=366*86400000,"Invalid chart range.");
 return {status:"cached",candles:await candleRead(symbol,g,from,to,1000)};
});
