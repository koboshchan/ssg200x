"use client";
import {useCallback,useEffect,useState} from "react";
import {api,errMsg,SCOPE_INFO,SCOPE_ORDER,toCents,toDollars,when,type AppView,type Limits,type Scope} from "./app-api-client";
import LimitFields,{limitText,parseLimits,type LimitText} from "./limit-fields";
import "./app-api.css";
import ErrorNote from "./error-note";
const MAX:Limits={per_operation_cents:100_000_000,daily_cents:100_000_000,lifetime_cents:100_000_000};
function Review({a,onDone,onError}:{a:AppView;onDone:(a:AppView)=>void;onError:(m:string)=>void}){
 const [scopes,setScopes]=useState<Scope[]>(a.approved_scopes.length?a.approved_scopes:["profile","balance:read","balance:debit"]),[mode,setMode]=useState(a.credit_mode),[lim,setLim]=useState<LimitText>(limitText(a.limits)),[mint,setMint]=useState<LimitText>(limitText(a.mint_limits)),[daily,setDaily]=useState(toDollars(a.app_daily_cents)),[busy,setBusy]=useState(false);
 async function send(status:"approved"|"suspended"|"deleted"){
  const body:Record<string,unknown>={status};
  if(status==="approved"){
   const l=parseLimits(lim,MAX);if(!l.limits){onError(l.error!);return;}
   const d=toCents(daily);if(d===null||d>MAX.daily_cents){onError("App daily total must be dollars.");return;}
   body.approved_scopes=scopes;body.limits=l.limits;body.app_daily_cents=d;body.credit_mode=mode;
   if(mode==="mint"){const m=parseLimits(mint,MAX);if(!m.limits||Object.values(m.limits).some(v=>v<=0)){onError(m.error??"Mint caps must all be above zero.");return;}if(!scopes.includes("balance:credit")){onError("Minting needs the credit permission.");return;}body.mint_limits=m.limits;}
  }
  setBusy(true);
  try{onDone((await api<{app:AppView}>("/api/admin/apps/"+encodeURIComponent(a.app_id),{method:"PATCH",body})).app);}catch(e){onError(errMsg(e));}finally{setBusy(false);}
 }
 return <details className="app-card"><summary><strong>{a.name}</strong> <span className={"app-status app-"+a.status}>{a.status}</span></summary>
  <p className="app-url">{a.website}</p><p>{a.description}</p><small>Client <code>{a.client_id}</code>. Updated {when(a.updated_at)}.</small>
  <fieldset className="settings-group" disabled={busy}><legend>Allowed permissions</legend>{SCOPE_ORDER.map(s=><label key={s} className="settings-row"><input type="checkbox" checked={scopes.includes(s)} onChange={e=>setScopes(c=>SCOPE_ORDER.filter(x=>x===s?e.target.checked:c.includes(x)))}/><span><strong>{SCOPE_INFO[s].label}</strong></span></label>)}</fieldset>
  <LimitFields value={lim} max={MAX} onChange={setLim} disabled={busy} legend="Per-user debit ceiling"/>
  <label className="app-daily"><span>Whole app, per day ($)</span><input inputMode="decimal" value={daily} onChange={e=>setDaily(e.target.value)} disabled={busy}/></label>
  <fieldset className="settings-group" disabled={busy}><legend>Credits to users</legend>
   <label className="settings-row"><input type="radio" name={"m"+a.app_id} checked={mode==="refunds"} onChange={()=>setMode("refunds")}/><span><strong>Refunds only</strong><small>No new money is created.</small></span></label>
   <label className="settings-row"><input type="radio" name={"m"+a.app_id} checked={mode==="mint"} onChange={()=>setMode("mint")}/><span><strong>Can mint money</strong><small>Creates new money. Set positive caps below.</small></span></label>
  </fieldset>
  {mode==="mint"?<LimitFields value={mint} max={MAX} onChange={setMint} disabled={busy} legend="Mint caps"/>:null}
  <div className="app-actions"><button className="primary" disabled={busy||scopes.length===0} onClick={()=>send("approved")}>{a.status==="approved"?"Update approval":"Approve"}</button>{a.status!=="suspended"?<button disabled={busy} onClick={()=>send("suspended")}>Suspend</button>:null}<button className="admin-remove" disabled={busy} onClick={()=>{if(confirm("Reject and delete "+a.name+"?"))void send("deleted");}}>Reject / delete</button></div>
 </details>;
}
export default function AdminApps(){
 const [items,setItems]=useState<AppView[]|null>(null),[hidden,setHidden]=useState(false),[error,setError]=useState("");
 const load=useCallback(async()=>{try{setItems((await api<{items:AppView[]}>("/api/admin/apps")).items.filter(a=>a.status!=="deleted"));}catch(e){const s=(e as {status?:number}).status;if(s===403||s===404){setHidden(true);return;}setError(errMsg(e,"Could not load apps."));setItems([]);}},[]);
 useEffect(()=>{void load();},[load]);
 if(hidden)return null;
 const order={pending:0,approved:1,suspended:2,draft:3,deleted:4} as const;
 return <section className="admin-block" aria-labelledby="admin-apps-h"><h2 id="admin-apps-h">Third-party apps</h2>
  {items===null?<p role="status">Loading…</p>:items.length===0?<p className="empty">No apps registered.</p>:<div className="app-list">{[...items].sort((x,y)=>order[x.status]-order[y.status]).map(a=><Review key={a.app_id+a.updated_at} a={a} onError={setError} onDone={n=>setItems(c=>(c??[]).map(x=>x.app_id===n.app_id?n:x))}/>)}</div>}
  <ErrorNote message={error} onDismiss={()=>setError("")}/>
 </section>;
}
