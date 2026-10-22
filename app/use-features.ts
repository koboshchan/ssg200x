"use client";
import {useEffect,useSyncExternalStore} from "react";
import {FEATURE_DEFAULTS,type FeatureKey} from "@/lib/feature-catalog";
type Flags=Record<FeatureKey,boolean>;
const POLL_MS=15_000;
let state:Flags={...FEATURE_DEFAULTS},loaded=false,timer:ReturnType<typeof setInterval>|null=null,inflight=false;
const subs=new Set<()=>void>();
function emit(){for(const s of subs)s();}
export async function refreshFeatures(){
 if(inflight)return;inflight=true;
 try{const r=await fetch("/api/features",{cache:"no-store"});if(!r.ok)return;
  const j=await r.json() as {features?:Partial<Record<string,boolean>>};
  const next={...FEATURE_DEFAULTS};
  for(const k of Object.keys(FEATURE_DEFAULTS) as FeatureKey[])if(typeof j.features?.[k]==="boolean")next[k]=j.features[k] as boolean;
  loaded=true;
  if((Object.keys(next) as FeatureKey[]).some(k=>next[k]!==state[k])){state=next;emit();}else if(!loaded)emit();
 }catch{/* keep last known flags */}finally{inflight=false;}
}
function subscribe(cb:()=>void){
 subs.add(cb);
 if(subs.size===1){void refreshFeatures();timer=setInterval(()=>{if(document.visibilityState!=="hidden")void refreshFeatures();},POLL_MS);}
 return()=>{subs.delete(cb);if(!subs.size&&timer){clearInterval(timer);timer=null;}};
}
export function useFeatures(){
 const features=useSyncExternalStore(subscribe,()=>state,()=>FEATURE_DEFAULTS as Flags);
 useEffect(()=>{const on=()=>void refreshFeatures();window.addEventListener("focus",on);return()=>window.removeEventListener("focus",on);},[]);
 return {features,enabled:(...keys:FeatureKey[])=>keys.every(k=>features[k]!==false)};
}
