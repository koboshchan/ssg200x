import {netPnl,requireQuote,requireSpotQuote,requireLegacyQuote,value} from "./finance";
import {delistedSymbol} from "./symbol-registry";
import type {Member,Room} from "./types";

export const SNAPSHOT_INTERVAL=60_000;
export const BASELINE_TOLERANCE=120_000;
export const PERFORMANCE_RETENTION=32*24*60*60*1000;
export const PERFORMANCE_PERIODS=[["1h",3600_000],["24h",86400_000],["7d",7*86400_000],["30d",30*86400_000]] as const;
export type TradingMetric={pnl:number;capital:number};
export type TradingSnapshot={publicId:string;at:number;bucket:number;expiresAt:Date;pnl:number|null;capital:number|null;reason?:string};
export type PerformancePeriod={period:typeof PERFORMANCE_PERIODS[number][0];pnl:number|null;percent:number|null;reason?:string};
export type TradingPerformance={asOf:number;periods:PerformancePeriod[]};

/** Trading equity less trading cost, never wallet/net worth. Legacy realized spot
 * history is intentionally not reconstructed. Its additive offset cancels only
 * between actual prospective snapshots. No portfolio() call or room mutation. */
export function tradingMetric(room:Room,member:Member,now:number):TradingMetric {
 let pnl=member.realizedSpotPnl??0,capital=0;
 for(const closed of member.closedPositions??[])pnl+=closed.realizedPnl;
 for(const h of member.holdings??[]){
  const mark=delistedSymbol(h.symbol,room)?requireLegacyQuote(room,h.symbol,now).micro:requireSpotQuote(room,h.symbol,now);
  pnl+=value(h.units,mark)-h.cost;capital+=h.cost;
 }
 for(const p of member.positions??[]){
  const mark=delistedSymbol(p.symbol,room)?requireLegacyQuote(room,p.symbol,now).micro:requireQuote(room,p.symbol,now);
  pnl+=netPnl(p,mark);
  capital+=(p.postedMargin??p.margin)+(p.collateral===undefined?(p.openingFee??0):0);
 }
 if(!Number.isSafeInteger(pnl)||!Number.isSafeInteger(capital)||capital<0)throw new Error("Invalid trading valuation");
 return {pnl,capital};
}
export function tradingSnapshot(room:Room,member:Member,at:number):TradingSnapshot {
 const base={publicId:member.publicId,at,bucket:Math.floor(at/SNAPSHOT_INTERVAL),expiresAt:new Date(at+PERFORMANCE_RETENTION)};
 try{return {...base,...tradingMetric(room,member,at)};}
 catch{return {...base,pnl:null,capital:null,reason:"valuation_unavailable"};}
}

/** A period needs a real sample at/before its boundary within two minutes.
 * Missing/invalid marks or collection outages break continuity rather than
 * presenting an invented interpolation as measured performance. */
export function tradingPerformance(current:TradingSnapshot,history:TradingSnapshot[]):TradingPerformance{
 const rows=history.filter(s=>s.publicId===current.publicId&&Number.isSafeInteger(s.at)&&s.at<=current.at).sort((a,b)=>a.at-b.at);
 const unavailable=(period:PerformancePeriod["period"],reason:string):PerformancePeriod=>({period,pnl:null,percent:null,reason});
 return {asOf:current.at,periods:PERFORMANCE_PERIODS.map(([period,duration])=>{
  if(current.pnl===null||current.capital===null)return unavailable(period,"valuation_unavailable");
  const target=current.at-duration;
  let index=-1;
  for(let i=0;i<rows.length&&rows[i].at<=target;i++)index=i;
  if(index<0||target-rows[index].at>BASELINE_TOLERANCE)return unavailable(period,"baseline_unavailable");
  const baseline=rows[index];
  let previous=baseline.at;
  for(let i=index;i<rows.length;i++){
   const row=rows[i];
   if(row.pnl===null||row.capital===null)return unavailable(period,"valuation_unavailable");
   if(row.at-previous>BASELINE_TOLERANCE)return unavailable(period,"snapshot_gap");
   previous=row.at;
  }
  if(current.at-previous>BASELINE_TOLERANCE)return unavailable(period,"snapshot_gap");
  const pnl=current.pnl-baseline.pnl!;
  if(!Number.isSafeInteger(pnl))return unavailable(period,"valuation_unavailable");
  return {period,pnl,percent:baseline.capital!>0?pnl/baseline.capital!*100:null,...(baseline.capital===0?{reason:"zero_baseline_capital"}:{})};
 })};
}
