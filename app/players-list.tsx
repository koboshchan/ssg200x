"use client";
import {useEffect,useId,useMemo,useRef,useState} from "react";
import type {PublicRoom} from "@/lib/public";
import type {FingerprintPlayer} from "@/lib/device-fingerprints";
import styles from "./players-list.module.css";

type AdminUser=PublicRoom["adminUsers"][number];
type Post=(path:string,body:object)=>Promise<void>;
type Report={id:string;publicId:string|null;at:number;draw:unknown};
type Draw={action?:string;round?:number;amount?:number};
const money=(n:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:n%100===0?0:2}).format(n/100);
const signed=(n:number)=>(n>=0?"+":"−")+money(Math.abs(n));
const usd=(n:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:n/1e6<1?6:2}).format(n/1e6);
const EMPTY_ALTS:FingerprintPlayer["possibleAlts"]=[];
const EMPTY_REPORTS:Report[]=[];

async function read<T>(url:string,signal:AbortSignal):Promise<T>{
 const response=await fetch(url,{cache:"no-store",signal});
 if(!response.ok)throw new Error("Player reports unavailable. Try refreshing.");
 return response.json();
}
/** Real persisted blackjack audit records only. Tab rejections are not stored by the current server. */
export function groupPlayerReports(events:Report[]){
 const grouped=new Map<string,Report[]>(),seen=new Set<string>();
 for(const event of events){
  if(!event.publicId||seen.has(event.id))continue;
  seen.add(event.id);
  const reports=grouped.get(event.publicId)||[];
  reports.push(event);grouped.set(event.publicId,reports);
 }
 return grouped;
}
export function visiblePlayers(users:AdminUser[],search:string,sort:string){
 const [field,direction]=sort.split("-"),key=field==="worth"?"netWorth":"wallet",sign=direction==="asc"?1:-1;
 const term=search.trim().toLocaleLowerCase();
 return users.filter(u=>u.name.toLocaleLowerCase().includes(term))
  .sort((a,b)=>(a[key]-b[key])*sign||a.name.localeCompare(b.name)||a.publicId.localeCompare(b.publicId));
}
export default function PlayersList({users,busy,post,onRefresh}:{users:AdminUser[];busy:boolean;post:Post;onRefresh:(signal:AbortSignal)=>Promise<void>}){
 const [search,setSearch]=useState(""),[sort,setSort]=useState("wallet-desc");
 const [fingerprints,setFingerprints]=useState<FingerprintPlayer[]>([]),[events,setEvents]=useState<Report[]>([]);
 const [loading,setLoading]=useState(true),[error,setError]=useState(""),[updated,setUpdated]=useState<number|null>(null),[refresh,setRefresh]=useState(0);
 const [selected,setSelected]=useState<{publicId:string;kind:"alts"|"reports"}|null>(null);
 const dialog=useRef<HTMLDialogElement>(null),titleId=useId();
 const refreshRoom=useRef(onRefresh);refreshRoom.current=onRefresh;
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setError("");
  Promise.all([
   read<{players:FingerprintPlayer[]}>("/api/admin/possible-alts",controller.signal),
   read<{events:Report[]}>("/api/admin/blackjack-audit",controller.signal),
   refresh>0?refreshRoom.current(controller.signal):Promise.resolve()
  ]).then(([alts,audit])=>{if(!controller.signal.aborted){setFingerprints(alts.players);setEvents(audit.events);setUpdated(Date.now());}})
   .catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:"Player reports unavailable.");})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return ()=>controller.abort();
 },[refresh]);
 const byPlayer=useMemo(()=>new Map(fingerprints.map(p=>[p.publicId,p])),[fingerprints]);
 const reportsByPlayer=useMemo(()=>groupPlayerReports(events),[events]);
 const rows=useMemo(()=>visiblePlayers(users,search,sort),[users,search,sort]);
 useEffect(()=>{
  if(selected){dialog.current?.showModal();return ()=>dialog.current?.close();}
 },[selected]);
 const selectedUser=selected?users.find(u=>u.publicId===selected.publicId):null;
 function visitPlayer(publicId:string){
  dialog.current?.close();setSelected(null);setSearch("");
  requestAnimationFrame(()=>document.getElementById("player-"+publicId)?.focus());
 }
 return <section className={styles.players} aria-labelledby="players-list-title">
  <h2 id="players-list-title">Players</h2>
  <div className={styles.tools}>
   <label>Search players<input type="search" placeholder="Search username" autoComplete="off" value={search} onChange={e=>setSearch(e.target.value)}/></label>
   <label>Sort by<select value={sort} onChange={e=>setSort(e.target.value)}>
    <option value="wallet-desc">Balance · high to low</option><option value="wallet-asc">Balance · low to high</option>
    <option value="worth-desc">Net worth · high to low</option><option value="worth-asc">Net worth · low to high</option>
   </select></label>
   <div className={styles.refresh}><small role="status">{loading?"Updating reports…":updated?<>Reports updated <time dateTime={new Date(updated).toISOString()}>{new Date(updated).toLocaleTimeString()}</time></>:"Reports not loaded"}</small><button disabled={loading} onClick={()=>setRefresh(n=>n+1)}>Refresh</button></div>
  </div>
  <p className={styles.note}>{rows.length} of {users.length} players · Balances update live.</p>
  {error?<p className={styles.error} role="alert">{error} {updated?"Previous reports are still shown.":""}</p>:null}
  {rows.length?rows.map(user=><PlayerRow key={user.publicId} user={user} busy={busy} post={post}
   alts={byPlayer.get(user.publicId)?.possibleAlts||EMPTY_ALTS} reports={reportsByPlayer.get(user.publicId)||EMPTY_REPORTS}
   onOpen={kind=>setSelected({publicId:user.publicId,kind})}/>):<p className="empty">No players match your search.</p>}
  <dialog className={styles.dialog} ref={dialog} aria-labelledby={titleId} onClose={()=>setSelected(null)}>
   <h2 id={titleId}>{selectedUser?.name} · {selected?.kind==="alts"?"Possible alts":"Anti-bot reports"}</h2>
   {selected?.kind==="alts"?<>
    <p>Shared browser fingerprints are clues, not proof of ownership. Shared devices, collisions and spoofed reports are possible.</p>
    {(byPlayer.get(selected.publicId)?.possibleAlts||EMPTY_ALTS).map(alt=><div className={styles.report} key={alt.publicId}>
     <a href={"#player-"+alt.publicId} onClick={e=>{e.preventDefault();visitPlayer(alt.publicId);}}>{alt.name}</a>
     <small>First seen <time dateTime={alt.firstSeen}>{new Date(alt.firstSeen).toLocaleString()}</time></small>
     <small>Last seen <time dateTime={alt.lastSeen}>{new Date(alt.lastSeen).toLocaleString()}</time></small>
    </div>)}
   </>:<>
    <p>Recorded blackjack anti-bot events, from the latest 100 audit records across all players. Counts are recent events, not lifetime totals or proof of cheating. Tab and off-page rejections are not recorded.</p>
    {(selected?reportsByPlayer.get(selected.publicId)||EMPTY_REPORTS:EMPTY_REPORTS).map(event=>{
     const draw=(typeof event.draw==="object"&&event.draw!==null?event.draw:{}) as Draw;
     return <div className={styles.report} key={event.id}>
      <strong>{draw.action==="bet"?"Non-chip bet flagged":draw.action==="deal"?"Flagged starting hand dealt":draw.action==="draw"?"Flagged hit card drawn":"Blackjack anti-bot event"}</strong>
      <small><time dateTime={new Date(event.at).toISOString()}>{new Date(event.at).toLocaleString()}</time>{typeof draw.round==="number"?" · Round "+draw.round:""}{typeof draw.amount==="number"?" · Bet "+money(draw.amount):""}</small>
     </div>;
    })}
   </>}
   <div className={styles.modalActions}><button autoFocus onClick={()=>dialog.current?.close()}>Close</button></div>
  </dialog>
 </section>;
}
function PlayerRow({user:u,busy,post,alts,reports,onOpen}:{user:AdminUser;busy:boolean;post:Post;alts:FingerprintPlayer["possibleAlts"];reports:Report[];onOpen:(kind:"alts"|"reports")=>void}){
 const [editing,setEditing]=useState(false),[delta,setDelta]=useState(""),[confirm,setConfirm]=useState(false);
 const inputId=useId(),editorId=useId(),holdingsId=useId();
 const cents=Math.round(Number(delta)*100),valid=delta.trim()!==""&&Number.isFinite(cents)&&cents!==0&&Number.isSafeInteger(cents);
 const after=u.wallet+cents;
 async function submit(){await post("/api/admin",{type:"balance",publicId:u.publicId,delta:cents,requestId:crypto.randomUUID(),requestAt:Date.now()});setDelta("");setConfirm(false);setEditing(false);}
 return <article className={styles.player} id={"player-"+u.publicId} tabIndex={-1} aria-label={u.name}>
  <div className={styles.top}><div className={styles.identity}>
   <h3>{u.name}</h3><p className={styles.summary}>Wallet {money(u.wallet)} · Net worth {money(u.netWorth)}</p>
   <p className={styles.summary}>{u.holdings.length} holdings · {u.positions.length} positions{u.holdings.length?" · "+u.holdings.map(h=>h.symbol).join(", "):""}</p>
   {alts.length||reports.length?<div className={styles.badges}>
    {alts.length?<button aria-haspopup="dialog" onClick={()=>onOpen("alts")}>{alts.length} {alts.length===1?"alt":"alts"}</button>:null}
    {reports.length?<button aria-haspopup="dialog" onClick={()=>onOpen("reports")}>{reports.length} {reports.length===1?"report":"reports"}</button>:null}
   </div>:null}
  </div><div className={styles.balance}>{money(u.wallet)}<small>Balance</small></div></div>
  <div className={styles.bottom}>
   <details className={styles.holdings}><summary>Holdings &amp; position details<span className="sr-only"> for {u.name}</span></summary>
    <div className={styles.detail}>
     {u.holdings.length?<div className={styles.tableScroll}><table><caption className="sr-only">{u.name} spot holdings</caption><thead><tr><th scope="col">Asset</th><th scope="col">Quantity</th><th scope="col">Cost</th><th scope="col">Value</th></tr></thead><tbody>{u.holdings.map(h=><tr key={h.symbol}><th scope="row">{h.symbol}</th><td>{(h.units/1e8).toFixed(8)}</td><td>{money(h.cost)}</td><td>{money(h.value)}</td></tr>)}</tbody></table></div>:<p>No spot holdings.</p>}
     {u.positions.length?<div className={styles.tableScroll}><table id={holdingsId}><caption className="sr-only">{u.name} open positions</caption><thead><tr><th scope="col">Position</th><th scope="col">Margin</th><th scope="col">Entry</th><th scope="col">Liquidation</th><th scope="col">Equity</th><th scope="col">P/L</th></tr></thead><tbody>{u.positions.map(x=><tr key={x.id}><th scope="row">{x.symbol} {x.side} {x.leverage}x</th><td>{money(x.margin)}</td><td>{usd(x.entry)}</td><td>{usd(x.liquidation)}</td><td>{money(x.equity)}</td><td className={x.pnl>=0?"positive":"negative"}>{signed(x.pnl)}</td></tr>)}</tbody></table></div>:<p>No open positions.</p>}
    </div>
   </details>
   <button disabled={busy} aria-expanded={editing} aria-controls={editorId} onClick={()=>{setEditing(!editing);setConfirm(false);}}>Adjust balance<span className="sr-only"> for {u.name}</span></button>
  </div>
  {editing?<div className={styles.adjuster} id={editorId}><label htmlFor={inputId} className="sr-only">Balance change in dollars for {u.name}</label>
   <input autoFocus id={inputId} type="number" inputMode="decimal" step=".01" placeholder="+50 or -20" value={delta} onChange={e=>{setDelta(e.target.value);setConfirm(false);}}/>
   {confirm&&valid?<><p role="status">{cents>0?"Add ":"Remove "}{money(Math.abs(cents))}, new balance {money(after)}</p><button className="primary" disabled={busy||after<0||!Number.isSafeInteger(after)} onClick={submit}>Confirm</button><button disabled={busy} onClick={()=>setConfirm(false)}>Cancel</button></>:<button disabled={busy||!valid} onClick={()=>setConfirm(true)}>Review change</button>}
   <button disabled={busy} onClick={()=>{setEditing(false);setConfirm(false);setDelta("");}}>Close</button>
   {confirm&&valid&&after<0?<p className={styles.error}>Balance can't go below $0.</p>:null}
  </div>:null}
 </article>;
}
