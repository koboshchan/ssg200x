import { createHash, randomUUID } from "node:crypto";
import { unzipSync } from "fflate";
import type { AnyBulkWriteOperation } from "mongodb";
import { db } from "./db";
import { SYMBOLS } from "./market-shared";

export const GRANULARITIES = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000 } as const;
export type Granularity = keyof typeof GRANULARITIES;
export type Candle = { symbol: string; granularity: Granularity; time: number; open: number; high: number; low: number; close: number; volume: number; source: "binance" | "coinbase"; quoteCurrency: "USDT" | "USD"; firstAt: number; lastAt: number };
type StoredCandle = Candle & { _id: string };
type Job = { _id: string; symbol: string; period: string; kind: "monthly" | "daily"; from: number; to: number; status: "pending" | "done" | "missing"; attempts: number; nextAt: number; leaseUntil?: number; owner?: string; rows?: number; error?: string };
const DAY = 86_400_000;
const owner = randomUUID();
let indexes: Promise<unknown> | undefined;
let active = false;
async function collections() {
 const d = await db();
 const candles = d.collection<StoredCandle>("candles");
 const jobs = d.collection<Job>("candle_backfill");
 indexes ??= Promise.all([candles.createIndex({symbol:1,granularity:1,time:1},{unique:true}),jobs.createIndex({status:1,nextAt:1,leaseUntil:1})]).catch(e=>{indexes=undefined;throw e;});
 await indexes;
 return {candles,jobs,workers:d.collection<{_id:string;nextAt:number}>("workers")};
}
function validateSymbol(symbol: string) { if (!(SYMBOLS as readonly string[]).includes(symbol)) throw new Error("Unsupported symbol"); }
function validateGranularity(g: string): asserts g is Granularity { if (!Object.hasOwn(GRANULARITIES,g)) throw new Error("Unsupported candle granularity"); }
function key(c: Pick<Candle,"symbol"|"granularity"|"time">) { return `${c.symbol}:${c.granularity}:${c.time}`; }
/** Binance spot archive timestamps switched from milliseconds to microseconds in 2025. */
export function parseKline(line: string, symbol: string): Candle | null {
 const fields = line.trim().split(",");
 if (!line.trim() || /^(open_time|open time)/i.test(fields[0])) return null;
 if(fields.length<6 || fields.slice(0,6).some(x=>!x.trim())) throw new Error("Invalid kline row");
 const [raw,open,high,low,close,volume] = fields.slice(0,6).map(Number);
 const time = Math.floor(raw >= 1e14 ? raw/1000 : raw);
 if (![time,open,high,low,close,volume].every(Number.isFinite) || !Number.isSafeInteger(time) || time<0 || time%60_000!==0 || Math.min(open,high,low,close)<=0 || volume<0 || high<Math.max(open,close,low) || low>Math.min(open,close,high)) throw new Error("Invalid kline values");
 return {symbol,granularity:"1m",time,open,high,low,close,volume,source:"binance",quoteCurrency:"USDT",firstAt:time,lastAt:time+59_999};
}
/** Pure, deterministic aggregation; duplicates are deduped before volume is summed. */
export function aggregateCandles(rows: Candle[], granularity: Granularity): Candle[] {
 const unique = new Map(rows.map(r=>[r.time,r]));
 const buckets = new Map<number,Candle>();
 for (const row of [...unique.values()].sort((a,b)=>a.time-b.time)) {
  const time = Math.floor(row.time/GRANULARITIES[granularity])*GRANULARITIES[granularity];
  const prev = buckets.get(time);
  if (!prev) buckets.set(time,{...row,time,granularity});
  else {prev.high=Math.max(prev.high,row.high);prev.low=Math.min(prev.low,row.low);prev.close=row.close;prev.lastAt=row.lastAt;prev.volume+=row.volume;}
 }
 return [...buckets.values()];
}
/** ZIP is limited to a single bounded monthly archive, never the entire history. */
export function parseArchive(bytes: Uint8Array, symbol: string, from: number, to: number): Candle[] {
 const files = unzipSync(bytes,{filter:file=>file.name.endsWith(".csv") && file.originalSize<=32*1024*1024});
 const names = Object.keys(files);
 if(names.length!==1) throw new Error("Expected one bounded CSV archive member");
 const text = new TextDecoder("utf-8",{fatal:true}).decode(files[names[0]]);
 return text.split("\n").flatMap(line=>{const row=parseKline(line,symbol);return row && row.time>=from && row.time<to ? [row] : [];});
}
export async function candleRead(symbol: string, granularity: string, from: number, to: number, limit=1000): Promise<Candle[]> {
 validateSymbol(symbol);validateGranularity(granularity);
 if(!Number.isFinite(from)||!Number.isFinite(to)||from>to||!Number.isFinite(limit)||limit<1)throw new Error("Invalid candle range");
 const {candles}=await collections();
 // Latest N points in the requested range, returned chronologically.
 const rows=await candles.find({symbol,granularity,time:{$gte:from,$lte:to}},{projection:{_id:0}}).sort({time:-1}).limit(Math.min(5000,Math.floor(limit))).toArray();
 return rows.reverse();
}
/** Quotes are cache snapshots, not trade prints. Volume is unknown and stays zero. */
export async function candleUpdate(quotes: Partial<Record<string,{micro:number;at:number}>>) {
 const {candles}=await collections();
 const ops: AnyBulkWriteOperation<StoredCandle>[]=[];
 for(const symbol of SYMBOLS) {
  const q=quotes[symbol];
  if(!q || !Number.isFinite(q.micro)||q.micro<=0||!Number.isSafeInteger(q.at)||q.at<0)continue;
  const price=q.micro/1e6;
  for(const [granularity,width] of Object.entries(GRANULARITIES)) {
   const time=Math.floor(q.at/width)*width;
   const id=key({symbol,granularity:granularity as Granularity,time});
   // Atomic pipeline keeps open/close correct even with duplicate or out-of-order snapshots.
   ops.push({updateOne:{filter:{_id:id},update:[
    {$set:{symbol,granularity,time,
     open:{$cond:[{$or:[{$eq:[{$type:"$firstAt"},"missing"]},{$lt:[q.at,"$firstAt"]}]},price,"$open"]},
     close:{$cond:[{$or:[{$eq:[{$type:"$lastAt"},"missing"]},{$gte:[q.at,"$lastAt"]}]},price,"$close"]},
     high:{$max:[{$ifNull:["$high",price]},price]},low:{$min:[{$ifNull:["$low",price]},price]},
     firstAt:{$min:[{$ifNull:["$firstAt",q.at]},q.at]},lastAt:{$max:[{$ifNull:["$lastAt",q.at]},q.at]},
     volume:{$ifNull:["$volume",0]},source:"coinbase",quoteCurrency:"USD"}}
   ],upsert:true}});
  }
 }
 if(ops.length)await candles.bulkWrite(ops,{ordered:false});
}
export function archivePlan(now=Date.now()): Job[] {
 const to=Math.floor(now/DAY)*DAY,from=to-360*DAY;
 const result:Job[]=[];
 for(const symbol of SYMBOLS) {
  let cursor=new Date(from);cursor=new Date(Date.UTC(cursor.getUTCFullYear(),cursor.getUTCMonth(),1));
  const thisMonth=Date.UTC(new Date(to).getUTCFullYear(),new Date(to).getUTCMonth(),1);
  while(cursor.getTime()<thisMonth) {
   const period=cursor.toISOString().slice(0,7);
   result.push({_id:`${symbol}:monthly:${period}`,symbol,kind:"monthly",period,from,to,status:"pending",attempts:0,nextAt:0});
   cursor=new Date(Date.UTC(cursor.getUTCFullYear(),cursor.getUTCMonth()+1,1));
  }
  for(let day=Math.max(thisMonth,from);day<to;day+=DAY){
   const period=new Date(day).toISOString().slice(0,10);
   result.push({_id:`${symbol}:daily:${period}`,symbol,kind:"daily",period,from,to,status:"pending",attempts:0,nextAt:0});
  }
 }
 return result;
}
export function retryDelay(attempt: number) {return Math.min(6*60*60_000,5000*2**Math.min(12,Math.max(0,attempt-1)));}
async function seed() {
 const {jobs,workers}=await collections();
 const now=Date.now();
 // A persistent daily planner marker prevents reseeding hundreds of jobs every few seconds.
 const day=Math.floor(now/DAY);
 const marker=await workers.findOne({_id:"candle-plan"});
 if(marker?.nextAt===day)return;
 const plan=archivePlan(now);
 await jobs.bulkWrite(plan.map(job=>({updateOne:{filter:{_id:job._id},update:{$setOnInsert:job},upsert:true}})),{ordered:false});
 await workers.updateOne({_id:"candle-plan"},{$set:{nextAt:day}},{upsert:true});
}
async function boundedDownload(url: string, cap: number) {
 const response=await fetch(url,{signal:AbortSignal.timeout(30_000),cache:"no-store"});
 if(response.status===404)return null;
 if(!response.ok)throw new Error(`Archive HTTP ${response.status}`);
 if(Number(response.headers.get("content-length"))>cap)throw new Error("Archive exceeds size limit");
 if(!response.body)throw new Error("Empty archive response");
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let total=0;
 try {for(;;){const {value,done}=await reader.read();if(done)break;total+=value.length;if(total>cap)throw new Error("Archive exceeds size limit");chunks.push(value);}}
 finally {await reader.cancel().catch(()=>{});}
 return Buffer.concat(chunks,total);
}
async function importJob(job:Job) {
 const {candles,jobs}=await collections();
 const pair=`${job.symbol}USDT`;
 const url=`https://data.binance.vision/data/spot/${job.kind}/klines/${pair}/1m/${pair}-1m-${job.period}.zip`;
 const bytes=await boundedDownload(url,16*1024*1024);
 if(bytes===null){await jobs.updateOne({_id:job._id,owner},{$set:{status:"missing",leaseUntil:0}});return;}
 const checksum=await boundedDownload(url+".CHECKSUM",4096);
 if(!checksum || createHash("sha256").update(bytes).digest("hex")!==checksum.toString("utf8").trim().split(/\s+/)[0])throw new Error("Archive checksum mismatch");
 const rows=parseArchive(bytes,job.symbol,job.from,job.to);
 for(const granularity of Object.keys(GRANULARITIES) as Granularity[]) {
  const aggregated=aggregateCandles(rows,granularity);
  for(let i=0;i<aggregated.length;i+=1000) {
   const batch=aggregated.slice(i,i+1000);
   // setOnInsert makes retries after partial writes safe, and preserves live USD snapshots.
   await candles.bulkWrite(batch.map(c=>({updateOne:{filter:{_id:key(c)},update:{$setOnInsert:{...c,_id:key(c)}},upsert:true}})),{ordered:false});
   await jobs.updateOne({_id:job._id,owner},{$set:{leaseUntil:Date.now()+300_000}});
  }
 }
 await jobs.updateOne({_id:job._id,owner},{$set:{status:"done",rows:rows.length,leaseUntil:0,error:""}});
}
export async function backfillProgress() {
 const {jobs}=await collections();
 const counts=await jobs.aggregate< {status:string;count:number} >([{$group:{_id:"$status",count:{$sum:1}}},{$project:{_id:0,status:"$_id",count:1}}]).toArray();
 return {enabled:process.env.CANDLE_BACKFILL_DISABLED!=="1",source:"Binance spot USDT reference history; Coinbase USD live snapshots",counts};
}
/** Call every few seconds. Globally leased, one archive at a time, restart-safe. */
export async function backfillStep() {
 if(active || process.env.CANDLE_BACKFILL_DISABLED==="1")return {status:"idle"};
 active=true;
 let job:Job|null=null;
 try {
  await seed();
  const {jobs,workers}=await collections();const now=Date.now();
  await workers.updateOne({_id:"candle-backfill"},{$setOnInsert:{nextAt:0}},{upsert:true}).catch(e=>{if(e.code!==11000)throw e;});
  const gate=await workers.updateOne({_id:"candle-backfill",nextAt:{$lte:now}},{$set:{nextAt:now+300_000}});
  if(!gate.matchedCount)return {status:"busy"};
  try {
   job=await jobs.findOneAndUpdate({status:"pending",nextAt:{$lte:now},$or:[{leaseUntil:{$exists:false}},{leaseUntil:{$lte:now}}]},{$set:{owner,leaseUntil:now+300_000},$inc:{attempts:1}},{sort:{period:-1,symbol:1},returnDocument:"after"});
   if(!job)return {status:"complete"};
   await importJob(job);
   return {status:"processed",job:job._id};
  } finally {await workers.updateOne({_id:"candle-backfill"},{$set:{nextAt:Date.now()+3000}});}
 } catch(error) {
  const message=error instanceof Error?error.message:"Backfill error";
  if(job){const {jobs}=await collections();await jobs.updateOne({_id:job._id,owner},{$set:{error:message.slice(0,200),leaseUntil:0,nextAt:Date.now()+retryDelay(job.attempts)}});}
  return {status:"retry",job:job?._id,error:message};
 } finally {active=false;}
}
