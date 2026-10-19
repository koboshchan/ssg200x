import { statfs } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { unzipSync } from "fflate";
import type { AnyBulkWriteOperation } from "mongodb";
import { db } from "./db";
import { SYMBOLS } from "./market-shared";

export const GRANULARITIES = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "6h": 21_600_000, "1d": 86_400_000 } as const;
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
 const to=Math.floor(now/DAY)*DAY,anchor=new Date(to),from=Date.UTC(anchor.getUTCFullYear(),anchor.getUTCMonth()-12,1);
 const result:Job[]=[];
 for(const symbol of SYMBOLS) {
  let cursor=new Date(from);cursor=new Date(Date.UTC(cursor.getUTCFullYear(),cursor.getUTCMonth(),1));
  const thisMonth=Date.UTC(new Date(to).getUTCFullYear(),new Date(to).getUTCMonth(),1);
  while(cursor.getTime()<to) {
   const start=cursor.getTime(),end=Date.UTC(cursor.getUTCFullYear(),cursor.getUTCMonth()+1,1);
   if(start>=from&&end<=to){
    const period=cursor.toISOString().slice(0,7);
    result.push({_id:`${symbol}:monthly:${period}`,symbol,kind:"monthly",period,from,to,status:"pending",attempts:0,nextAt:0});
   }else for(let day=Math.max(start,from);day<Math.min(end,to);day+=DAY){
    const period=new Date(day).toISOString().slice(0,10);
    result.push({_id:`${symbol}:daily:${period}`,symbol,kind:"daily",period,from,to,status:"pending",attempts:0,nextAt:0});
   }
   cursor=new Date(end);
  }
 }
 return result;
}
export function retryDelay(attempt: number) {return Math.min(6*60*60_000,5000*2**Math.min(12,Math.max(0,attempt-1)));}
async function seed() {
 const database=await db(),{jobs}=await collections();
 const state=database.collection<{_id:string;anchor:number;seeded?:boolean;startedAt?:number}>("candle_history_state");
 await state.updateOne({_id:"archive-12-month-v1"},{$setOnInsert:{anchor:Math.floor(Date.now()/DAY)*DAY,startedAt:Date.now()}},{upsert:true}).catch(e=>{if(e.code!==11000)throw e;});
 const boot=(await state.findOne({_id:"archive-12-month-v1"}))!;
 if(boot.seeded)return;
 const plan=archivePlan(boot.anchor);
 await jobs.bulkWrite(plan.map(job=>({updateOne:{filter:{_id:job._id},update:{$setOnInsert:job},upsert:true}})),{ordered:false});
 await state.updateOne({_id:boot._id},{$set:{seeded:true}});
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
 const space=await backfillSpace();if(space.blocked)throw new Error(space.reason!);
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
/** Call every few seconds. Globally leased, one archive at a time, restart-safe. */
export async function backfillStep() {
 if(active || process.env.CANDLE_BACKFILL_DISABLED==="1")return {status:"idle"};
 active=true;
 let job:Job|null=null;
 try {
  await seed();
  const space=await backfillSpace();
  if(space.blocked)return {status:"blocked",...space};
  const {jobs,workers}=await collections();const now=Date.now();
  await workers.updateOne({_id:"candle-backfill"},{$setOnInsert:{nextAt:0}},{upsert:true}).catch(e=>{if(e.code!==11000)throw e;});
  const gate=await workers.updateOne({_id:"candle-backfill",nextAt:{$lte:now}},{$set:{nextAt:now+300_000}});
  if(!gate.matchedCount)return {status:"busy"};
  try {
   const anchor=await (await db()).collection<{_id:string;anchor:number}>("candle_history_state").findOne({_id:"archive-12-month-v1"});
   const allowedIds=archivePlan(anchor!.anchor).map(j=>j._id);
   job=await jobs.findOneAndUpdate({_id:{$in:allowedIds},status:"pending",nextAt:{$lte:now},$or:[{leaseUntil:{$exists:false}},{leaseUntil:{$lte:now}}]},{$set:{owner,leaseUntil:now+300_000},$inc:{attempts:1}},{sort:{period:-1,symbol:1},returnDocument:"after"});
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

type Coverage = {background?:boolean;nextAttempt?:number;_id:string;symbol:string;granularity:Granularity;from:number;to:number;status:"pending"|"done"|"unavailable";expiresAt:number;rows?:number;startedAt?:number;finishedAt?:number;error?:string};
/** Fixed, nonoverlapping windows allow empty/no-tick pages to be cached as coverage. */
export function coinbasePages(from:number,to:number,width:number) {
 const span=300*width, result:{from:number;to:number}[]=[];
 for(let end=Math.floor(to/span)*span;end>=Math.floor(from/span)*span;end-=span)result.push({from:end,to:end+span});
 return result;
}
export function parseCoinbaseCandles(body:unknown,symbol:string,granularity:Granularity,from:number,to:number):Candle[] {
 if(!Array.isArray(body)||body.length>300)throw new Error("Invalid Coinbase candle response");
 const width=GRANULARITIES[granularity],out=new Map<number,Candle>();
 for(const raw of body){
  if(!Array.isArray(raw)||raw.length<6||raw.slice(0,6).some(x=>typeof x!=="number"||!Number.isFinite(x)))throw new Error("Invalid Coinbase candle row");
  const [seconds,low,high,open,close,volume]=raw as number[],time=seconds*1000;
  if(!Number.isSafeInteger(time)||time%width||Math.min(low,high,open,close)<=0||volume<0||low>Math.min(open,close)||high<Math.max(open,close))throw new Error("Invalid Coinbase candle values");
  if(time>=from&&time<to)out.set(time,{symbol,granularity,time,low,high,open,close,volume,source:"coinbase",quoteCurrency:"USD",firstAt:time,lastAt:time+width-1});
 }
 return [...out.values()].sort((a,b)=>a.time-b.time);
}
/** Only on-demand missing chart pages. At most one upstream page per invocation.
 * Mongo's global 334ms lease caps all history workers below 3 req/s, leaving live's 5 req/s untouched.
 * Caller should retry pending results later rather than hold a request open.
 */
export async function candleEnsure(symbol:string,granularity:string,from:number,to:number,window?:{from:number;to:number}) {
 validateSymbol(symbol);validateGranularity(granularity);
 const now=Date.now(),width=GRANULARITIES[granularity];
 if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<0||from>to||to>now+width||to-from>366*DAY)throw new Error("Invalid candle range (maximum 366 days)");
 const {candles,workers}=await collections(),database=await db();
 const coverage=database.collection<Coverage>("candle_coverage");
 const products=database.collection<{_id:string;unavailableUntil:number}>("candle_products");
 const product=await products.findOne({_id:symbol});
 if(product&&product.unavailableUntil>now)return {status:"unavailable",symbol,granularity,remainingPages:0};
 const pages=coinbasePages(from,to,width);
 const ids=pages.map(p=>`${symbol}:${granularity}:${p.from}`);
 const covered=await coverage.find({_id:{$in:ids},status:"done",expiresAt:{$gt:now}}).toArray();
 const done=new Set(window?[]:covered.map(p=>p._id));
 const missing=pages.filter(p=>!done.has(`${symbol}:${granularity}:${p.from}`));
 if(!missing.length)return {status:"cached",symbol,granularity,remainingPages:0};
 const page=missing[0],id=`${symbol}:${granularity}:${page.from}`;
 await coverage.bulkWrite(missing.map(p=>({updateOne:{filter:{_id:`${symbol}:${granularity}:${p.from}`},update:{$setOnInsert:{symbol,granularity,...p,status:"pending" as const,expiresAt:0}},upsert:true}})),{ordered:false});
 await workers.updateOne({_id:"coinbase-history-budget"},{$setOnInsert:{nextAt:0}},{upsert:true}).catch(e=>{if(e.code!==11000)throw e;});
 const space=await backfillSpace();
 if(space.blocked)return {status:"blocked",symbol,granularity,remainingPages:missing.length,...space};
 const lease=await workers.updateOne({_id:"coinbase-history-budget",nextAt:{$lte:now}},{$set:{nextAt:now+334}});
 if(!lease.matchedCount)return {status:"pending",symbol,granularity,remainingPages:missing.length,retryAfterMs:334};
 const start=Math.max(page.from,window?.from??page.from),end=Math.min(page.to,window?.to??page.to,Math.floor(now/width)*width);
 if(end<=start)return {status:"cached",symbol,granularity,remainingPages:0};
 await coverage.updateOne({_id:id},{$set:{startedAt:now}});
 try{
  const params=new URLSearchParams({granularity:String(width/1000),start:new Date(start).toISOString(),end:new Date(end-1).toISOString()});
  const response=await fetch(`https://api.exchange.coinbase.com/products/${symbol}-USD/candles?${params}`,{cache:"no-store",signal:AbortSignal.timeout(5000)});
  if(response.status===404){
   await products.updateOne({_id:symbol},{$set:{unavailableUntil:now+DAY}},{upsert:true});
   await coverage.updateOne({_id:id},{$set:{status:"unavailable",expiresAt:now+DAY,finishedAt:Date.now()}});
   return {status:"unavailable",symbol,granularity,remainingPages:0};
  }
  if(response.status===429){
   const delay=Math.min(60_000,Math.max(1000,Number(response.headers.get("retry-after"))*1000||5000));
   await workers.updateOne({_id:"coinbase-history-budget"},{$max:{nextAt:Date.now()+delay}});
   return {status:"pending",symbol,granularity,remainingPages:missing.length,retryAfterMs:delay};
  }
  if(!response.ok)throw new Error(`Coinbase history HTTP ${response.status}`);
  const text=await response.text();if(text.length>256*1024)throw new Error("Oversized Coinbase response");
  const rows=parseCoinbaseCandles(JSON.parse(text),symbol,granularity,start,end);
  // Historical finalized buckets replace incomplete live snapshots and optional USDT references.
  if(rows.length)await candles.bulkWrite(rows.map(c=>({updateOne:{filter:{_id:key(c)},update:{$set:c},upsert:true}})),{ordered:false});
  await coverage.updateOne({_id:id},{$set:{status:"done",rows:rows.length,finishedAt:Date.now(),expiresAt:page.to<=now?Number.MAX_SAFE_INTEGER:now+60_000,error:""}});
  return {status:missing.length>1?"pending":"cached",symbol,granularity,remainingPages:missing.length-1,rows:rows.length,retryAfterMs:334};
 }catch(error){
  const message=error instanceof Error?error.message:"History fetch failed";
  await coverage.updateOne({_id:id},{$set:{error:message.slice(0,200)}});
  await workers.updateOne({_id:"coinbase-history-budget"},{$max:{nextAt:Date.now()+5000}});
  return {status:"retry",symbol,granularity,remainingPages:missing.length,error:message,retryAfterMs:3340};
 }
}
export async function backfillProgress() {
 const database=await db(),now=Date.now();
 const pages=await database.collection<Coverage>("candle_coverage").aggregate<{_id:{symbol:string;status:string};count:number;rows:number;duration:number}>([
  {$group:{_id:{symbol:"$symbol",status:"$status"},count:{$sum:1},rows:{$sum:{$ifNull:["$rows",0]}},duration:{$sum:{$cond:[{$and:[{$ne:["$finishedAt",null]},{$ne:["$startedAt",null]}]},{$subtract:["$finishedAt","$startedAt"]},0]}}}}
 ]).toArray();
 const unavailable=await database.collection<{_id:string;unavailableUntil:number}>("candle_products").find({unavailableUntil:{$gt:now}}).toArray();
 const symbols=SYMBOLS.map(symbol=>{
  const stats=pages.filter(p=>p._id.symbol===symbol),done=stats.filter(p=>p._id.status==="done").reduce((n,p)=>n+p.count,0),pending=stats.filter(p=>p._id.status==="pending").reduce((n,p)=>n+p.count,0);
  const duration=stats.reduce((n,p)=>n+p.duration,0),rows=stats.reduce((n,p)=>n+p.rows,0);
  return {symbol,done,pending,rows,total:done+pending,unavailable:unavailable.some(p=>p._id===symbol),percent:done+pending?Math.round(100*done/(done+pending)):0,etaSeconds:pending?Math.ceil(pending*Math.max(500,done?duration/done:500)/1000):0};
 });
 const done=symbols.reduce((n,s)=>n+s.done,0),pending=symbols.reduce((n,s)=>n+s.pending,0);
 return {mode:"background-12-months-plus-current",enabled:true,archiveEnabled:true,archive:await archiveProgress(),source:"Binance USDT reference history; Coinbase USD live/incremental",symbols,overall:{done,pending,total:done+pending,rows:symbols.reduce((n,s)=>n+s.rows,0),percent:done+pending?Math.round(100*done/(done+pending)):0,etaSeconds:symbols.reduce((n,s)=>n+s.etaSeconds,0)},history:await historyProgress(),etaScope:"12 complete months plus current-month daily USDT archives"};
}

/** Point CANDLE_STORAGE_PATH at the Mongo volume's host mount when Mongo is remote.
 * Unknown capacity fails closed. Each step and every import rechecks actual available bytes.
 */
export function assessBackfillSpace(freeBytes:number,requiredBytes=2*1024**3) {
 const blocked=!Number.isFinite(freeBytes)||freeBytes<requiredBytes;
 return {freeBytes,requiredBytes,blocked,reason:blocked?`Historical backfill blocked: ${freeBytes} available bytes; ${requiredBytes} required`:null};
}
export async function backfillSpace() {
 const path=process.env.CANDLE_STORAGE_PATH||process.cwd();
 try{const fs=await statfs(path);return {path,...assessBackfillSpace(fs.bavail*fs.bsize)};}
 catch{return {path,...assessBackfillSpace(0),reason:"Historical backfill blocked: storage capacity could not be checked"};}
}
async function archiveProgress() {
 const space=await backfillSpace();
 const {jobs}=await collections();
 const counts=await jobs.aggregate<{_id:string;count:number}>([{$group:{_id:"$status",count:{$sum:1}}}]).toArray();
 const count=(status:string)=>counts.find(c=>c._id===status)?.count||0;
 const pending=count("pending"),done=count("done"),missing=count("missing");
 const enabled=process.env.CANDLE_BACKFILL_DISABLED!=="1";
 return {enabled,status:!enabled?"disabled":space.blocked?"blocked":pending?"pending":done+missing?"complete":"not-started",...space,pending,done,missing,total:pending+done+missing,etaSeconds:null,etaReason:"Archive throughput has not been measured",symbols:await jobs.aggregate([{$group:{_id:{symbol:"$symbol",status:"$status"},count:{$sum:1}}}]).toArray()};
}

export function historyPlan(now=Date.now()):Coverage[] {
 const result:Coverage[]=[];
 for(const symbol of SYMBOLS)for(const granularity of Object.keys(GRANULARITIES) as Granularity[]){
  const width=GRANULARITIES[granularity];
  for(const page of coinbasePages(now-360*DAY,Math.floor(now/width)*width-1,width))result.push({_id:`${symbol}:${granularity}:${page.from}`,symbol,granularity,...page,status:"pending",expiresAt:0,background:true});
 }
 return result;
}
/** Timer entrypoint: automatic fixed 12 complete months plus current-month daily USDT archives. Coinbase live updates run separately. */
export async function historyBackfillStep(){
 const result=await backfillStep();
 if(result.status!=="complete")return result;
 const database=await db(),state=database.collection<{_id:string;cursor:number;nextAt:number}>("candle_incremental_state");
 await state.updateOne({_id:"coinbase-latest-two"},{$setOnInsert:{cursor:0,nextAt:0}},{upsert:true}).catch(e=>{if(e.code!==11000)throw e;});
 const now=Date.now();
 const turn=await state.findOneAndUpdate({_id:"coinbase-latest-two",nextAt:{$lte:now}},{$set:{nextAt:now+30_000}},{returnDocument:"before"});
 if(!turn)return {status:"pending"};
 const granularities=Object.keys(GRANULARITIES) as Granularity[],index=turn.cursor%(SYMBOLS.length*granularities.length);
 const symbol=SYMBOLS[Math.floor(index/granularities.length)],granularity=granularities[index%granularities.length],width=GRANULARITIES[granularity];
 const to=Math.floor(now/width)*width,from=to-2*width;
 const update=await candleEnsure(symbol,granularity,from,to-1,{from,to});
 const advance=!["pending","retry","blocked"].includes(update.status);
 await state.updateOne({_id:turn._id},{$set:{nextAt:Date.now()+334},...(advance?{$inc:{cursor:1}}:{})});
 return {...update,mode:"coinbase-incremental"};
}
async function historyProgress(){
 const database=await db(),space=await backfillSpace(),{jobs}=await collections();
 const state=await database.collection<{_id:string;anchor:number;startedAt?:number;seeded?:boolean}>("candle_history_state").findOne({_id:"archive-12-month-v1"});
 const planned=state?archivePlan(state.anchor):[];
 const ids=planned.map(j=>j._id);
 const records=ids.length?await jobs.find({_id:{$in:ids}}).toArray():[];
 const symbols=SYMBOLS.map(symbol=>{
  const rows=records.filter(j=>j.symbol===symbol),total=planned.filter(j=>j.symbol===symbol).length;
  const done=rows.filter(j=>j.status==="done"||j.status==="missing").length;
  const months=rows.filter(j=>j.kind==="monthly"),days=rows.filter(j=>j.kind==="daily");
  const finished=(list:typeof rows)=>list.filter(j=>j.status==="done"||j.status==="missing").length;
  const elapsed=state?.startedAt?Math.max(0,Date.now()-state.startedAt)/1000:0;
  return {symbol,done,total,percent:total?Math.round(100*done/total):0,unavailable:rows.some(j=>j.status==="missing"),monthsDone:finished(months),monthsTotal:planned.filter(j=>j.symbol===symbol&&j.kind==="monthly").length,daysDone:finished(days),daysTotal:planned.filter(j=>j.symbol===symbol&&j.kind==="daily").length,currentSource:done===total&&total?"Coinbase USD live/incremental":"Binance USDT reference archives",etaSeconds:space.blocked||!done||!elapsed?null:Math.ceil((total-done)*elapsed/done)};
 });
 const done=symbols.reduce((n,s)=>n+s.done,0),total=planned.length;
 return {source:"Binance USDT reference history; Coinbase USD live/incremental",window:state?{from:archivePlan(state.anchor)[0].from,to:state.anchor,completeMonths:12}:null,status:space.blocked?"blocked":!state?.seeded?"initializing":done<total?"running":total?"complete":"initializing",...space,symbols,overall:{done,total,percent:total?Math.round(100*done/total):0,etaSeconds:space.blocked||!done||!state?.startedAt?null:Math.ceil((total-done)*Math.max(0,Date.now()-state.startedAt)/1000/done)},etaKind:"Observed completed-job throughput since initialization; missing archives explicitly unavailable"};
}

let maintenanceCache:{at:number;active:boolean}|undefined;
/** Small fail-closed maintenance check; no progress payload, cached for one second. */
export async function historyMaintenanceActive(){
 const now=Date.now();if(maintenanceCache&&now-maintenanceCache.at<1000)return maintenanceCache.active;
 try{
  const database=await db(),state=await database.collection<{_id:string;anchor:number;seeded?:boolean}>("candle_history_state").findOne({_id:"archive-12-month-v1"});
  let active=true;
  if(state?.seeded){
   const ids=archivePlan(state.anchor).map(j=>j._id);
   const completed=await database.collection<{_id:string;status:string}>("candle_backfill").countDocuments({_id:{$in:ids},status:{$in:["done","missing"]}});
   active=completed!==ids.length;
  }
  maintenanceCache={at:now,active};return active;
 }catch{maintenanceCache={at:now,active:true};return true;}
}
