import {SYMBOLS,type Symbol,type Quote,liquidate} from "./finance";
import {mutate} from "./store";
import {readRoom} from "./db";
let running:Promise<void>|undefined;
export async function refreshPrices(){
 if(running)return running;
 running=(async()=>{
 const current=await readRoom();if(SYMBOLS.every(s=>current.quotes?.[s]&&Date.now()-current.quotes[s]!.at<2500))return;
 const entries=await Promise.all(SYMBOLS.map(async symbol=>{
 try{
 const res=await fetch("https://api.coinbase.com/v2/prices/"+symbol+"-USD/spot",{cache:"no-store",signal:AbortSignal.timeout(4000)});
 if(!res.ok)return null;const body=await res.json();const micro=Math.round(Number(body.data?.amount)*1e6);
 if(!Number.isSafeInteger(micro)||micro<=0||micro>1e13)return null;
 return [symbol,{micro,at:Date.now()}] as [Symbol,Quote];
 }catch{return null;}
 }));
 const quotes=Object.fromEntries(entries.filter(e=>e!==null));
 if(Object.keys(quotes).length)await mutate(r=>{r.quotes={...r.quotes,...quotes};liquidate(r);});
 })().finally(()=>{running=undefined;});
 return running;
}
