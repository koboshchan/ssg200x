"use client";
import {useEffect,useMemo,useReducer,useRef} from "react";
import {PendingFinanceController} from "@/lib/pending-finance";
import {getTabHeaders} from "@/lib/tab-identity";
import type {PublicRoom} from "@/lib/public";
// A route remount shares the in-flight controller. A reload restores its saved intent.
const controllers=new Map<string,{controller:PendingFinanceController;listeners:Set<()=>void>;room:((r:PublicRoom)=>void)|null}>();
export function usePendingFinance(userId:string|undefined,connected:boolean,onRoom:(room:PublicRoom)=>void){
 const [,render]=useReducer(n=>n+1,0),roomRef=useRef(onRoom);roomRef.current=onRoom;
 const entry=useMemo(()=>{
  if(!userId||typeof window==="undefined")return null;
  let entry=controllers.get(userId);
  if(!entry){
   const state={listeners:new Set<()=>void>(),room:null as ((r:PublicRoom)=>void)|null};
   const controller=new PendingFinanceController({storage:{getItem:key=>window.sessionStorage.getItem(key),setItem:(key,value)=>window.sessionStorage.setItem(key,value),removeItem:key=>window.sessionStorage.removeItem(key)},key:"ssg-finance-v1:"+userId,fetch:(...args)=>fetch(...args),headers:getTabHeaders,room:r=>state.room?.(r),change:()=>state.listeners.forEach(f=>f())});
   entry=Object.assign(state,{controller});controllers.set(userId,entry);
  }
  return entry;
 },[userId]);
 useEffect(()=>{
  if(!entry)return;
  const room=(r:PublicRoom)=>roomRef.current(r);entry.room=room;entry.listeners.add(render);
  return()=>{entry.listeners.delete(render);if(entry.room===room)entry.room=null;};
 },[entry]);
 useEffect(()=>{entry?.controller.connection(connected);return()=>entry?.controller.connection(false);},[entry,connected]);
 useEffect(()=>{
  if(!entry||!connected)return;
  const timer=setInterval(()=>{if(!entry.controller.ready&&!entry.controller.working)void entry.controller.sync();},5000);
  return()=>clearInterval(timer);
 },[entry,connected]);
 return entry?.controller??null;
}
