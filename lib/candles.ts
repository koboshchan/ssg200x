import type { AnyBulkWriteOperation } from "mongodb";
import { db } from "./db";
import { SYMBOLS, isDelistedSymbol } from "./market-shared";

// Stored archive rows remain readable; all new observations come from the shared live feed.
export const GRANULARITIES = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "6h": 21_600_000, "1d": 86_400_000 } as const;
export type Granularity = keyof typeof GRANULARITIES;
export type Candle = { symbol: string; granularity: Granularity; time: number; open: number; high: number; low: number; close: number; volume: number; source: "binance" | "coinbase"; quoteCurrency: "USDT" | "USD"; firstAt: number; lastAt: number };
type StoredCandle = Candle & { _id: string };
let indexes: Promise<unknown> | undefined;
async function collections() {
 const candles = (await db()).collection<StoredCandle>("candles");
 indexes ??= candles.createIndex({symbol:1,granularity:1,time:1},{unique:true}).catch(e=>{indexes=undefined;throw e;});
 await indexes;
 return {candles};
}
function validateSymbol(symbol: string) { if (!(SYMBOLS as readonly string[]).includes(symbol)) throw new Error("Unsupported symbol"); }
function validateGranularity(g: string): asserts g is Granularity { if (!Object.hasOwn(GRANULARITIES,g)) throw new Error("Unsupported candle granularity"); }
function key(c: Pick<Candle,"symbol"|"granularity"|"time">) { return `${c.symbol}:${c.granularity}:${c.time}`; }
export async function candleRead(symbol: string, granularity: string, from: number, to: number, limit=1000): Promise<Candle[]> {
 if(!isDelistedSymbol(symbol))validateSymbol(symbol);validateGranularity(granularity);
 if(!Number.isFinite(from)||!Number.isFinite(to)||from>to||!Number.isFinite(limit)||limit<1)throw new Error("Invalid candle range");
 const {candles}=await collections();
 // Latest N points in the requested range, returned chronologically.
 const rows=await candles.find({symbol,granularity,time:{$gte:from,$lte:to}},{projection:{_id:0}}).sort({time:-1}).limit(Math.min(5000,Math.floor(limit))).toArray();
 return rows.reverse();
}
type QuoteSnapshot = Partial<Record<string,{micro:number;at:number}>>;
/** Quotes are cache snapshots, not trade prints. Volume is unknown and stays zero.
 * Array entries are processed in arrival order, including equal-time closes.
 */
export async function candleUpdate(quotes: QuoteSnapshot | readonly QuoteSnapshot[]) {
 const {candles}=await collections();
 const ops: AnyBulkWriteOperation<StoredCandle>[]=[];
 for(const snapshot of Array.isArray(quotes)?quotes:[quotes as QuoteSnapshot])for(const symbol of SYMBOLS) {
  const q=snapshot[symbol];
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
 if(ops.length)await candles.bulkWrite(ops,{ordered:true});
}
