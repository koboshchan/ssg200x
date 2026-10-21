"use client";
import {useEffect} from "react";
let pending:Promise<string>|undefined;
function deviceHash(){
 return pending??=import("@fingerprintjs/fingerprintjs").then(async FingerprintJS=>{
  // v4.6.2 supports monitoring at runtime, but omits it from LoadOptions.
  const options={monitoring:false,debug:false};
  const agent=await FingerprintJS.load(options);
  const {visitorId}=await agent.get();
  const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(visitorId));
  return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,"0")).join("");
 }).catch(e=>{pending=undefined;throw e;});
}
export default function DeviceFingerprint({userId}:{userId:string}){
 useEffect(()=>{
  let cancelled=false;
  const controller=new AbortController(),key="ssg-device-report-v1:"+userId;
  async function report(){
   // Only a per-account last-report timestamp is cached; never raw components or visitorId.
   try{if(Date.now()-Number(sessionStorage.getItem(key)||0)<30*60*1000)return;}catch{}
   try{
    const hash=await deviceHash();
    if(cancelled)return;
    const response=await fetch("/api/device-fingerprint",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({hash}),signal:controller.signal});
    if(response.ok)try{sessionStorage.setItem(key,String(Date.now()));}catch{}
   }catch{/* Advisory only: unavailable APIs, blockers and network failures never gate play. */}
  }
  void report();
  const timer=setInterval(()=>void report(),30*60*1000);
  return ()=>{cancelled=true;controller.abort();clearInterval(timer);};
 },[userId]);
 return null;
}
