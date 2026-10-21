"use client";
import {useCallback,useEffect,useState} from "react";
import {getTabHeaders} from "@/lib/tab-identity";
export default function DoudizhuRateSettings(){
 const [maxRate,setMaxRate]=useState<number|null>(null),[value,setValue]=useState(""),[hidden,setHidden]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[saved,setSaved]=useState("");
 const load=useCallback(async()=>{
  try{
   const r=await fetch("/api/admin/doudizhu",{cache:"no-store"});
   if(r.status===403){setHidden(true);return;}
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(j.error||"Could not load the maximum rate.");
   setMaxRate(j.maxRate);setValue(String(j.maxRate));
  }catch(e){setError(e instanceof Error?e.message:"Could not load the maximum rate.");}
 },[]);
 useEffect(()=>{void load();},[load]);
 async function save(e:React.FormEvent){
  e.preventDefault();if(maxRate===null||busy)return;
  setError("");setSaved("");
  const next=Number(value);
  if(!value.trim()||!Number.isInteger(next)||next<1||next>1_000_000){setError("Enter whole dollars between $1 and $1,000,000.");return;}
  setBusy(true);
  try{
   const r=await fetch("/api/admin/doudizhu",{method:"POST",headers:{"content-type":"application/json",...getTabHeaders()},body:JSON.stringify({maxRate:next,expectedMaxRate:maxRate})});
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(j.error||"Could not save the maximum rate.");
   setMaxRate(j.maxRate);setValue(String(j.maxRate));setSaved("Maximum rate saved.");
  }catch(e){setError(e instanceof Error?e.message:"Could not save the maximum rate.");await load();}
  finally{setBusy(false);}
 }
 if(hidden)return null;
 return <form className="admin-block" onSubmit={save} aria-labelledby="doudizhu-rate-title">
  <h2 id="doudizhu-rate-title">Dou Dizhu</h2>
  {maxRate===null?<p role="status">Loading maximum rate…</p>:<fieldset className="admin-set admin-fields" disabled={busy}>
   <label><span>Max Dou Dizhu dollars per point</span><input type="number" inputMode="numeric" min={1} max={1000000} step={1} required value={value} onChange={e=>{setValue(e.target.value);setSaved("");}} aria-describedby="doudizhu-rate-help"/></label>
   <p id="doudizhu-rate-help">New rooms default to $1 per point, with $1 and $5 presets. This maximum applies only when creating a room. Existing rooms are unaffected.</p>
   <button type="submit" className="primary">Save maximum rate</button>
  </fieldset>}
  {saved?<p role="status">{saved}</p>:null}
  {error?<div className="error" role="alert">{error}<button type="button" aria-label="Dismiss error" onClick={()=>setError("")}>×</button></div>:null}
 </form>;
}
