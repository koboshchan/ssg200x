import {SYMBOLS} from "./market-shared";
import type {Room} from "./types";
export function pollingInterval(r:Room){return r.members.some(m=>(m.positions?.length||0)>0)?200:1000;}
export function decodeRates(body:unknown,at:number,symbols:readonly string[]=SYMBOLS){
 const data=(body as {data?:{currency?:string;rates?:Record<string,unknown>}})?.data;
 if(data?.currency!=="USD"||!data.rates)throw new Error("Invalid Coinbase rates");
 const entries=symbols.flatMap(s=>{const rate=Number(data.rates![s]);const micro=Math.round(1e6/rate);
 return Number.isFinite(rate)&&rate>0&&Number.isSafeInteger(micro)&&micro>0&&micro<=1e13?[[s,{micro,at}] as const]:[];
 });
 if(!entries.length)throw new Error("No valid Coinbase rates");
 return Object.fromEntries(entries);
}
