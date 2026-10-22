"use client";
import {useState} from "react";
import {getTabHeaders} from "@/lib/tab-identity";
// Demo/QA only. Hard guard lives in the endpoint (QA env, test keys, QA DB, demo origin). Bot2 starts a kick on Bot1 at Table 01; bots never finish the vote.
export const POKER_KICK_DEMO=process.env.NEXT_PUBLIC_POKER_KICK_DEMO==="1";
export function PokerKickDemoButton({tableId,onRoom}:{tableId:string;onRoom?:(room:unknown)=>void}){
 const [busy,setBusy]=useState(false),[msg,setMsg]=useState("");
 if(!POKER_KICK_DEMO||tableId!=="01")return null;
 async function go(){setBusy(true);setMsg("");try{const r=await fetch("/api/poker-kicks/demo",{method:"POST",headers:{"Content-Type":"application/json",...getTabHeaders()},body:JSON.stringify({})});const j=await r.json().catch(()=>({}));if(!r.ok)setMsg(j.error||"Could not start demo vote.");else onRoom?.(j.freshPublicRoom??j);}catch{setMsg("Could not start demo vote.");}finally{setBusy(false);}}
 return <div className="poker-kick-demo"><button type="button" disabled={busy} onClick={()=>void go()}>Demo: Bot2 kicks Bot1</button>{msg?<small role="status">{msg}</small>:null}</div>;
}
