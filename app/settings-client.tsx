"use client";
import {getTabHeaders} from "@/lib/tab-identity";
import {useEffect,useState} from "react";
type Mode="price"|"pnl";
type Settings={triggerInputMode:Mode;hideFromLeaderboard:boolean};
const options:{value:Mode;label:string;hint:string}[]=[
 {value:"price",label:"Price",hint:"Type the exact price where a take-profit or stop-loss should close."},
 {value:"pnl",label:"P/L amount",hint:"Type the profit or loss in dollars, as positive numbers. The price is worked out for you."}];
export default function SettingsClient(){
 const [settings,setSettings]=useState<Settings|null>(null),[error,setError]=useState(""),[saving,setSaving]=useState(false);
 useEffect(()=>{let live=true;fetch("/api/settings").then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j.error||"Could not load settings.");if(live)setSettings(j);}).catch(e=>live&&setError(e.message));return()=>{live=false;};},[]);
 async function choose(patch:Partial<Settings>){
  if(!settings||saving)return;const prev=settings;setSettings({...settings,...patch});setSaving(true);setError("");
  try{const r=await fetch("/api/settings",{method:"POST",headers:{"content-type":"application/json",...getTabHeaders()},body:JSON.stringify({...patch,requestId:crypto.randomUUID(),requestAt:Date.now()})});
   if(!r.ok)throw new Error((await r.json().catch(()=>({}))).error||"Could not save.");}
  catch(e){setSettings(prev);setError(e instanceof Error?e.message:"Could not save.");}
  finally{setSaving(false);}
 }
 return <main className="game-main settings"><h1>Settings</h1>
  <fieldset className="settings-group" disabled={!settings||saving}><legend>Take-profit and stop-loss input</legend>
   {options.map(o=><label key={o.value} className="settings-row"><input type="radio" name="triggerInputMode" value={o.value} checked={settings?.triggerInputMode===o.value} onChange={()=>choose({triggerInputMode:o.value})}/><span><strong>{o.label}</strong><small>{o.hint}</small></span></label>)}
  </fieldset>
  <fieldset className="settings-group" disabled={!settings||saving}><legend>Privacy</legend>
   <label className="settings-row"><input type="checkbox" name="hideFromLeaderboard" checked={settings?.hideFromLeaderboard??false} onChange={e=>choose({hideFromLeaderboard:e.target.checked})}/><span><strong>Hide me from leaderboard</strong><small>Hide your name and net worth from the public leaderboard and signed-in standings. Administrators can still see your account.</small></span></label>
  </fieldset>
  {saving?<p role="status">Saving…</p>:null}
  {error?<div className="error" role="alert">{error}<button aria-label="Dismiss error" onClick={()=>setError("")}>×</button></div>:null}
 </main>;
}
