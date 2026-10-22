"use client";
import {createContext,useContext,useEffect,useMemo,useRef,useState} from "react";
import {createReleaseObserver} from "../runtime/release.mjs";
import {createFeatureRevisionObserver} from "../runtime/feature-revision.mjs";
import styles from "./release-provider.module.css";
const CLIENT_RELEASE=process.env.NEXT_PUBLIC_SSG_RELEASE!;
type ReleaseContext={observe:(payload:unknown)=>void;observeFeatures:(payload:unknown)=>void;check:()=>Promise<void>};
const Context=createContext<ReleaseContext|null>(null);
export function useRelease(){const context=useContext(Context);if(!context)throw new Error("ReleaseProvider missing");return context;}
export default function ReleaseProvider({children}:{children:React.ReactNode}){
 const [stale,setStale]=useState(false),[featuresChanged,setFeaturesChanged]=useState(false);
 const api=useMemo<ReleaseContext>(()=>{
  const observe=createReleaseObserver(CLIENT_RELEASE,()=>setStale(true));
  let pending:Promise<void>|undefined;
  const observeFeatures=createFeatureRevisionObserver(()=>setFeaturesChanged(true));
  return {observe,observeFeatures,check(){
   // Share overlapping initial/focus/reconnect checks. Failures are not evidence
   // of a mismatch; the next reconnect/focus/interval will retry.
   return pending??=fetch("/api/release",{cache:"no-store",credentials:"same-origin",signal:AbortSignal.timeout(8000)})
    .then(async response=>{if(response.ok)observe(await response.json());})
    .catch(()=>{}).finally(()=>{pending=undefined;});
  }};
 },[]);
 useEffect(()=>{
  const check=()=>{void api.check();};
  const visible=()=>{if(document.visibilityState==="visible")check();};
  check();
  window.addEventListener("online",check);
  window.addEventListener("pageshow",check);
  document.addEventListener("visibilitychange",visible);
  const timer=setInterval(visible,60000);
  return()=>{clearInterval(timer);window.removeEventListener("online",check);window.removeEventListener("pageshow",check);document.removeEventListener("visibilitychange",visible);};
 },[api]);
 return <Context.Provider value={api}>{children}{stale||featuresChanged?<RefreshRequired features={!stale}/>:null}</Context.Provider>;
}
function RefreshRequired({features}:{features?:boolean}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const dialog=ref.current;dialog?.showModal();return()=>dialog?.close();},[]);
 return <dialog ref={ref} className={styles.dialog} aria-modal="true" aria-labelledby="release-title" aria-describedby="release-description" onCancel={event=>event.preventDefault()}>
  <h2 id="release-title">Refresh to continue</h2>
  <p id="release-description">{features?"Site features were changed by an admin. Refresh this page to get the latest version.":"The site has been updated. Refresh this page to use the latest version."}</p>
  <p className={styles.note}>Your saved recovery words and pending transaction records will stay on this device.</p>
  <button className="primary" autoFocus onClick={()=>window.location.reload()}>Refresh page</button>
 </dialog>;
}
