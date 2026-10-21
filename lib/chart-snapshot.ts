import {activeSymbol,type SymbolContext} from "./symbol-registry";
import {candleRead,GRANULARITIES,type Granularity} from "./candles";
export type ChartSelection={symbol:string;granularity:Granularity};
export function chartSelection(symbol:unknown,granularity:unknown,context?:SymbolContext):ChartSelection|null{
 return typeof symbol==="string"&&activeSymbol(symbol,context)&&typeof granularity==="string"&&Object.hasOwn(GRANULARITIES,granularity)?{symbol,granularity:granularity as Granularity}:null;
}
/** Bounded LRU of active chart selections, one shared Mongo read per 2s.
 * Socket subscribers only read our stored candles. No upstream history fetch.
 */
export function chartSnapshotCache(load:typeof candleRead=candleRead,now=Date.now){
 const cache=new Map<string,{until:number;pending:ReturnType<typeof load>}>();
 return (selection:ChartSelection)=>{
  const width=GRANULARITIES[selection.granularity],to=Math.floor(now()/width)*width,from=to-width*300;
  const key=selection.symbol+":"+selection.granularity,previous=cache.get(key);
  if(previous){cache.delete(key);cache.set(key,previous);}
  if(!previous&&cache.size>=512)cache.delete(cache.keys().next().value!);
  if(previous&&now()<previous.until)return previous.pending;
  const entry={until:now()+2000,pending:load(selection.symbol,selection.granularity,from,to,301)};
  cache.set(key,entry);
  entry.pending.catch(()=>{if(cache.get(key)===entry)cache.delete(key);});
  return entry.pending;
 };
}
export const chartSnapshot=chartSnapshotCache();
