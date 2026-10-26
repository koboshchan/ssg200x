"use client";
// Fixture LiveProvider: same hook contract as app/live-provider, one socket.io connection as the cookie fixture account.
import React,{createContext,useCallback,useContext,useEffect,useMemo,useRef,useState} from "react";
import {io,type Socket} from "socket.io-client";
import {readPokerTableId} from "@/lib/poker-table-selection";
export type MaintenanceStatus={admin:boolean;active:boolean;blocked:boolean;manual:boolean};
export type Connection="connecting"|"connected"|"disconnected";
type Live={connection:Connection;maintenance?:MaintenanceStatus;lastMessageAt:number;subscribe:(event:string,handler:(payload:any)=>void)=>()=>void;emit:(event:string,payload?:unknown)=>void;request:(event:string,payload?:unknown)=>Promise<any>};
const Context=createContext<Live|null>(null);
export function useLive(){const v=useContext(Context);if(!v)throw new Error("LiveProvider missing");return v;}
export function useLiveEvent(event:string,handler:(payload:any)=>void){const {subscribe}=useLive(),ref=useRef(handler);ref.current=handler;useEffect(()=>subscribe(event,p=>ref.current(p)),[event,subscribe]);}
const EVENTS=["room:state","market:update","chat:changed","dm:changed","game-chat:closed","poker:taunt","tab:state"];
export default function LiveProvider({children}:{children:React.ReactNode}){
 const [connection,setConnection]=useState<Connection>("connecting");
 const sock=useRef<Socket>(undefined);const listeners=useRef(new Map<string,Set<(p:any)=>void>>());
 useEffect(()=>{
  const s=io({transports:["websocket"]});sock.current=s;
  s.on("connect",()=>{setConnection("connected");s.emit("poker:subscribe",readPokerTableId());});
  s.on("disconnect",()=>setConnection("disconnected"));s.io.on("reconnect_attempt",()=>setConnection("connecting"));
  for(const e of EVENTS)s.on(e,(p:any)=>listeners.current.get(e)?.forEach(h=>h(p)));
  return()=>{s.close();};
 },[]);
 const subscribe=useCallback((event:string,handler:(p:any)=>void)=>{let set=listeners.current.get(event);if(!set)listeners.current.set(event,set=new Set());set.add(handler);return()=>{set!.delete(handler);};},[]);
 const emit=useCallback((event:string,payload?:unknown)=>{sock.current?.emit(event,payload);},[]);
 const request=useCallback((event:string,payload?:unknown)=>new Promise<any>((resolve,reject)=>{
  const s=sock.current;if(!s?.connected)return reject(new Error("disconnected"));
  s.timeout(15000).emit(event,payload,(err:Error|null,res:any)=>{if(err||!res)return reject(new Error("timeout"));if(res.ok===false)return reject(Object.assign(new Error(res.error||"unavailable"),{chatCode:res.error}));resolve(res);});
 }),[]);
 const value=useMemo<Live>(()=>({connection,maintenance:{admin:false,active:false,blocked:false,manual:false},lastMessageAt:0,subscribe,emit,request}),[connection,subscribe,emit,request]);
 return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function ConnectionBadge(){const {connection}=useLive();return <p className="connection-status" role="status" data-state={connection}>{connection==="connected"?"Live":connection==="connecting"?"Connecting…":"Offline"}</p>;}
