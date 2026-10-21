export type CandleRow={time:number;open:number;high:number;low:number;close:number};
/** Session-memory LRU. Public prices only, bounded by selections and rows. */
export function createChartCache(maxEntries=24,maxRows=301,ttl=5000){
 const entries=new Map<string,{rows:CandleRow[];checkedAt:number}>();
 return {
  get(key:string){const entry=entries.get(key);if(entry){entries.delete(key);entries.set(key,entry);}return entry;},
  put(key:string,rows:CandleRow[],now=Date.now()){
   const old=entries.get(key),merged=new Map((old?.rows||[]).map(row=>[row.time,row]));
   for(const row of rows)merged.set(row.time,row);
   const entry={rows:[...merged.values()].sort((a,b)=>a.time-b.time).slice(-maxRows),checkedAt:now};
   entries.delete(key);entries.set(key,entry);
   while(entries.size>maxEntries)entries.delete(entries.keys().next().value!);
   return entry;
  },
  range(key:string,width:number,now=Date.now()){
   const entry=entries.get(key),to=Math.floor(now/width)*width;
   if(entry&&now-entry.checkedAt<ttl)return null;
   return {from:Math.max(to-width*300,entry?.rows.at(-1)?.time??0),to};
  },
  get size(){return entries.size;}
 };
}
export const chartCache=createChartCache();

