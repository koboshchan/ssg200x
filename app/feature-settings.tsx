"use client";
import {getTabHeaders} from "@/lib/tab-identity";
import {useCallback,useEffect,useState} from "react";
import {FEATURE_DEFAULTS,FEATURE_LABELS,type FeatureKey} from "@/lib/feature-catalog";
import {refreshFeatures} from "./use-features";
const keys=Object.keys(FEATURE_DEFAULTS) as FeatureKey[];
export default function FeatureSettings(){
 const [flags,setFlags]=useState<Record<FeatureKey,boolean>|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState<FeatureKey|null>(null);
 const load=useCallback(async()=>{
  try{const r=await fetch("/api/features",{cache:"no-store"});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"Could not load features.");setFlags({...FEATURE_DEFAULTS,...j.features});}
  catch(e){setError(e instanceof Error?e.message:"Could not load features.");}
 },[]);
 useEffect(()=>{void load();const t=setInterval(()=>{if(!busy)void load();},15_000);return()=>clearInterval(t);},[load,busy]);
 async function toggle(key:FeatureKey,value:boolean){
  if(!flags||busy)return;const prev=flags;setFlags({...flags,[key]:value});setBusy(key);setError("");
  try{const r=await fetch("/api/admin/features",{method:"PUT",headers:{"content-type":"application/json",...getTabHeaders()},body:JSON.stringify({features:{[key]:value}})});
   if(!r.ok)throw new Error((await r.json().catch(()=>({}))).error||"Could not save.");
   void refreshFeatures();
  }catch(e){setFlags(prev);setError(e instanceof Error?e.message:"Could not save.");}
  finally{setBusy(null);}
 }
 return <section className="settings-group admin-features" aria-labelledby="feature-flags-title"><h2 id="feature-flags-title">Features</h2><p className="fine">Turn sections off for everyone. Existing market positions and holdings remain visible. Closing requires fresh prices and may wait until this market is re-enabled.</p>
  {error?<p role="alert">{error}</p>:null}
  <fieldset className="settings-group" disabled={!flags}>{keys.map(k=><label key={k} className="settings-row"><input type="checkbox" checked={flags?.[k]??FEATURE_DEFAULTS[k]} disabled={busy!==null} onChange={e=>toggle(k,e.target.checked)}/><span><strong>{FEATURE_LABELS[k]}</strong><small>{(flags?.[k]??FEATURE_DEFAULTS[k])?"On":"Temporarily disabled"}</small></span></label>)}</fieldset>
 </section>;
}
