"use client";
import {useEffect,useState} from "react";
import {getTabHeaders} from "../lib/tab-identity";
import {CHECK_IN_REWARDS} from "../lib/check-in";
type View={day:string;streak:number;claimed:boolean;reward:number;show?:boolean};
export function CheckInRow({streak}:{streak:number}){return <div className="check-in-row">{CHECK_IN_REWARDS.map((reward,i)=><div key={i} data-current={Math.min(streak,7)===i+1}><small>Day {i+1}{i===6?"+":""}</small><strong>${reward/100}</strong></div>)}</div>;}
export default function CheckInBanner(){
 const [view,setView]=useState<View|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 async function request(type:string){const res=await fetch("/api/check-in",{method:"POST",headers:{"Content-Type":"application/json",...getTabHeaders()},body:JSON.stringify({type})});const data=await res.json();if(!res.ok)throw Error(data.error);return data as View;}
 useEffect(()=>{let active=true;request("banner").then(v=>{if(active&&v?.show)setView(v);}).catch(()=>{});return()=>{active=false;};},[]);
 if(!view)return null;
 return <aside className="check-in-banner" aria-label="Daily check-in"><div className="check-in-head"><div><small>Daily check-in · Vancouver time</small><h2>Day {view.streak}. Welcome back.</h2></div><button onClick={()=>setView(null)} aria-label="Dismiss daily check-in">×</button></div><CheckInRow streak={view.streak}/><p>Keep your streak going. Miss a day and restart at day 1.</p>{error?<p role="alert">{error}</p>:null}<button className="primary" disabled={busy||view.claimed} onClick={async()=>{setBusy(true);try{const next=await request("claim");setView(next);window.dispatchEvent(new Event("check-in:claimed"));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>{view.claimed?"Claimed":"Claim $"+view.reward/100}</button></aside>;
}
