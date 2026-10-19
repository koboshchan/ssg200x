"use client";
import {useLive} from "./live-provider";
const eta=(seconds:number|null)=>seconds===null?"Estimating remaining time":seconds===0?"Complete":"About "+Math.max(1,Math.ceil(seconds/60))+" min remaining";
export default function HistoryProgress(){
 const {history:p,connection}=useLive(),error=connection==='disconnected'?"Disconnected. Progress is paused.":"";
 return <section className="history-progress"><h2>Price history</h2>{p?<><p role="status">{p.status==="blocked"?p.reason:p.status==="complete"?"Backfill complete":p.status==="initializing"?"Preparing historical prices":p.overall.percent+"% complete"} · {eta(p.overall.etaSeconds)}</p><progress aria-label="Overall backfill" value={p.overall.percent} max={100}/><p className="history-source">{p.source}</p><details><summary>All symbols</summary>{p.symbols.map(s=><div key={s.symbol} className="history-symbol"><div><strong>{s.symbol}</strong><span>{s.monthsDone} / {s.monthsTotal} months · {s.daysDone} / {s.daysTotal} days</span></div><progress aria-label={s.symbol+" backfill"} value={s.percent} max={100}/><small>{s.currentSource} · {eta(s.etaSeconds)}{s.unavailable?" · Some archives unavailable":""}</small></div>)}</details></>:<p>{error||"Waiting for live progress"}</p>}{error&&p?<p role="status">{error}</p>:null}</section>;
}
