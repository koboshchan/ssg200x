import {candleUpdate} from "./candles";
import {applyMarketTick} from "./market-tick";
import {mutate} from "./store";
import {readRoom,db} from "./db";
import {randomUUID} from "node:crypto";
import {pollingInterval,decodeRates} from "./price-policy";
let running=false;
const owner=randomUUID();
export async function refreshPrices(){
 if(running)return;running=true;
 try{
 const current=await readRoom(),now=Date.now(),interval=pollingInterval(current);
 const locks=(await db()).collection<{_id:string;nextAt:number;owner:string}>("workers");
 await locks.updateOne({_id:"coinbase"},{$setOnInsert:{nextAt:0,owner:""}},{upsert:true}).catch(e=>{if(e.code!==11000)throw e;});
 const lease=await locks.updateOne({_id:"coinbase",nextAt:{$lte:now}},{$set:{nextAt:now+interval,owner}});
 if(!lease.matchedCount)return;
 const response=await fetch("https://api.coinbase.com/v2/exchange-rates?currency=USD",{cache:"no-store",signal:AbortSignal.timeout(3000)});
 if(!response.ok){
 if(response.status===429)await locks.updateOne({_id:"coinbase",owner},{$max:{nextAt:Date.now()+Math.max(1000,Math.min(60000,Number(response.headers.get("retry-after"))*1000||5000))}});
 return;
 }
 const quotes=decodeRates(await response.json(),Date.now());
 await mutate(r=>{applyMarketTick(r,quotes);});
 await candleUpdate(quotes);
 }catch{ /* Preserve timestamps; expired cache fails closed for orders. */ }
 finally{running=false;}
}
