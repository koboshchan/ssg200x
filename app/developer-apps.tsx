"use client";
import {useCallback,useEffect,useState} from "react";
import {api,errMsg,when,SCOPE_INFO,SCOPE_ORDER,type AppView,type Cred,type Scope} from "./app-api-client";
import AppDeleteConfirmation from "./app-delete-confirmation";
import ErrorNote from "./error-note";
type Detail={app:AppView;credentials:Cred[];linked_user_count:number};
const STATUS:Record<string,string>={approved:"Active",suspended:"Suspended",deleted:"Deleted"};
function Secret({secret,onClose}:{secret:string;onClose:()=>void}){
 const [copied,setCopied]=useState(false);
 return <div className="app-secret" role="alert"><strong>Copy this secret now. It will never be shown again.</strong><code>{secret}</code><div className="app-actions"><button onClick={async()=>{try{await navigator.clipboard.writeText(secret);setCopied(true);}catch{}}}>{copied?"Copied":"Copy"}</button><button className="primary" onClick={onClose}>I saved it</button></div></div>;
}
function AppCard({id,onError,onGone}:{id:string;onError:(m:string)=>void;onGone:()=>void}){
 const [d,setD]=useState<Detail|null>(null),[secret,setSecret]=useState<string|null>(null),[busy,setBusy]=useState(false),[askDelete,setAskDelete]=useState(false);
 const load=useCallback(async()=>{try{setD(await api<Detail>("/api/developer/apps/"+encodeURIComponent(id)));}catch(e){onError(errMsg(e));}},[id,onError]);
 useEffect(()=>{void load();},[load]);
 if(!d)return <li className="app-card"><p role="status">Loading…</p></li>;
 const a=d.app,live=d.credentials.filter(c=>!c.revoked_at&&new Date(c.expires_at).getTime()>Date.now());
 async function run(fn:()=>Promise<void>){if(busy)return;setBusy(true);try{await fn();await load();}catch(e){onError(errMsg(e));}finally{setBusy(false);}}
 const base="/api/developer/apps/"+encodeURIComponent(id);
 return <li className="app-card"><div className="app-card-head"><div><strong>{a.name}</strong><small className="app-url">{a.website}</small></div><span className={"app-status app-"+a.status}>{STATUS[a.status]??a.status}</span></div>
  <p>{a.description}</p>
  <p className="app-usage">Client ID <code>{a.client_id}</code>. {d.linked_user_count} linked {d.linked_user_count===1?"user":"users"}.{a.status==="approved"?" Spend cap "+(a.limits.per_operation_cents/100)+" per purchase.":""}</p>
  <div className="app-actions"><button disabled={busy} onClick={()=>run(async()=>{const j=await api<{secret:string}>(base+"/credentials",{method:"POST",body:{}});setSecret(j.secret);})}>New credential</button></div>
  {a.status==="suspended"?<small>An admin suspended this app. It cannot link or spend until reactivated.</small>:null}
  {secret?<Secret secret={secret} onClose={()=>setSecret(null)}/>:null}
  <ul className="app-creds" aria-label="Credentials">{d.credentials.map(c=><li key={c.credential_id}><code>{c.prefix}…</code><small>{c.revoked_at?"Revoked":"Expires "+when(c.expires_at)}</small>{!c.revoked_at?<><button disabled={busy||live.length>=5} onClick={()=>run(async()=>{const j=await api<{secret:string}>(base+"/credentials",{method:"POST",body:{overlap_credential_id:c.credential_id,overlap_seconds:3600}});setSecret(j.secret);})}>Rotate</button><button className="admin-remove" disabled={busy} onClick={()=>run(async()=>{await api(base+"/credentials/"+encodeURIComponent(c.credential_id),{method:"DELETE",body:{}});})}>Revoke</button></>:null}</li>)}</ul>
  {live.length>=5?<small>Five live credentials is the maximum. Revoke one first.</small>:null}
  <small>Rotate keeps the old credential working for one hour so you can switch over.</small>
  {a.status!=="deleted"?<div className="app-actions"><button className="admin-remove" disabled={busy||askDelete} onClick={()=>setAskDelete(true)}>Delete app</button></div>:null}
  {askDelete?<AppDeleteConfirmation name={a.name} busy={busy} onCancel={()=>setAskDelete(false)} onDelete={()=>void run(async()=>{await api(base,{method:"PATCH",body:{status:"deleted"}});onGone();})}/>:null}
 </li>;
}
export default function DeveloperApps(){
 const [canCreate,setCanCreate]=useState(false);
 const [ids,setIds]=useState<string[]|null>(null),[error,setError]=useState(""),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[f,setF]=useState({name:"",description:"",website:"https://"}),[scopes,setScopes]=useState<Scope[]>(["profile","balance:read","balance:debit"]),[mint,setMint]=useState(false);
 const load=useCallback(async()=>{try{const data=await api<{items:AppView[];can_create?:boolean}>("/api/developer/apps");setCanCreate(data.can_create===true);setIds(data.items.filter(a=>a.status!=="deleted").map(a=>a.app_id));}catch(e){setCanCreate(false);setError(errMsg(e,"Could not load your apps."));setIds([]);}},[]);
 useEffect(()=>{void load();},[load]);
 async function create(e:React.FormEvent){e.preventDefault();if(busy||!canCreate)return;setBusy(true);setError("");
  try{await api("/api/developer/apps",{method:"POST",body:{...f,approved_scopes:scopes,...(mint?{credit_mode:"mint",mint_limits:{per_operation_cents:100000,daily_cents:500000,lifetime_cents:5000000}}:{})}});setMint(false);setF({name:"",description:"",website:"https://"});setOpen(false);await load();}catch(err){setError(errMsg(err));}finally{setBusy(false);}}
 return <fieldset className="settings-group"><legend>Your apps (developer)</legend>
  <p className="app-note">Only admins can register apps. Existing app owners can still manage their apps here. New apps are active right away; players still approve each link themselves.</p>
  {ids===null?<p role="status">Loading…</p>:<ul className="app-list">{ids.map(id=><AppCard key={id} id={id} onError={setError} onGone={()=>void load()}/>)}</ul>}
  {canCreate?(open?<form className="app-form" onSubmit={create}>
   <label><span>Name</span><input disabled={busy} required minLength={2} maxLength={64} value={f.name} onChange={e=>setF({...f,name:e.target.value})}/></label>
   <label><span>What it does</span><input disabled={busy} maxLength={160} value={f.description} onChange={e=>setF({...f,description:e.target.value})}/></label>
   <label><span>Website (https)</span><input disabled={busy} required type="url" maxLength={300} inputMode="url" value={f.website} onChange={e=>setF({...f,website:e.target.value})}/></label>
   <fieldset className="settings-group" disabled={busy}><legend>Permissions</legend>{SCOPE_ORDER.map(s=><label key={s} className="settings-row"><input type="checkbox" checked={scopes.includes(s)} onChange={e=>{setScopes(c=>SCOPE_ORDER.filter(x=>x===s?e.target.checked:c.includes(x)));if(s==="balance:credit"&&!e.target.checked)setMint(false);}}/><span><strong>{SCOPE_INFO[s].label}</strong></span></label>)}
    <label className="settings-row"><input type="checkbox" checked={mint} disabled={!scopes.includes("balance:credit")} onChange={e=>setMint(e.target.checked)}/><span><strong>Can mint money</strong><small>Creates new money, within default caps. Needs the credit permission.</small></span></label></fieldset>
   <div className="app-actions"><button className="primary" type="submit" disabled={busy||scopes.length===0}>Create app</button><button type="button" disabled={busy} onClick={()=>setOpen(false)}>Cancel</button></div></form>
  :<button onClick={()=>setOpen(true)}>Register an app</button>):null}
  <ErrorNote message={error} onDismiss={()=>setError("")}/>
 </fieldset>;
}
