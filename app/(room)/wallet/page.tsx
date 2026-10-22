"use client";
import {getTabHeaders} from "@/lib/tab-identity";
import {useEffect,useRef,useState} from "react";
import {useLive,useLiveEvent} from "../../live-provider";
import {createTransferHistoryRefresh,retryAfterMs} from "@/lib/transfer-history-refresh";
import type {PublicRoom} from "@/lib/public";
import WordEntry from "../../word-entry";
import styles from "./wallet.module.css";
import {useFeatures} from "../../use-features";
import {FeatureNotice} from "../../feature-gate";

type Entry={id:string;amount:number;note:string;at:number;from:string;to:string;direction:string;kind?:string};
type Resolved={name:string;publicId:string;expiresAt:number;avatar?:string|null;amount:number;note?:string};
type Preview={previewId:string;count:number;total:number;amount:number;note?:string;expiresAt:number};
type ReceiveCode={id:string;code:string;amount:number;note?:string;expiresAt:number};
type Pending={key:string;requestId:string};

const money=(n:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(n/100);
const AMOUNT="(?:0|[1-9][0-9]*)(?:\\.[0-9]{1,2})?";
const words=(v:string)=>v.trim().toLowerCase().split(/\s+/).filter(Boolean);

async function call(url:string,body?:object,signal?:AbortSignal){
 const res=await fetch(url,body?{method:"POST",headers:{"content-type":"application/json",...getTabHeaders()},body:JSON.stringify(body)}:{cache:"no-store",signal});
 const value=await res.json().catch(()=>({}));
 if(!res.ok)throw Object.assign(new Error(value.error||"Request unavailable."),{status:res.status,retryAfter:retryAfterMs(res.headers.get("Retry-After"))});
 return value;
}

export default function Wallet(){
 const {connection}=useLive();
 const [room,setRoom]=useState<PublicRoom>(),[entries,setEntries]=useState<Entry[]>([]),[all,setAll]=useState(false);
 const [code,setCode]=useState(""),[recipient,setRecipient]=useState<Resolved>();
 const [amount,setAmount]=useState(""),[note,setNote]=useState(""),[receive,setReceive]=useState<ReceiveCode[]>([]);
 const [generateAfter,setGenerateAfter]=useState(0);
 const nextGenerate=useRef(0);
 const [airAmount,setAirAmount]=useState(""),[airNote,setAirNote]=useState(""),[preview,setPreview]=useState<Preview>();
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState(""),[now,setNow]=useState(Date.now());
 const sendRetry=useRef<Pending|null>(null),airRetry=useRef<Pending|null>(null),historyRefresh=useRef<ReturnType<typeof createTransferHistoryRefresh>|null>(null),historyKey=useRef<string|undefined>(undefined);

 const refresh=()=>historyRefresh.current?.refresh();
 async function refreshCodes(signal?:AbortSignal){
  const data=await call("/api/transfers?active=1",undefined,signal);
  if(!signal?.aborted)setReceive(data.codes);
 }
 useEffect(()=>{
  if(connection!=="connected")return;
  const controller=new AbortController();
  void refreshCodes(controller.signal).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
  return()=>controller.abort();
 },[connection]);
 useEffect(()=>{
  let active=true;
  const loader=createTransferHistoryRefresh(async signal=>{
   const data=await call("/api/transfers"+(all?"?all=1":""),undefined,signal);
   if(active){setEntries(data.transfers);setError("");}
  },e=>{if(active)setError(e.message);});
  historyRefresh.current=loader;loader.refresh();
  return()=>{active=false;loader.close();historyRefresh.current=null;};
 },[all]);
 useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(t);},[]);
 useLiveEvent("room:state",(r:PublicRoom)=>{setRoom(r);const key=all?r.transferHistoryKeys.all:r.transferHistoryKeys.mine;if(historyKey.current!==undefined&&historyKey.current!==key)refresh();historyKey.current=key;});

 async function run(fn:()=>Promise<void>){
  if(busy)return;setBusy(true);setError("");setMessage("");
  try{await fn();}catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 function editSend(){sendRetry.current=null;setRecipient(undefined);setMessage("");}
 function editAirdrop(){airRetry.current=null;setPreview(undefined);}

 async function generate(){
  if(Date.now()<nextGenerate.current)throw new Error("Generate one receive code per second.");
  nextGenerate.current=Date.now()+1000;setGenerateAfter(nextGenerate.current);
  const n=note.trim();
  const created:ReceiveCode=await call("/api/transfers",{action:"code",amount:amount.trim(),...(n?{note:n}:{})});
  setNow(Date.now());setReceive(previous=>[created,...previous.filter(item=>item.id!==created.id)]);
  setMessage("Receive code created.");
 }
 async function cancelCode(id:string){
  await call("/api/transfers",{action:"cancel",id});
  setReceive(previous=>previous.filter(item=>item.id!==id));setMessage("Receive code cancelled.");
 }
 async function resolve(){
  const c=words(code);
  if(c.length!==2&&c.length!==4)throw new Error("Enter the two-word code.");
  setRecipient(await call("/api/transfers",{action:"resolve",code:c.join(" ")}));
 }
 async function send(){
  if(!recipient)return;
  const c=words(code).join(" "),key=c+"|"+recipient.publicId+"|"+recipient.amount+"|"+(recipient.note??"");
  if(sendRetry.current?.key!==key)sendRetry.current={key,requestId:crypto.randomUUID()};
  await call("/api/transfers",{action:"send",code:c,recipient:recipient.publicId,requestId:sendRetry.current.requestId});
  sendRetry.current=null;setRecipient(undefined);setCode("");setMessage("Play money sent.");await refresh();
 }
 async function previewAirdrop(){
  airRetry.current=null;
  setPreview(await call("/api/airdrops",{action:"preview",amount:airAmount.trim(),note:airNote.trim()||undefined}));
 }
 async function confirmAirdrop(){
  if(!preview)return;
  const key=preview.previewId;
  if(airRetry.current?.key!==key)airRetry.current={key,requestId:crypto.randomUUID()};
  try{await call("/api/airdrops",{action:"confirm",previewId:preview.previewId,requestId:airRetry.current.requestId});}
  catch(e){
   if((e as {status?:number}).status===409){airRetry.current=null;setPreview(undefined);throw new Error("Players changed since the preview. Preview the airdrop again.");}
   throw e;
  }
  airRetry.current=null;setMessage("Airdrop sent to "+preview.count+" players.");setPreview(undefined);setAirAmount("");setAirNote("");await refresh();
 }

 const recipientName=recipient?(room?.chatNames?.find(m=>m.publicId===recipient.publicId)?.name??recipient.name):"";
 const ready=connection==="connected",expired=Boolean(recipient&&recipient.expiresAt<=now),previewExpired=Boolean(preview&&preview.expiresAt<=now);
 const label=(t:Entry)=>t.kind==="airdrop"?(t.direction==="received"?"Airdrop":"Airdrop to "+t.to):t.direction==="sent"?"To "+t.to:t.direction==="received"?"From "+t.from:t.from+" to "+t.to;
 const {features:ft}=useFeatures();
 return <main className={styles.wallet}>
  <header><p className={styles.eyebrow}>Play money only</p><h1>Wallet</h1><p className={styles.balance}>{room?money(room.me.wallet):"Loading…"}</p><p>Available cash. Open positions and table chips stay locked.</p></header>
  {ft.transfers?null:<FeatureNotice feature="transfers"/>}
  {ft.transfers?<div className={styles.columns}>
   <section aria-labelledby="receive-title"><h2 id="receive-title">Receive</h2>
    <p>Set the amount you want, then share the two-word code with the sender. It expires in 10 minutes and works once. Each code stays active until it is used, cancelled, or expires. This is not your chat recovery phrase.</p>
    <form onSubmit={e=>{e.preventDefault();void run(generate);}}>
     <label>Amount in dollars<input inputMode="decimal" autoComplete="off" value={amount} maxLength={32} required disabled={busy} onChange={e=>setAmount(e.target.value)} placeholder="0.00" pattern={AMOUNT}/></label>
     <label>Note <span>(optional)</span><input value={note} maxLength={160} disabled={busy} onChange={e=>setNote(e.target.value)}/></label>
     <button className="primary" disabled={busy||!ready||now<generateAfter}>Generate receive code</button>
    </form>
    <div className={styles.receiveList} aria-label="Active receive codes">
     {receive.filter(item=>item.expiresAt>now).map(item=><article key={item.id} className={styles.receiveItem} aria-label={item.code}>
      <output className={styles.code} aria-label="Your receive code">{item.code}</output>
      <p><strong>{money(item.amount)}</strong>{item.note?<> · {item.note}</>:null}</p>
      <p>Expires in {Math.min(10,Math.max(1,Math.ceil((item.expiresAt-now)/60000)))} min.</p>
      <button disabled={busy} onClick={()=>void run(async()=>{await navigator.clipboard.writeText(item.code);setMessage("Receive code copied.");})}>Copy code</button>
      <button disabled={busy||!ready} onClick={()=>void run(()=>cancelCode(item.id))}>Cancel code</button>
     </article>)}
     {!receive.some(item=>item.expiresAt>now)?<p>No active receive codes.</p>:null}
    </div>
   </section>
   {ft.payments?<section aria-labelledby="send-title"><h2 id="send-title">Send</h2>
    <form onSubmit={e=>{e.preventDefault();void run(recipient?send:resolve);}}>
     <WordEntry count={2} label="Recipient’s two-word code" value={code} disabled={busy} onChange={value=>{setCode(value);editSend();}}/>
     {recipient?<div role="status" className={styles.preview}>{recipient.avatar?<img src={recipient.avatar} alt="" width={40} height={40} style={{borderRadius:"50%"}}/>:null}<p>Send <strong>{money(recipient.amount)}</strong> to <strong>{recipientName}</strong>{recipient.note?<>. Note: “{recipient.note}”</>:null}. {expired?"Code expired. Ask for a new code.":"The amount is set by the receiver."}</p></div>:null}
     <button className="primary" disabled={busy||!ready||expired}>{busy?"Working…":recipient?"Confirm send to "+recipientName:"Check code"}</button>{recipient?<button type="button" disabled={busy} onClick={editSend}>Cancel</button>:null}
    </form>
   </section>:<section aria-labelledby="send-title"><h2 id="send-title">Send</h2><FeatureNotice feature="payments"/></section>}
  </div>:null}
  {room?.me.admin&&ft.airdrops?<section className={styles.airdrop} aria-labelledby="airdrop-title"><h2 id="airdrop-title">Airdrop <span>(admin)</span></h2>
   <p>Give every eligible player the same play money. You will see the exact player count and total before it is sent.</p>
   <form onSubmit={e=>{e.preventDefault();void run(preview&&!previewExpired?confirmAirdrop:previewAirdrop);}}>
    <label>Amount per player in dollars<input inputMode="decimal" autoComplete="off" value={airAmount} maxLength={32} required disabled={busy} onChange={e=>{setAirAmount(e.target.value);editAirdrop();}} placeholder="0.00" pattern={AMOUNT}/></label>
    <label>Note <span>(optional)</span><input value={airNote} maxLength={160} disabled={busy} onChange={e=>{setAirNote(e.target.value);editAirdrop();}}/></label>
    {preview?<p role="status">{previewExpired?"Preview expired. Preview again.":<>Send <strong>{money(preview.amount)}</strong> to <strong>{preview.count}</strong> players, <strong>{money(preview.total)}</strong> in total.{preview.note?<> Note: “{preview.note}”</>:null}</>}</p>:null}
    <button className="primary" disabled={busy||!ready}>{busy?"Working…":preview&&!previewExpired?"Confirm airdrop of "+money(preview.total):"Preview airdrop"}</button>{preview?<button type="button" disabled={busy} onClick={editAirdrop}>Cancel</button>:null}
   </form></section>:null}
  {!ready?<p role="status">Reconnect to send or receive play money.</p>:null}{error?<p role="alert" className={styles.error}>{error}</p>:null}{message?<p role="status">{message}</p>:null}
  <section className={styles.history} aria-labelledby="history-title"><div className={styles.historyHeader}><h2 id="history-title">Transfer history</h2>{room?.me.admin?<label><input type="checkbox" checked={all} onChange={e=>{setEntries([]);setAll(e.target.checked);}}/> All users</label>:null}</div><p>Most recent 100 transfers.</p>
   {entries.length?<ol>{entries.map(t=><li key={t.id}><div><strong>{label(t)}</strong><time dateTime={new Date(t.at).toISOString()}>{new Date(t.at).toLocaleString()}</time>{t.note?<p>{t.note}</p>:null}</div><span>{t.direction==="sent"?"−":t.direction==="received"?"+":""}{money(t.amount)}</span></li>)}</ol>:<p>No transfers yet.</p>}</section>
 </main>;
}
