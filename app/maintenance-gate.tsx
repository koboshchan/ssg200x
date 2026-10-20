"use client";
import {useState} from "react";
import {useLive,type MaintenanceStatus} from "./live-provider";
export default function MaintenanceGate({children}:{children:React.ReactNode}){
 const {maintenance:status,connection}=useLive();
 if(!status||status.blocked)return <main className="maintenance-page"><h1>{status?.blocked?"Under maintenance":"Opening the room"}</h1><p>{status?.blocked?"We’re making a few updates. Please check back soon.":connection==="disconnected"?"Reconnecting…":"Checking availability…"}</p></main>;
 return <>{status.admin?<aside className="maintenance-admin"><div><strong>{status.active?"Maintenance is on":"Site is open"}</strong><p>{status.manual?"Manual maintenance is enabled. Only administrators can enter.":"Everyone signed in can enter."}</p></div><MaintenanceToggle status={status} connected={connection==="connected"}/></aside>:null}{children}</>;
}
function MaintenanceToggle({status,connected}:{status:MaintenanceStatus;connected:boolean}){
 const [confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 async function save(){setBusy(true);setError("");try{const r=await fetch("/api/admin",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:"site-maintenance",enabled:!status.manual,requestId:crypto.randomUUID(),requestAt:Date.now()})});const data=await r.json();if(!r.ok)throw new Error(data.error);setConfirm(false);}catch(e){setError(e instanceof Error?e.message:"Could not change maintenance");}finally{setBusy(false);}}
 return <div>{confirm?<><p>{status.manual?"Turn off manual maintenance?":"Turn on manual maintenance?"}</p><button disabled={busy||!connected} onClick={save}>Confirm</button> <button disabled={busy} onClick={()=>setConfirm(false)}>Cancel</button></>:<button disabled={!connected} onClick={()=>setConfirm(true)}>{status.manual?"Turn off manual maintenance":"Turn on maintenance"}</button>}{error?<p role="alert">{error}</p>:null}</div>;
}
