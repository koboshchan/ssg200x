import React,{useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import {Markets} from "../../app/finance-client";
function Demo(){
 const [room,setRoom]=useState<any>(),[busy,setBusy]=useState(false),[error,setError]=useState("");
 useEffect(()=>{const refresh=()=>fetch("/room").then(r=>r.json()).then(setRoom);void refresh();const timer=setInterval(refresh,500);return()=>clearInterval(timer);},[]);
 const post=async(path:string,body:object)=>{setBusy(true);setError("");try{
  const response=await fetch(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({requestId:crypto.randomUUID(),requestAt:Date.now(),...body})}),data=await response.json();
  if(!response.ok)throw Error(data.error);setRoom(data);
 }catch(e){setError(String(e));throw e;}finally{setBusy(false);}};
 return <main style={{padding:24}}><h1>Stock publication fix</h1><p>Isolated component preview, not the main app. Fictional funds and scripted stock data only. No provider connection.</p><p>Uses the real Markets controls, execution policy and position settlement. Backend queue lag, takeover and ordered-trigger regressions run separately in tests.</p><div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{[["healthy","Healthy feed"],["disconnected","Disconnect feed"],["lease","Expire lease"],["stale","Stale trade"],["reset","Reset position"]].map(([mode,label])=><button key={mode} onClick={()=>void post("/demo-mode",{mode})}>{label}</button>)}</div>{error?<p role="alert">{error}</p>:null}{room?<Markets room={room} busy={busy} post={post}/>:<p>Loading</p>}</main>;
}
createRoot(document.getElementById("root")!).render(<Demo/>);
