"use client";
import {useCallback,useEffect,useState} from "react";
type Status={admin:boolean;active:boolean;blocked:boolean;manual:boolean;backfill:boolean};
export default function MaintenanceGate({children}:{children:React.ReactNode}){
 const [status,setStatus]=useState<Status>(),[error,setError]=useState("");
 const refresh=useCallback(async(signal?:AbortSignal)=>{const r=await fetch("/api/maintenance",{cache:"no-store",signal});const data=await r.json();if(!r.ok)throw new Error(data.error||"Could not check availability");setStatus(data);setError("");},[]);
 useEffect(()=>{const c=new AbortController();let timer:ReturnType<typeof setTimeout>;async function load(){try{await refresh(c.signal);}catch(e){if(!c.signal.aborted)setError(e instanceof Error?e.message:"Could not check availability");}finally{if(!c.signal.aborted)timer=setTimeout(load,5000);}}load();return()=>{c.abort();clearTimeout(timer);};},[refresh]);
 if(!status||status.blocked||error)return <main className="maintenance-page"><h1>{status?.blocked?"Under maintenance":"Opening the room"}</h1><p>{error|| (status?.blocked?"We’re making a few updates. Please check back soon.":"Checking availability…")}</p>{error?<button onClick={()=>refresh().catch(e=>setError(e.message))}>Try again</button>:null}</main>;
 return <>{status.admin?<aside className="maintenance-admin"><div><strong>{status.active?"Maintenance is on":"Site is open"}</strong><p>{status.backfill?"Historical prices are loading. Only administrators can enter.":status.manual?"Manual maintenance is enabled. Only administrators can enter.":"Everyone with approved access can enter."}</p></div><MaintenanceToggle status={status} refresh={refresh}/></aside>:null}{children}</>;
}
function MaintenanceToggle({status,refresh}:{status:Status;refresh:()=>Promise<void>}){
 const [confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 async function save(){setBusy(true);setError("");try{const r=await fetch("/api/admin",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:"site-maintenance",enabled:!status.manual,requestId:crypto.randomUUID(),requestAt:Date.now()})});const data=await r.json();if(!r.ok)throw new Error(data.error);await refresh();setConfirm(false);}catch(e){setError(e instanceof Error?e.message:"Could not change maintenance");}finally{setBusy(false);}}
 return <div>{confirm?<><p>{status.manual?"Turn off manual maintenance?":"Turn on manual maintenance?"}{status.backfill?" Backfill maintenance stays on until the import finishes.":""}</p><button disabled={busy} onClick={save}>Confirm</button> <button disabled={busy} onClick={()=>setConfirm(false)}>Cancel</button></>:<button onClick={()=>setConfirm(true)}>{status.manual?"Turn off manual maintenance":"Turn on maintenance"}</button>}{error?<p role="alert">{error}</p>:null}</div>;
}
