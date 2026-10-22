"use client";
import {useRef,useState,useId} from "react";
import type {PublicRoom} from "@/lib/public";
import type {CloseAllMode} from "@/lib/perps-close-all";
import styles from "./in-play-navigation.module.css";
type Props={room:PublicRoom;busy:boolean;post:(path:string,body:object)=>Promise<void>};
const labels:Record<CloseAllMode,string>={all:"Close all",profiting:"Close all profiting",losing:"Close all losing"};
export default function PerpsCloseAll({room,busy,post}:Props){
 const cancel=useRef<HTMLButtonElement>(null),dialog=useRef<HTMLDialogElement>(null),menu=useRef<HTMLDetailsElement>(null),lock=useRef(false),pending=useRef<{ids:string[];mode:CloseAllMode}|null>(null),title=useId(),description=useId();
 const [snapshot,setSnapshot]=useState<{ids:string[];mode:CloseAllMode}>({ids:[],mode:"all"}),[working,setWorking]=useState(false),[error,setError]=useState("");
 const result=room.perpsCloseAll;
 async function execute(order:{ids:string[];mode:CloseAllMode}){
  if(busy||lock.current)return;lock.current=true;setWorking(true);setError("");
  try{await post("/api/finance",{type:"close-all",positionIds:order.ids,mode:order.mode});dialog.current?.close();pending.current=null;}
  catch(e){setError(e instanceof Error?e.message:"Could not confirm the outcome. Reconnect to refresh positions before retrying.");dialog.current?.close();pending.current=null;}
  finally{lock.current=false;setWorking(false);}
 }
 function choose(mode:CloseAllMode){
  if(busy||lock.current||!room.positions.length)return;
  const order={ids:room.positions.map(p=>p.id),mode};setSnapshot(order);pending.current=order;setError("");
  if(menu.current)menu.current.open=false;
  if(room.me.skipCloseConfirmation){void execute(order);return;}
  dialog.current?.showModal();cancel.current?.focus();
 }
 return <div className="perps-close-control"><details ref={menu} className="perps-close-menu"><summary aria-label="Close positions" aria-disabled={busy||working||!room.positions.length} onClick={e=>{if(busy||working||!room.positions.length)e.preventDefault();}}>Close <span aria-hidden="true">▾</span></summary><div className="perps-close-options">{(Object.keys(labels) as CloseAllMode[]).map(mode=><button key={mode} type="button" disabled={busy||working||!room.positions.length} onClick={()=>choose(mode)}>{labels[mode]}</button>)}</div></details>
 {result?<div role="status"><small>{result.closed.length} closed{result.skipped?.length?", "+result.skipped.length+" did not match":""}{result.alreadyClosed.length?", "+result.alreadyClosed.length+" already closed":""}{result.failed.length?". "+result.failed.length+" could not close and remain open where applicable.":". Normal closing fees applied."}</small>{result.failed.map(f=><small key={f.id}>{f.symbol} ({f.id.slice(0,8)}): {f.error}</small>)}</div>:null}
 {error?<small role="alert">{error}</small>:null}
 <dialog ref={dialog} className={styles.dialog} aria-labelledby={title} aria-describedby={description} onCancel={e=>{if(working)e.preventDefault();else pending.current=null;}}>
 <h2 id={title}>{labels[snapshot.mode]} positions?</h2>
 <p id={description}>Checks {snapshot.ids.length} snapshotted positions at the current server price, including normal fees. {snapshot.mode!=="all"?"Only positions with strictly "+(snapshot.mode==="profiting"?"positive":"negative")+" net P/L close. Zero P/L stays open. ":""}This cannot be undone. Unavailable markets stay open and will be listed. Positions opened after this confirmation are not included.</p>
 <div className={styles.actions}><button type="button" disabled={busy||working} onClick={()=>{if(pending.current)void execute(pending.current);}}>{working?"Closing…":labels[snapshot.mode]}</button><button type="button" ref={cancel} className="primary" autoFocus disabled={working} onClick={()=>{pending.current=null;dialog.current?.close();}}>Cancel</button></div>
 </dialog></div>;
}
