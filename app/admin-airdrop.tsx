"use client";
import {useEffect,useRef,useState} from "react";
import {getTabHeaders} from "@/lib/tab-identity";

type Preview={previewId:string;count:number;total:number;amount:number;note?:string;expiresAt:number};
type Pending={key:string;requestId:string};
const money=(n:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(n/100);
const AMOUNT="(?:0|[1-9][0-9]*)(?:\\.[0-9]{1,2})?";

async function call(body:object){
 const response=await fetch("/api/airdrops",{method:"POST",headers:{"content-type":"application/json",...getTabHeaders()},body:JSON.stringify(body)});
 const value=await response.json().catch(()=>({}));
 if(!response.ok)throw Object.assign(new Error(value.error||"Request unavailable."),{status:response.status});
 return value;
}

export default function AdminAirdrop({ready,disabled=false}:{ready:boolean;disabled?:boolean}){
 const [airAmount,setAirAmount]=useState(""),[airNote,setAirNote]=useState(""),[preview,setPreview]=useState<Preview>();
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState(""),[now,setNow]=useState(Date.now());
 const airRetry=useRef<Pending|null>(null),inFlight=useRef(false);
 const working=busy||disabled,previewExpired=Boolean(preview&&preview.expiresAt<=now);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
 async function run(fn:()=>Promise<void>){
  if(inFlight.current||working||!ready)return;
  inFlight.current=true;setBusy(true);setError("");setMessage("");
  try{await fn();}catch(e){setError((e as Error).message);}finally{inFlight.current=false;setBusy(false);}
 }
 function editAirdrop(){airRetry.current=null;setPreview(undefined);setMessage("");}
 async function previewAirdrop(){
  airRetry.current=null;
  setPreview(await call({action:"preview",amount:airAmount.trim(),note:airNote.trim()||undefined}));
 }
 async function confirmAirdrop(){
  if(!preview)return;
  const key=preview.previewId;
  if(airRetry.current?.key!==key)airRetry.current={key,requestId:crypto.randomUUID()};
  try{await call({action:"confirm",previewId:preview.previewId,requestId:airRetry.current.requestId});}
  catch(e){
   if((e as {status?:number}).status===409){airRetry.current=null;setPreview(undefined);throw new Error("Players changed since the preview. Preview the airdrop again.");}
   throw e;
  }
  airRetry.current=null;setMessage("Airdrop sent to "+preview.count+" players.");setPreview(undefined);setAirAmount("");setAirNote("");
 }

 return <section className="admin-block" aria-labelledby="airdrop-title"><h2 id="airdrop-title">Airdrop</h2>
   <p>Give every eligible player the same play money. You will see the exact player count and total before it is sent.</p>
   <form className="admin-set admin-fields" onSubmit={e=>{e.preventDefault();void run(preview&&!previewExpired?confirmAirdrop:previewAirdrop);}}>
    <label>Amount per player in dollars<input inputMode="decimal" autoComplete="off" value={airAmount} maxLength={32} required disabled={working} onChange={e=>{setAirAmount(e.target.value);editAirdrop();}} placeholder="0.00" pattern={AMOUNT}/></label>
    <label>Note <span>(optional)</span><input value={airNote} maxLength={160} disabled={working} onChange={e=>{setAirNote(e.target.value);editAirdrop();}}/></label>
    {preview?<p role="status">{previewExpired?"Preview expired. Preview again.":<>Send <strong>{money(preview.amount)}</strong> to <strong>{preview.count}</strong> players, <strong>{money(preview.total)}</strong> in total.{preview.note?<> Note: “{preview.note}”</>:null}</>}</p>:null}
    <button className="primary" disabled={working||!ready}>{working?"Working…":preview&&!previewExpired?"Confirm airdrop of "+money(preview.total):"Preview airdrop"}</button>{preview?<button type="button" disabled={working} onClick={editAirdrop}>Cancel</button>:null}
   </form>
  {!ready?<p role="status" className="admin-note">Reconnect to send an airdrop.</p>:null}
  {error?<p role="alert" className="error">{error}</p>:null}{message?<p role="status">{message}</p>:null}
 </section>;
}
