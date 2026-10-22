"use client";
import {getTabHeaders} from "@/lib/tab-identity";
import {useCallback,useEffect,useRef,useState} from "react";
import {FEATURE_DEFAULTS,FEATURE_LABELS,type FeatureKey} from "@/lib/feature-catalog";
import {refreshFeatures} from "./use-features";
type Flags=Record<FeatureKey,boolean>;
const keys=Object.keys(FEATURE_DEFAULTS) as FeatureKey[];
export default function FeatureSettings(){
 // saved = last server state; pending = only keys the admin edited and has not confirmed.
 const [saved,setSaved]=useState<Flags|null>(null),[pending,setPending]=useState<Partial<Flags>>({}),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const revision=useRef<number|undefined>(undefined);
 const load=useCallback(async()=>{
  try{const r=await fetch("/api/features",{cache:"no-store"});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"Could not load features.");
   const next={...FEATURE_DEFAULTS,...j.features} as Flags;setSaved(next);if(typeof j.revision==="number")revision.current=j.revision;
   // Drop staged edits that now equal the server value; keep the rest.
   setPending(p=>Object.fromEntries(Object.entries(p).filter(([k,v])=>v!==next[k as FeatureKey])));}
  catch(e){setError(e instanceof Error?e.message:"Could not load features.");}
 },[]);
 useEffect(()=>{void load();const t=setInterval(()=>{if(!busy)void load();},15_000);return()=>clearInterval(t);},[load,busy]);
 const changed=keys.filter(k=>saved&&k in pending&&pending[k]!==saved[k]);
 const value=(k:FeatureKey)=>k in pending?pending[k]!:(saved?.[k]??FEATURE_DEFAULTS[k]);
 function stage(k:FeatureKey,v:boolean){setError("");setPending(p=>{const n={...p};if(saved&&saved[k]===v)delete n[k];else n[k]=v;return n;});}
 async function apply(){
  if(!saved||busy||!changed.length)return;setBusy(true);setError("");
  const features=Object.fromEntries(changed.map(k=>[k,pending[k]!]));
  try{const r=await fetch("/api/admin/features",{method:"PUT",headers:{"content-type":"application/json",...getTabHeaders()},body:JSON.stringify({features,expectedRevision:revision.current})});
   const j=await r.json().catch(()=>({}));
   if(!r.ok){if(r.status===409){if(j.features)setSaved({...FEATURE_DEFAULTS,...j.features});if(typeof j.revision==="number")revision.current=j.revision;throw new Error(j.error||"Features were changed by someone else. Review your edits and apply again.");}throw new Error(j.error||"Could not save.");}
   setSaved({...FEATURE_DEFAULTS,...j.features});if(typeof j.revision==="number")revision.current=j.revision;setPending({});void refreshFeatures();
  }catch(e){setError(e instanceof Error?e.message:"Could not save.");}
  finally{setBusy(false);}
 }
 return <section className="settings-group admin-features" aria-labelledby="feature-flags-title"><h2 id="feature-flags-title">Features</h2><p className="fine">Turn sections off for everyone. Existing market positions and holdings remain visible. Closing requires fresh prices and may wait until this market is re-enabled. Changes apply only after you confirm below, and every player will be asked to refresh.</p>
  <fieldset className="settings-group" disabled={!saved||busy}>{keys.map(k=><label key={k} className="settings-row"><input type="checkbox" checked={value(k)} onChange={e=>stage(k,e.target.checked)}/><span><strong>{FEATURE_LABELS[k]}</strong><small>{value(k)?"On":"Temporarily disabled"}{k in pending?" (not applied yet)":""}</small></span></label>)}</fieldset>
  {error?<p role="alert">{error}</p>:null}
  <div className="settings-row" role="group" aria-label="Confirm feature changes" style={{position:"sticky",bottom:0,justifyContent:"space-between",gap:12,padding:"12px 0",background:"var(--surface)"}}>
   <span className="fine" aria-live="polite">{changed.length?`${changed.length} unapplied change${changed.length>1?"s":""}: ${changed.map(k=>`${FEATURE_LABELS[k]} ${pending[k]?"on":"off"}`).join(", ")}`:"No pending changes."}</span>
   <span><button type="button" disabled={!changed.length||busy} onClick={()=>{setPending({});setError("");}}>Discard</button> <button type="button" className="primary" disabled={!changed.length||busy} onClick={apply}>{busy?"Applying...":"Confirm and apply"}</button></span>
  </div>
 </section>;
}
