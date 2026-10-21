import {db,readRoom} from "./db";
import {mutateStockPublication} from "./store";
import {marketSymbols} from "./symbol-registry";
import {applyMarketTick} from "./market-tick";
import {candleUpdate} from "./candles";
import {forexCadence,forexMarketOpen,parseForexRate,type ForexQuote,type ForexStatus} from "./forex-policy";
import {reserveForexBudget,type ForexBudget} from "./forex-budget";
import {quoteFresh} from "./price-policy";
const budgetId="twelvedata-global";
export async function reserveForexCredits(cost:number,now=Date.now(),cadenceMs?:number){
 const c=(await db()).collection<ForexBudget>("providerBudgets");
 await c.updateOne({_id:budgetId},{$setOnInsert:{revision:0,day:new Date(now).toISOString().slice(0,10),used:0,recent:[],nextPollAt:0}},{upsert:true}).catch(e=>{if(e.code!==11000)throw e;});
 for(let i=0;i<8;i++){const b=(await c.findOne({_id:budgetId}))!,next=reserveForexBudget(b,cost,now,cadenceMs);if(!next)return null;
 const saved=await c.replaceOne({_id:budgetId,revision:b.revision},next);if(saved.matchedCount)return next;
 }
 return null; // Uncertain reservations never authorize an outbound request.
}
export async function forexBudgetSnapshot(){return (await db()).collection<ForexBudget>("providerBudgets").findOne({_id:budgetId});}
/** Native rates are not USD marks. Only explicitly USD-quoted currencies fit this
 * app's base-unit spot holdings and USD-collateral perpetual accounting model. */
export async function pollForex(leader:()=>boolean,owner:string,request:typeof fetch=fetch){
 if(!leader())return;
 const r=await readRoom(),pairs=marketSymbols(r).forex,cadenceSeconds=forexCadence(r.forexCadenceSeconds),now=Date.now();
 const mode:ForexStatus["mode"]=process.env.NODE_ENV!=="production"&&process.env.FOREX_DEMO_MOCK==="1"?"mock":process.env.TWELVEDATA_API_KEY?"live":"unconfigured";
 const budget=await forexBudgetSnapshot();
 const status:ForexStatus={mode,marketOpen:forexMarketOpen(now),cadenceSeconds,dailyUsed:budget?.day===new Date(now).toISOString().slice(0,10)?budget.used:0,dailyLimit:800,nextPollAt:budget?.nextPollAt??0,message:mode==="mock"?"MOCK demo rates. Trading disabled. Twelve Data signup and API key required.":mode==="unconfigured"?"Twelve Data API key required. Trading disabled.":"Shared REST snapshots; executable for 10 seconds only. Non-USD pairs read-only; conversion unavailable."};
 if(mode!=="live"){
  const mock:Record<string,number>={"AUD/JPY":98.25,"CAD/USD":0.72,"CNY/USD":0.14,"EUR/USD":1.08,"USD/JPY":149.2,"GBP/USD":1.3};
  await mutateStockPublication(owner,room=>{if(!leader())throw new Error("Forex lease unavailable");room.forexStatus=status;room.forexQuotes=mode==="mock"?Object.fromEntries(pairs.filter(p=>mock[p]).map(p=>[p,{micro:Math.round(mock[p]*1e6),at:0,source:"mock" as const,quoteCurrency:p.slice(4)}])):{};for(const p of pairs)if(room.quotes)delete room.quotes[p];});
  return;
 }
 if(!status.marketOpen||!pairs.length||now<(budget?.nextPollAt??0)){await publishStatus(status,leader,owner);return;}
 // A round reserves every symbol before any request; max 8 active FX pairs.
 const reservation=await reserveForexCredits(pairs.length,now,cadenceSeconds*1000);
 if(!reservation){status.message="Shared provider budget paused. Cached rates are not executable after 10 seconds.";await publishStatus(status,leader,owner);return;}
 status.dailyUsed=reservation.used;status.nextPollAt=reservation.nextPollAt;
 const errors:Record<string,string>={},rates:Record<string,ForexQuote>={};
 await Promise.all(pairs.map(async symbol=>{
  // Crashes or lease loss consume reservations; never refund uncertain requests.
  if(!leader())return;
  try{
   const url=new URL("https://api.twelvedata.com/exchange_rate");url.searchParams.set("symbol",symbol);
   const response=await request(url,{headers:{Authorization:"apikey "+process.env.TWELVEDATA_API_KEY},cache:"no-store",signal:AbortSignal.timeout(5000),redirect:"error"});
   if(!response.ok){errors[symbol]=response.status===429?"Provider limit reached":response.status===400||response.status===404?"Pair unavailable at provider":"Provider unavailable";return;}
   const value=await response.json();
   const q=parseForexRate(value,symbol,Date.now());
   if(q)rates[symbol]=q;else errors[symbol]=value?.status==="error"?"Pair unavailable at provider (no substitution)":"Stale, future or invalid provider timestamp";
  }catch{errors[symbol]="Provider unavailable";}
 }));
 status.errors=errors;
 if(!leader())return;
 // Initialize indexes outside the publication transaction, as the stock worker does.
 await candleUpdate({});
 const snapshots:Record<string,{micro:number;at:number}>={};
 await mutateStockPublication(owner,room=>{
  if(!leader())throw new Error("Forex lease unavailable");
  room.forexStatus=status;room.forexQuotes??={};
  const quotes:Record<string,{micro:number;at:number}>={};
  for(const [symbol,q] of Object.entries(rates)){
   if(!marketSymbols(room).forex.includes(symbol)||!quoteFresh(q.at,Date.now())||!forexMarketOpen(Date.now()))continue;
   if((room.forexQuotes[symbol]?.at??-1)>q.at)continue;
   room.forexQuotes[symbol]=q;if(q.quoteCurrency==="USD")quotes[symbol]={micro:q.micro,at:q.at};
  }
  applyMarketTick(room,quotes);
  for(const k of Object.keys(snapshots))delete snapshots[k];Object.assign(snapshots,quotes);
 },session=>candleUpdate(snapshots,session));
}
async function publishStatus(status:ForexStatus,leader:()=>boolean,owner:string){await mutateStockPublication(owner,room=>{if(!leader())throw new Error("Forex lease unavailable");room.forexStatus=status;});}
