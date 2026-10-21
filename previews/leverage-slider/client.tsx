import React,{useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import LimitsControls from "../../app/trading-limit-controls";
import {Markets} from "../../app/finance-client";
function Demo(){
 const [mark,setMark]=useState("84500");
 const [room,setRoom]=useState<any>(),[busy,setBusy]=useState(false),[error,setError]=useState("");
 useEffect(()=>{fetch("/room").then(r=>r.json()).then(setRoom)},[]);
 const post=async(path:string,body:object)=>{setBusy(true);setError("");try{const r=await fetch(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({requestId:crypto.randomUUID(),requestAt:Date.now(),...body})}),data=await r.json();if(!r.ok)throw Error(data.error);setRoom(data);}catch(e){setError(String(e));throw e;}finally{setBusy(false);}};
 return <><header className="mast" style={{position:"static"}}><span className="wordmark">ssg200x</span><span>Leverage slider preview · isolated fictional account</span></header><main style={{padding:24}}>{error?<p role="alert">{error}</p>:null}{room?<><h2>Admin</h2><LimitsControls room={room} busy={busy} post={post}/><h2>Markets</h2><p>Isolated test funds and scripted quotes only. Uses the real Markets UI and server trading functions. Chart and live connection are stubbed; no production accounts or funds.</p><label>Demo BTC mark <input aria-label="Demo BTC mark" type="number" value={mark} onChange={e=>setMark(e.target.value)}/></label><button onClick={()=>post("/demo-mark",{micro:Math.round(Number(mark)*1e6)})}>Set demo price</button><Markets room={room} busy={busy} post={post}/></>:<p>Loading</p>}</main></>;
}
createRoot(document.getElementById("root")!).render(<Demo/>);
