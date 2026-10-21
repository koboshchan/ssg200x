"use client";
import {useId,useRef,useState} from "react";
import styles from "./players-list.module.css";

/** This control receives only a public account reference, never any key material. */
export default function AdminChatReset({publicId,name,disabled=false}:{publicId:string;name:string;disabled?:boolean}){
 const dialog=useRef<HTMLDialogElement>(null),request=useRef<string|null>(null),title=useId();
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[done,setDone]=useState(false);
 async function reset(){
  if(busy)return;setBusy(true);setError("");
  try{
   request.current??=crypto.randomUUID();
   const response=await fetch("/api/admin/chat-reset",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({v:1,publicId,requestId:request.current,requestAt:Date.now(),confirm:true})});
   const data=await response.json();
   if(!response.ok||data.reset!==true)throw Error(data.error||"Reset couldn't finish. Try again.");
   setDone(true);dialog.current?.close();
  }catch(e){setError(e instanceof Error?e.message:"Reset couldn't finish. Try again.");}
  finally{setBusy(false);}
 }
 return <>
  <button disabled={disabled||busy} aria-haspopup="dialog" onClick={()=>{setError("");if(done)request.current=null;setDone(false);dialog.current?.showModal();}}>Reset chat words<span className="sr-only"> for {name}</span></button>
  {done?<small role="status">Chat words reset. New words are required on their next chat visit.</small>:null}
  <dialog ref={dialog} className={styles.dialog} aria-labelledby={title} onCancel={e=>{if(busy)e.preventDefault();}}>
   <h2 id={title}>Reset {name}'s chat words?</h2>
   <p>Their old recovery words and encrypted backup will be invalidated. Every signed-in device must set up new keys. Unsent chat messages on those devices will be discarded, not retried.</p>
   <p>Old history stays locked unless a trusted member grants access again. The current room key is shared only after the new security key is trusted. This does not erase messages already read or copied.</p>
   <p>You cannot see their words or private keys.</p>
   {error?<p role="alert">{error}</p>:null}
   <div className={styles.modalActions}><button autoFocus disabled={busy} onClick={()=>dialog.current?.close()}>Cancel</button><button disabled={busy} onClick={reset}>{busy?"Resetting…":"Reset chat words"}</button></div>
  </dialog>
 </>;
}
