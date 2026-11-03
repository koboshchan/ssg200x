"use client";
import {useCallback,useEffect,useState} from "react";
import {api,errMsg,when,type AppView,type Cred} from "./app-api-client";
import ErrorNote from "./error-note";
type Detail={app:AppView;credentials:Cred[];linked_user_count:number};
const STATUS:Record<string,string>={draft:"Draft",pending:"Waiting for review",approved:"Approved",suspended:"Suspended",deleted:"Deleted"};
function Secret({secret,onClose}:{secret:string;onClose:()=>void}){
 const [copied,setCopied]=useState(false);
 return <div className="app-secret" role="alert"><strong>Copy this secret now. It will never be shown again.</strong><code>{secret}</code><div className="app-actions"><button onClick={async()=>{try{await navigator.clipboard.writeText(secret);setCopied(true);}catch{}}}>{copied?"Copied":"Copy"}</button><button className="primary" onClick={onClose}>I saved it</button></div></div>;
}
function AppCard({id,onError,onGone}:{id:string;onError:(m:string)=>void;onGone:()=>void}){
 const [d,setD]=useState<Detail|null>(null),[secret,setSecret]=useState<string|null>(null),[busy,setBusy]=useState(false);
 const load=useCallback(async()=>{try{setD(await api<Detail>("/api/developer/apps/"+encodeURIComponent(id)));}catch(e){onError(errMsg(e));}},[id,onError]);
 useEffect(()=>{void load();},[load]);
 if(!d)return <li className="app-card"><p role="status">Loading…</p></li>;
 const a=d.app,live=d.credentials.filter(c=>!c.revoked_at&&new Date(c.expires_at).getTime()>Date.now());
 async function run(fn:()=>Promise<void>){setBusy(true);try{await fn();await load();}catch(e){onError(errMsg(e));}finally{setBusy(false);}}
 const base="/api/developer/apps/"+encodeURIComponent(id);
 return <li className="app-card"><div className="app-card-head"><div><strong>{a.name}</strong><small className="app-url">{a.website}</small></div><span className={"app-status app-"+a.status}>{STATUS[a.status]??a.status}</span></div>
  <p>{a.description}</p>
  <p className="app-usage">Client ID <code>{a.client_id}</code>. {d.linked_user_count} linked {d.linked_user_count===1?"user":"users"}.{a.status==="approved"?" Spend cap "+(a.limits.per_operation_cents/100)+" per purchase.":""}</p>
  <div className="app-actions">{a.status==="draft"?<button className="primary" disabled={busy} onClick={()=>run(async()=>{await api(base,{method:"PATCH",body:{status:"pending"}});})}>Submit for review</button>:null}<button disabled={busy} onClick={()=>run(async()=>{const j=await api<{secret:string}>(base+"/credentials",{method:"POST",body:{}});setSecret(j.secret);})}>New credential</button></div>
  {a.status==="draft"||a.status==="pending"?<small>Edits to name, description or website send the app back to review.</small>:null}
  {secret?<Secret secret={secret} onClose={()=>setSecret(null)}/>:null}
  <ul className="app-creds" aria-label="Credentials">{d.credentials.map(c=><li key={c.credential_id}><code>{c.prefix}…</code><small>{c.revoked_at?"Revoked":"Expires "+when(c.expires_at)}</small>{!c.revoked_at?<><button disabled={busy||live.length>=5} onClick={()=>run(async()=>{const j=await api<{secret:string}>(base+"/credentials",{method:"POST",body:{overlap_credential_id:c.credential_id,overlap_seconds:3600}});setSecret(j.secret);})}>Rotate</button><button className="admin-remove" disabled={busy} onClick={()=>run(async()=>{await api(base+"/credentials/"+encodeURIComponent(c.credential_id),{method:"DELETE",body:{}});})}>Revoke</button></>:null}</li>)}</ul>
  {live.length>=5?<small>Five live credentials is the maximum. Revoke one first.</small>:null}
  <small>Rotate keeps the old credential working for one hour so you can switch over.</small>
  {a.status!=="deleted"?<div className="app-actions"><button className="admin-remove" disabled={busy} onClick={()=>{if(confirm("Delete "+a.name+"? Linked users are disconnected."))void run(async()=>{await api(base,{method:"PATCH",body:{status:"deleted"}});onGone();});}}>Delete app</button></div>:null}
 </li>;
}
export default function DeveloperApps(){
 const [ids,setIds]=useState<string[]|null>(null),[error,setError]=useState(""),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[f,setF]=useState({name:"",description:"",website:"https://"});
 const load=useCallback(async()=>{try{setIds((await api<{items:AppView[]}>("/api/developer/apps")).items.filter(a=>a.status!=="deleted").map(a=>a.app_id));}catch(e){setError(errMsg(e,"Could not load your apps."));setIds([]);}},[]);
 useEffect(()=>{void load();},[load]);
 async function create(e:React.FormEvent){e.preventDefault();if(busy)return;setBusy(true);setError("");
  try{await api("/api/developer/apps",{method:"POST",body:f});setF({name:"",description:"",website:"https://"});setOpen(false);await load();}catch(err){setError(errMsg(err));}finally{setBusy(false);}}
 return <fieldset className="settings-group"><legend>Your apps (developer)</legend>
  <p className="app-note">Build something that charges or credits ssg200x play-money wallets. An admin reviews every app before anyone can link it.</p>
  {ids===null?<p role="status">Loading…</p>:<ul className="app-list">{ids.map(id=><AppCard key={id} id={id} onError={setError} onGone={()=>void load()}/>)}</ul>}
  {open?<form className="app-form" onSubmit={create}>
   <label><span>Name</span><input disabled={busy} required minLength={2} maxLength={64} value={f.name} onChange={e=>setF({...f,name:e.target.value})}/></label>
   <label><span>What it does</span><input disabled={busy} maxLength={160} value={f.description} onChange={e=>setF({...f,description:e.target.value})}/></label>
   <label><span>Website (https)</span><input disabled={busy} required type="url" maxLength={300} inputMode="url" value={f.website} onChange={e=>setF({...f,website:e.target.value})}/></label>
   <div className="app-actions"><button className="primary" type="submit" disabled={busy}>Create draft</button><button type="button" disabled={busy} onClick={()=>setOpen(false)}>Cancel</button></div></form>
  :<button onClick={()=>setOpen(true)}>Register an app</button>}
  <ErrorNote message={error} onDismiss={()=>setError("")}/>
 </fieldset>;
}
