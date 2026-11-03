"use client";
import {useCallback,useEffect,useState} from "react";
import {api,errMsg,money,when,SCOPE_INFO,SCOPE_ORDER,type Grant,type Scope} from "./app-api-client";
import LimitFields,{limitText,parseLimits,type LimitText} from "./limit-fields";
import ErrorNote from "./error-note";
function GrantCard({g,onChange,onError}:{g:Grant;onChange:(g:Grant|null)=>void;onError:(m:string)=>void}){
 const [edit,setEdit]=useState(false),[lim,setLim]=useState<LimitText>(limitText(g.limits)),[scopes,setScopes]=useState<Scope[]>(g.scopes),[busy,setBusy]=useState(false),[ask,setAsk]=useState(false);
 const expired=new Date(g.expires_at).getTime()<Date.now();
 async function save(){
  if(busy)return;
  const r=parseLimits(lim,g.limits);if(!r.limits){onError(r.error!);return;}
  if(scopes.length===0){onError("Keep at least one permission, or disconnect the app.");return;}
  setBusy(true);
  try{const j=await api<{grant:Grant}>("/api/app-links/"+encodeURIComponent(g.grant_id),{method:"PATCH",body:{limits:r.limits,scopes}});setLim(limitText(j.grant.limits));setScopes([...j.grant.scopes]);onChange(j.grant);setEdit(false);}
  catch(e){onError(errMsg(e));}finally{setBusy(false);}
 }
 async function revoke(){
  if(busy)return;
  setBusy(true);
  try{await api("/api/app-links/"+encodeURIComponent(g.grant_id),{method:"DELETE",body:{}});onChange(null);}
  catch(e){onError(errMsg(e));setBusy(false);}
 }
 const spends=g.scopes.includes("balance:debit"), monetary=spends||g.scopes.includes("balance:credit");
 return <li className="app-card"><div className="app-card-head"><div><strong>{g.app_name}</strong><small>Their name for you: <span className="app-ext">{g.external_subject}</span></small></div><small>{expired?"Expired":"Until "+when(g.expires_at)}</small></div>
  <ul className="app-chips" aria-label="Permissions">{g.scopes.map(s=><li key={s}>{SCOPE_INFO[s].label}</li>)}</ul>
  {spends?<p className="app-usage">Play money spent today {money(g.todays_debit_cents)} of {money(g.limits.daily_cents)}. Per purchase up to {money(g.limits.per_operation_cents)}, total up to {money(g.limits.lifetime_cents)}.</p>:null}
  {!spends&&monetary?<p className="app-usage">Play-money reward limits, if this app can mint: {money(g.limits.per_operation_cents)} per operation, {money(g.limits.daily_cents)} per day, {money(g.limits.lifetime_cents)} total. Refunds are tied to earlier charges.</p>:null}
  {edit?<div className="app-edit"><fieldset className="settings-group" disabled={busy}><legend>Keep these permissions</legend>{SCOPE_ORDER.filter(s=>g.scopes.includes(s)).map(s=><label key={s} className="settings-row"><input type="checkbox" checked={scopes.includes(s)} onChange={e=>setScopes(c=>SCOPE_ORDER.filter(x=>x===s?e.target.checked:c.includes(x)))}/><span><strong>{SCOPE_INFO[s].label}</strong></span></label>)}</fieldset>
   {monetary?<LimitFields value={lim} max={g.limits} onChange={setLim} disabled={busy} legend="Lower play-money debit / reward limits"/>:null}
   <small>These caps apply separately to charges and minted rewards. Refunds of earlier charges are separate. You can only lower things here; to allow more, disconnect and approve again.</small>
   <div className="app-actions"><button className="primary" disabled={busy} onClick={save}>Save</button><button disabled={busy} onClick={()=>{setEdit(false);setLim(limitText(g.limits));setScopes(g.scopes);}}>Cancel</button></div></div>
  :<div className="app-actions">{!expired?<button disabled={busy} onClick={()=>{setLim(limitText(g.limits));setScopes([...g.scopes]);setEdit(true);}}>Reduce</button>:null}{ask?<><span role="status" className="adjust-note">Disconnect {g.app_name}? Future charges and rewards stop. Refunds of earlier charges may still arrive within 90 days.</span><button className="primary" disabled={busy} onClick={revoke}>Disconnect</button><button disabled={busy} onClick={()=>setAsk(false)}>Keep</button></>:<button disabled={busy} className="admin-remove" onClick={()=>setAsk(true)}>Disconnect</button>}</div>}
  <details className="app-history"><summary>Recent activity ({g.transactions.length})</summary>{g.transactions.length?<ul>{g.transactions.map(t=><li key={t.transaction_id}><span>{t.direction==="debit"?"−":"+"}{money(t.amount_cents)}{t.credit_reason?" "+t.credit_reason:""}</span><span>{t.description}</span><small>{when(t.created_at)}</small></li>)}</ul>:<p className="empty">Nothing yet.</p>}</details>
 </li>;
}
export default function ConnectedApps(){
 const [items,setItems]=useState<Grant[]|null>(null),[error,setError]=useState("");
 const load=useCallback(async()=>{try{setItems((await api<{items:Grant[]}>("/api/app-links")).items.filter(g=>!g.revoked_at));}catch(e){setError(errMsg(e,"Could not load connected apps."));setItems([]);}},[]);
 useEffect(()=>{void load();},[load]);
 return <fieldset className="settings-group"><legend>Connected apps</legend>
  {items===null?<p role="status">Loading…</p>:items.length===0?<p className="empty">No apps connected. When an app gives you four words, enter them at <a href="/link">/link</a>.</p>:<ul className="app-list">{items.map(g=><GrantCard key={g.grant_id} g={g} onError={setError} onChange={n=>setItems(cur=>(cur??[]).flatMap(x=>x.grant_id!==g.grant_id?[x]:n?[n]:[]))}/>)}</ul>}
  <ErrorNote message={error} onDismiss={()=>setError("")}/>
 </fieldset>;
}
