"use client";
import {useCallback,useEffect,useState} from "react";
import {getTabHeaders} from "@/lib/tab-identity";
import {BeanAmount} from "./doudizhu-fx";
export default function DoudizhuRateSettings(){
 const [maxBeansPerDollar,setMaxRate]=useState<number|null>(null),[value,setValue]=useState(""),[hidden,setHidden]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[saved,setSaved]=useState("");
 const load=useCallback(async()=>{
  try{
   const r=await fetch("/api/admin/doudizhu",{cache:"no-store"});
   if(r.status===403){setHidden(true);return;}
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(j.error||"Could not load the maximum Happy Beans per $1.");
   setMaxRate(j.maxBeansPerDollar);setValue(String(j.maxBeansPerDollar));
  }catch(e){setError(e instanceof Error?e.message:"Could not load the maximum Happy Beans per $1.");}
 },[]);
 useEffect(()=>{void load();},[load]);
 async function save(e:React.FormEvent){
  e.preventDefault();if(maxBeansPerDollar===null||busy)return;
  setError("");setSaved("");
  const next=Number(value);
  if(!value.trim()||!Number.isInteger(next)||next<1||next>1_000_000_000){setError("Enter whole beans between 1 and 1,000,000,000.");return;}
  setBusy(true);
  try{
   const r=await fetch("/api/admin/doudizhu",{method:"POST",headers:{"content-type":"application/json",...getTabHeaders()},body:JSON.stringify({maxBeansPerDollar:next,expectedMaxBeansPerDollar:maxBeansPerDollar})});
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(j.error||"Could not save the maximum Happy Beans per $1.");
   setMaxRate(j.maxBeansPerDollar);setValue(String(j.maxBeansPerDollar));setSaved("Maximum rate saved.");
  }catch(e){setError(e instanceof Error?e.message:"Could not save the maximum Happy Beans per $1.");await load();}
  finally{setBusy(false);}
 }
 if(hidden)return null;
 return <form className="admin-block" onSubmit={save} aria-labelledby="doudizhu-rate-title">
  <h2 id="doudizhu-rate-title">Dou Dizhu</h2>
  {maxBeansPerDollar===null?<p role="status">Loading maximum Happy Beans per $1…</p>:<fieldset className="admin-set admin-fields" disabled={busy}>
   <label><span>Max Happy Beans per $1</span><input type="number" inputMode="numeric" min={1} max={1000000000} step={1} required value={value} onChange={e=>{setValue(e.target.value);setSaved("");}} aria-describedby="doudizhu-rate-help"/></label>
   <p id="doudizhu-rate-help">New rooms default to <BeanAmount v="1,000"/> per $1, with <BeanAmount v="1,000"/>, <BeanAmount v="2,000"/> and <BeanAmount v="3,000"/> presets. This maximum applies only when creating a room. Existing rooms are unaffected.</p>
   <button type="submit" className="primary">Save maximum</button>
  </fieldset>}
  {saved?<p role="status">{saved}</p>:null}
  {error?<div className="error" role="alert">{error}<button type="button" aria-label="Dismiss error" onClick={()=>setError("")}>×</button></div>:null}
 </form>;
}
