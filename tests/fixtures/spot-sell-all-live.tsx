import React from "react";
import {createRoot} from "react-dom/client";
import {Markets} from "../../app/finance-client";
function Demo(){const [room,setRoom]=React.useState<any>(null),[busy,setBusy]=React.useState(false),[error,setError]=React.useState("");
React.useEffect(()=>{fetch("/room").then(r=>r.json()).then(setRoom)},[]);
return room?<><p>Spot sell verification · isolated fixture, no real accounts</p><Markets room={room} busy={busy} post={async(path,body)=>{setBusy(true);const r=await fetch(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...body,requestId:crypto.randomUUID(),requestAt:Date.now()})});const data=await r.json();if(r.ok){setRoom(data);setError("")}else setError(data.error);setBusy(false);}}/><p role="alert">{error}</p></>:null;}
createRoot(document.getElementById("root")!).render(<Demo/>);
