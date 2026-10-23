"use client";
import {useEffect,useState} from "react";
const periods=["1h","24h","7d","30d"] as const;
type Period=typeof periods[number];
type Result={asOf:number;periods:{period:Period;pnl:number|null;percent:number|null;reason?:string}[]};
const reasons:Record<string,string>={
 baseline_unavailable:"Not enough recorded history for this period.",
 valuation_unavailable:"A reliable trading valuation is unavailable for this period.",
 snapshot_gap:"Recording was interrupted during this period. A complete return is unavailable."
};
const money=(cents:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",signDisplay:"exceptZero"}).format(cents/100);
export default function Performance({publicId}:{publicId:string}){
 const [period,setPeriod]=useState<Period>("24h"),[result,setResult]=useState<Result|null>(null),[error,setError]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();setResult(null);setError(false);
  fetch("/api/leaderboard/"+encodeURIComponent(publicId)+"/performance",{cache:"no-store",signal:controller.signal}).then(async response=>{if(!response.ok)throw new Error();return response.json() as Promise<Result>;}).then(setResult).catch(()=>{if(!controller.signal.aborted)setError(true);});
  return()=>controller.abort();
 },[publicId,retry]);
 const selected=result?.periods.find(row=>row.period===period);
 return <section className="profile-performance" aria-label="Trading performance">
  <div className="profile-performance-head"><h2>Trading performance</h2><div className="profile-periods" role="group" aria-label="PnL period">{periods.map(value=><button key={value} type="button" aria-pressed={period===value} onClick={()=>setPeriod(value)}>{value}</button>)}</div></div>
  <div aria-live="polite" aria-atomic="true" className="profile-return">
   <span>Past {period} return</span>
   {error?<p>Performance unavailable. <button type="button" onClick={()=>setRetry(value=>value+1)}>Try again</button></p>:!result?<p role="status">Loading performance…</p>:selected?.pnl!=null?<><strong className={selected.pnl>=0?"positive":"negative"}>{money(selected.pnl)}</strong><span>{selected.percent==null?"Percentage unavailable · no starting trading capital":new Intl.NumberFormat("en-US",{maximumFractionDigits:2,signDisplay:"exceptZero"}).format(selected.percent)+"%"}</span></>:<><strong className="profile-return-unavailable">Not available yet</strong><span>{reasons[selected?.reason??""]||"Not enough recorded history for this period."}</span></>}
  </div>
  <p className="profile-performance-note">Realized and unrealized spot and perpetual PnL, net of trading fees. Deposits, transfers, airdrops, predictions and games are excluded. Percentages use trading capital at the start of the period, not wallet balance.</p>
  {result?<p className="profile-performance-note">As of <time dateTime={new Date(result.asOf).toISOString()}>{new Date(result.asOf).toLocaleString()}</time>. Returns use recorded snapshots; older history cannot be reconstructed.</p>:null}
 </section>;
}
