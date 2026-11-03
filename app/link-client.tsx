"use client";
import {useState} from "react";
import Link from "next/link";
import {api,errMsg,SCOPE_INFO,SCOPE_ORDER,when,type Limits,type Scope} from "./app-api-client";
import LimitFields,{limitText,parseLimits,type LimitText} from "./limit-fields";
import ErrorNote from "./error-note";
type Preview={confirmation_token:string;app:{app_id:string;name:string;description:string;website:string;status:string};external_subject:string;requested_scopes:Scope[];limits:Limits;expires_at:string};
type Stage="enter"|"review"|"done"|"denied";
const spend=(s:Scope[])=>s.includes("balance:debit");
export default function LinkClient(){
 const [code,setCode]=useState(""),[stage,setStage]=useState<Stage>("enter"),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [pv,setPv]=useState<Preview|null>(null),[scopes,setScopes]=useState<Scope[]>([]),[lim,setLim]=useState<LimitText|null>(null),[ack,setAck]=useState(false);
 const words=code.trim().toLowerCase().split(/\s+/).filter(Boolean);
 async function find(e:React.FormEvent){
  e.preventDefault();if(busy||words.length!==4)return;setBusy(true);setError("");
  try{const p=await api<Preview>("/api/app-links/preview",{method:"POST",body:{user_code:words.join(" ")}});
   setPv(p);setScopes(SCOPE_ORDER.filter(s=>p.requested_scopes.includes(s)&&s!=="balance:debit"&&s!=="balance:credit"));setLim(limitText(p.limits));setAck(false);setStage("review");setCode("");}
  catch(err){setError(errMsg(err,"That code did not work. Check the four words."));}
  finally{setBusy(false);}
 }
 function toggle(s:Scope,on:boolean){setScopes(cur=>SCOPE_ORDER.filter(x=>x===s?on:cur.includes(x)));}
 async function authorize(){
  if(!pv||!lim||busy)return;setError("");
  let limits:Limits={per_operation_cents:0,daily_cents:0,lifetime_cents:0};
  if(spend(scopes)){const r=parseLimits(lim,pv.limits);if(!r.limits){setError(r.error!);return;}limits=r.limits;}
  setBusy(true);
  try{await api("/api/app-links/authorize",{method:"POST",body:{confirmation_token:pv.confirmation_token,scopes:scopes,limits}});setStage("done");setPv(null);}
  catch(err){setError(errMsg(err));}finally{setBusy(false);}
 }
 function deny(){setPv(null);setLim(null);setScopes([]);setError("");setStage("denied");}
 return <main className="game-main settings app-link"><p className="eyebrow">CONNECT AN APP</p><h1>Link an app</h1>
  {stage==="enter"?<form onSubmit={find}>
   <p>An app showed you four words. Type them here to see what it is asking for. Nothing is shared until you approve.</p>
   <label className="app-code"><span>Four-word code</span><input autoFocus autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={code} onChange={e=>setCode(e.target.value)} placeholder="word word word word" aria-describedby="code-help"/></label>
   <small id="code-help">Codes expire after 10 minutes. Only enter a code you just requested yourself.</small>
   <button className="primary" type="submit" disabled={busy||words.length!==4}>{busy?"Checking…":"Continue"}</button>
  </form>:null}
  {stage==="review"&&pv&&lim?<section aria-labelledby="review-h" className="app-review">
   <h2 id="review-h">{pv.app.name} wants to connect</h2>
   <div className="app-warning" role="note"><strong>Check who is asking.</strong><p>Only approve if you started this on that app yourself. Nobody from ssg200x will ever ask you for this code. Anyone who has your code could try to connect to your wallet.</p></div>
   <dl className="app-facts"><div><dt>App</dt><dd>{pv.app.name}</dd></div>{pv.app.description?<div><dt>About</dt><dd>{pv.app.description}</dd></div>:null}<div><dt>Website</dt><dd className="app-url">{pv.app.website}</dd></div><div><dt>Account on that app</dt><dd><span className="app-ext">{pv.external_subject}</span><small>Typed by the app and not verified by ssg200x. It may not be who you think it is.</small></dd></div><div><dt>Code expires</dt><dd>{when(pv.expires_at)}</dd></div></dl>
   <fieldset className="settings-group"><legend>Allow each of these, or none</legend>
    {SCOPE_ORDER.filter(s=>pv.requested_scopes.includes(s)).map(s=><label key={s} className="settings-row"><input type="checkbox" checked={scopes.includes(s)} onChange={e=>toggle(s,e.target.checked)}/><span><strong>{SCOPE_INFO[s].label}</strong><small>{SCOPE_INFO[s].hint}{s==="balance:credit"?" Refunds, or rewards if an admin allowed them for this app.":""}</small></span></label>)}
   </fieldset>
   {spend(scopes)?<LimitFields value={lim} max={pv.limits} onChange={setLim} disabled={busy}/>:null}
   {spend(scopes)?<label className="settings-row"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/><span><strong>I understand this app can spend my money</strong><small>Up to the limits above. I can reduce or revoke this any time in Settings.</small></span></label>:null}
   <div className="app-actions"><button className="primary" disabled={busy||scopes.length===0||(spend(scopes)&&!ack)} onClick={authorize}>{busy?"Working…":"Approve selected"}</button><button disabled={busy} onClick={deny}>Deny</button></div>
   <small>Approval lasts 90 days. You can only lower limits later; raising them needs a new approval.</small>
  </section>:null}
  {stage==="done"?<div role="status" className="app-done"><h2>Connected</h2><p>You can go back to the app now. Manage or revoke it any time in <Link href="/settings">Settings</Link>.</p></div>:null}
  {stage==="denied"?<div role="status" className="app-done"><h2>Denied</h2><p>Nothing was shared. The code will expire on its own.</p><button onClick={()=>setStage("enter")}>Enter another code</button></div>:null}
  <ErrorNote message={error} onDismiss={()=>setError("")}/>
 </main>;
}
