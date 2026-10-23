import {db,rooms} from "./db";
import {ensure} from "./errors";
import {hideFromLeaderboard} from "./privacy-settings";
import {tradingSnapshot,tradingPerformance,SNAPSHOT_INTERVAL,PERFORMANCE_RETENTION,BASELINE_TOLERANCE,type TradingSnapshot} from "./trading-performance";

let indexes:Promise<unknown>|undefined;
export async function performanceSnapshots(){
 const collection=(await db()).collection<TradingSnapshot>("tradingPerformanceSnapshots");
 indexes??=Promise.all([
  collection.createIndex({publicId:1,bucket:1},{unique:true}),
  collection.createIndex({publicId:1,at:1}),
  collection.createIndex({expiresAt:1},{expireAfterSeconds:0}),
 ]).catch(error=>{indexes=undefined;throw error;});
 await indexes;return collection;
}
/** Raw room read, never readRoom(), visit(), mutate(), settlement or game ticks.
 * First successful sample per minute is immutable across multiple app workers. */
export async function captureTradingPerformance(now=Date.now()){
 const room=await(await rooms()).findOne({_id:"main"},{projection:{members:1,quotes:1,cryptoStatus:1,forexQuotes:1,forexStatus:1,stockExecution:1,marketSymbols:1}});
 if(!room)return;
 const collection=await performanceSnapshots();
 const samples=room.members.map(member=>tradingSnapshot(room,member,now));
 if(samples.length)await collection.bulkWrite(samples.map(sample=>({updateOne:{filter:{publicId:sample.publicId,bucket:sample.bucket},update:{$setOnInsert:sample},upsert:true}})),{ordered:false});
}
export async function getTradingPerformance(publicId:string,now=Date.now()){
 ensure(/^[a-f0-9]{16}$/.test(publicId),"Not found",404);
 const room=await(await rooms()).findOne({_id:"main"},{projection:{members:1,quotes:1,cryptoStatus:1,forexQuotes:1,forexStatus:1,stockExecution:1,marketSymbols:1}});
 const member=room?.members.find(m=>m.publicId===publicId&&!hideFromLeaderboard(m));
 ensure(room&&member,"Not found",404);
 // GET never creates snapshots or indices. Hidden and nonexistent IDs have the
 // same response, and no Clerk IDs, wallet balances or positions reach the wire.
 const collection=(await db()).collection<TradingSnapshot>("tradingPerformanceSnapshots");
 const history=await collection.find({publicId,at:{$gte:now-PERFORMANCE_RETENTION-BASELINE_TOLERANCE,$lte:now}},{projection:{_id:0}}).sort({at:1}).limit(Math.ceil(PERFORMANCE_RETENTION/SNAPSHOT_INTERVAL)+4).toArray();
 return tradingPerformance(tradingSnapshot(room,member,now),history);
}
export function startTradingPerformanceWorker(){
 const g=globalThis as typeof globalThis&{tradingPerformanceTimer?:ReturnType<typeof setInterval>};
 if(g.tradingPerformanceTimer)return;
 let running=false;
 const run=async()=>{if(running)return;running=true;try{await captureTradingPerformance();}catch{console.error("Trading performance snapshots unavailable");}finally{running=false;}};
 void run();
 g.tradingPerformanceTimer=setInterval(()=>void run(),SNAPSHOT_INTERVAL);
 g.tradingPerformanceTimer.unref();
}
