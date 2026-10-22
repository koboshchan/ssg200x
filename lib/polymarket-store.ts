import {mutate} from "./store";
import {readRoom} from "./db";
import {ensure} from "./errors";
import {financeReceipt} from "./finance-requests";
import {polyBook,polyMarket,polyResolution} from "./polymarket-data";
import {applyPolymarketTrade,polyPortfolio,settlePolymarket,polyTradeSchema} from "./polymarket";
import type {Identity} from "./types";
import type {PolyTrade} from "./polymarket-types";
export async function polymarketTrade(who:Identity,input:PolyTrade){
 polyTradeSchema.parse(input);
 const current=await readRoom(),receipt=financeReceipt(current,who.id,input);
 if(receipt==="committed")return polyPortfolio(current,who);
 ensure(receipt===null,"This order was cancelled. Place a new order.",409);
 ensure(Date.now()-input.requestAt>=-10_000&&Date.now()-input.requestAt<=120_000,"Request expired. Review before placing a new order.",409);
 // Fetch before CAS, then revalidate freshness, limits and wallet on EVERY retry.
 const [market,book]=await Promise.all([polyMarket(input.marketId,true),polyBook(input.tokenId,true)]);
 const {room}=await mutate(r=>applyPolymarketTrade(r,who,input,market,book));return polyPortfolio(room,who);
}
let cursor=0;
export async function tickPolymarket(){
 const r=await readRoom(),ids=[...new Set((r.polymarket?.positions??[]).map(p=>p.marketId))].sort();
 if(!ids.length)return;
 const batch=Array.from({length:Math.min(20,ids.length)},(_,i)=>ids[(cursor+i)%ids.length]);cursor=(cursor+batch.length)%ids.length;
 // Small bounded pool. A missing/disputed market never blocks unrelated settlements.
 for(let i=0;i<batch.length;i+=4)await Promise.all(batch.slice(i,i+4).map(async id=>{
  try{const resolution=await polyResolution(id);if(resolution)await mutate(r=>settlePolymarket(r,resolution));}
  catch{console.warn("Prediction settlement deferred for market",id);}
 }));
}
const workers=globalThis as typeof globalThis&{__polymarketWorker?:ReturnType<typeof setInterval>};
export function startPolymarketWorker(){
 if(workers.__polymarketWorker||!process.env.MONGODB_URI)return;
 let busy=false;
 const run=async()=>{if(busy)return;busy=true;try{await tickPolymarket();}catch{console.warn("Prediction settlement temporarily unavailable.");}finally{busy=false;}};
 workers.__polymarketWorker=setInterval(()=>{void run();},30_000);workers.__polymarketWorker.unref();void run();
}
