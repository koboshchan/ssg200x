"use client";
import {useRef,useState,useId} from "react";
import type {PublicRoom} from "@/lib/public";
import styles from "./in-play-navigation.module.css";
type Props={room:PublicRoom;busy:boolean;post:(path:string,body:object)=>Promise<void>};
export default function PerpsCloseAll({room,busy,post}:Props){
 const dialog=useRef<HTMLDialogElement>(null),lock=useRef(false),title=useId(),description=useId();
 const [ids,setIds]=useState<string[]>([]),[working,setWorking]=useState(false),[error,setError]=useState("");
 const result=room.perpsCloseAll;
 function open(){setIds(room.positions.map(p=>p.id));setError("");dialog.current?.showModal();}
 async function confirm(){
  if(busy||lock.current)return;lock.current=true;setWorking(true);setError("");
  try{await post("/api/finance",{type:"close-all",positionIds:ids});dialog.current?.close();}
  catch(e){setError(e instanceof Error?e.message:"Could not confirm the outcome. Reconnect to refresh positions before retrying.");dialog.current?.close();}
  finally{lock.current=false;setWorking(false);}
 }
 return <div><button type="button" disabled={busy||working||!room.positions.length} onClick={open}>Close all</button>
 {result?<div role="status"><small>{result.closed.length} closed{result.alreadyClosed.length?", "+result.alreadyClosed.length+" already closed":""}{result.failed.length?". "+result.failed.length+" could not close and remain open where applicable.":". Normal closing fees applied."}</small>{result.failed.map(f=><small key={f.id}>{f.symbol} ({f.id.slice(0,8)}): {f.error}</small>)}</div>:null}
 {error?<small role="alert">{error}</small>:null}
 <dialog ref={dialog} className={styles.dialog} aria-labelledby={title} aria-describedby={description} onCancel={e=>{if(working)e.preventDefault();}}>
 <h2 id={title}>Close all {ids.length} open positions?</h2>
 <p id={description}>Positions close at the current server price, with their normal closing fees. This cannot be undone. Unavailable markets stay open and will be listed. Positions opened after this confirmation are not included.</p>
 <div className={styles.actions}><button type="button" disabled={busy||working} onClick={confirm}>{working?"Closing…":"Close all positions"}</button><button type="button" className="primary" autoFocus disabled={working} onClick={()=>dialog.current?.close()}>Cancel</button></div>
 </dialog></div>;
}
