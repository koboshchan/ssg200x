import {candleRead,GRANULARITIES,type Granularity} from "./candles";
import {TRADING_SYMBOLS} from "./market-shared";
export type ChartSelection={symbol:string;granularity:Granularity};
export function chartSelection(symbol:unknown,granularity:unknown):ChartSelection|null{
 return typeof symbol==="string"&&(TRADING_SYMBOLS as readonly string[]).includes(symbol)&&typeof granularity==="string"&&Object.hasOwn(GRANULARITIES,granularity)?{symbol,granularity:granularity as Granularity}:null;
}
/** At most 120 keys (20 symbols x 6 intervals), one shared Mongo read per 2s.
 * Socket subscribers only read our stored candles. No upstream history fetch.
 */
export function chartSnapshotCache(load:typeof candleRead=candleRead,now=Date.now){
 const cache=new Map<string,{until:number;pending:ReturnType<typeof load>}>();
 return (selection:ChartSelection)=>{
  const width=GRANULARITIES[selection.granularity],to=Math.floor(now()/width)*width,from=to-width*300;
  const key=selection.symbol+":"+selection.granularity,previous=cache.get(key);
  if(previous&&now()<previous.until)return previous.pending;
  const entry={until:now()+2000,pending:load(selection.symbol,selection.granularity,from,to,301)};
  cache.set(key,entry);
  entry.pending.catch(()=>{if(cache.get(key)===entry)cache.delete(key);});
  return entry.pending;
 };
}
export const chartSnapshot=chartSnapshotCache();
