"use client";
import {useEffect,useState} from "react";
type Mode="price"|"pnl";
const options:{value:Mode;label:string;hint:string}[]=[
 {value:"price",label:"Price",hint:"Type the exact price where a take-profit or stop-loss should close."},
 {value:"pnl",label:"P/L amount",hint:"Type the profit or loss in dollars, as positive numbers. The price is worked out for you."}];
export default function SettingsClient(){
 const [mode,setMode]=useState<Mode|null>(null),[error,setError]=useState(""),[saving,setSaving]=useState(false);
 useEffect(()=>{let live=true;fetch("/api/settings").then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j.error||"Could not load settings.");if(live)setMode(j.triggerInputMode);}).catch(e=>live&&setError(e.message));return()=>{live=false;};},[]);
 async function choose(next:Mode){
  if(next===mode||saving)return;const prev=mode;setMode(next);setSaving(true);setError("");
  try{const r=await fetch("/api/settings",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({triggerInputMode:next,requestId:crypto.randomUUID(),requestAt:Date.now()})});
   if(!r.ok)throw new Error((await r.json().catch(()=>({}))).error||"Could not save.");}
  catch(e){setMode(prev);setError(e instanceof Error?e.message:"Could not save.");}
  finally{setSaving(false);}
 }
 return <main className="game-main settings"><h1>Settings</h1>
  <fieldset className="settings-group" disabled={mode===null}><legend>Take-profit and stop-loss input</legend>
   {options.map(o=><label key={o.value} className="settings-row"><input type="radio" name="triggerInputMode" value={o.value} checked={mode===o.value} onChange={()=>choose(o.value)}/><span><strong>{o.label}</strong><small>{o.hint}</small></span></label>)}
  </fieldset>
  {error?<div className="error" role="alert">{error}<button aria-label="Dismiss error" onClick={()=>setError("")}>×</button></div>:null}
 </main>;
}
