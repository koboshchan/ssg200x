"use client";
import {useEffect} from "react";
import {useRouter} from "next/navigation";
// The public page has no authenticated socket. Refresh its server-rendered
// snapshot while visible instead of caching Clerk labels in the browser.
export default function RefreshNames(){
 const router=useRouter();
 useEffect(()=>{
  const refresh=()=>{if(document.visibilityState==="visible")router.refresh();};
  const timer=setInterval(refresh,10_000);
  document.addEventListener("visibilitychange",refresh);
  return()=>{clearInterval(timer);document.removeEventListener("visibilitychange",refresh);};
 },[router]);
 return null;
}
