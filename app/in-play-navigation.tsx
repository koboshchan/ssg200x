"use client";
import {useEffect,useRef,useState} from "react";
import {usePathname,useRouter} from "next/navigation";
import {useLiveEvent} from "./live-provider";
import {mergeRoom} from "@/lib/room-sync";
import {internalLeaveTarget,moneyInPlay} from "@/lib/in-play-navigation";
import type {PublicRoom} from "@/lib/public";
import styles from "./in-play-navigation.module.css";

const money=(cents:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:cents%100===0?0:2}).format(cents/100);
type Pending={href:string;from:string;trigger:HTMLAnchorElement};
export default function InPlayNavigation(){
 const pathname=usePathname(),router=useRouter();
 const [room,setRoom]=useState<PublicRoom|null>(null),[pending,setPending]=useState<Pending|null>(null);
 const dialogRef=useRef<HTMLDialogElement>(null),stayRef=useRef<HTMLButtonElement>(null);
 const latest=useRef({room,pathname});
 latest.current={room,pathname};
 useLiveEvent("room:state",(snapshot:PublicRoom)=>{
  if(snapshot&&typeof snapshot.version==="number"){
   // Also update the event-time ref so an immediately following click cannot
   // observe the previous exposure while React schedules its render.
   const next=mergeRoom(latest.current.room,snapshot);
   latest.current={...latest.current,room:next};setRoom(next);
  }
 });
 useEffect(()=>{
  function intercept(event:MouseEvent){
   if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
   const anchor=event.composedPath().find(node=>node instanceof HTMLAnchorElement);
   if(!(anchor instanceof HTMLAnchorElement))return;
   const current=new URL(window.location.href),href=internalLeaveTarget(anchor,current);
   const state=latest.current;
   if(!href||!state.pathname||moneyInPlay(state.room,state.pathname)<=0)return;
   event.preventDefault();event.stopPropagation();
   setPending({href,from:state.pathname,trigger:anchor});
  }
  document.addEventListener("click",intercept,true);
  return()=>document.removeEventListener("click",intercept,true);
 },[]);
 useEffect(()=>{
  const dialog=dialogRef.current;
  if(pending&&pending.from===pathname){if(dialog&&!dialog.open){dialog.showModal();stayRef.current?.focus();}}
  else {dialog?.close();if(pending)setPending(null);}
 },[pending,pathname]);
 useEffect(()=>()=>{dialogRef.current?.close();},[]);
 function dismiss(){
  const trigger=pending?.trigger;
  dialogRef.current?.close();setPending(null);
  if(trigger?.isConnected)trigger.focus();
 }
 function leave(){
  if(!pending||pending.from!==latest.current.pathname){dismiss();return;}
  const href=pending.href;
  dialogRef.current?.close();setPending(null);
  router.push(href);
 }
 const exposure=moneyInPlay(room,pathname);
 return <dialog ref={dialogRef} className={styles.dialog} aria-labelledby="in-play-navigation-title" aria-describedby="in-play-navigation-description" onCancel={event=>{event.preventDefault();dismiss();}} onClose={()=>setPending(null)}>
  <h2 id="in-play-navigation-title">You have {money(exposure)} in play, leave anyway?</h2>
  <p id="in-play-navigation-description">Leaving this page does not cash out or cancel your bets.</p>
  <div className={styles.actions}><button onClick={leave}>Leave</button><button ref={stayRef} className="primary" autoFocus onClick={dismiss}>Stay</button></div>
 </dialog>;
}
