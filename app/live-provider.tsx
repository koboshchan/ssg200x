"use client";
import {createContext,useContext,useEffect,useMemo,useRef,useState} from "react";
import {useAuth} from "@clerk/nextjs";
import type {Socket} from "socket.io-client";
export type MaintenanceStatus={admin:boolean;active:boolean;blocked:boolean;manual:boolean;backfill:boolean};
export type HistoryStatus={status:string;reason?:string;source:string;overall:{done:number;total:number;percent:number;etaSeconds:number|null};symbols:{symbol:string;done:number;total:number;percent:number;unavailable:boolean;monthsDone:number;monthsTotal:number;daysDone:number;daysTotal:number;currentSource:string;etaSeconds:number|null}[]};
export type Connection="connecting"|"connected"|"disconnected";
/* Server contract (one authenticated socket.io websocket, auth:{token} = fresh Clerk session token):
   room:state PublicRoom, market:update MarketSnapshot, maintenance:state MaintenanceStatus, history:state HistoryStatus (admins).
   Non-admin blocked by maintenance: middleware rejects with Error("maintenance") (or emits maintenance:state {blocked:true} then disconnects).
   Server disconnects at token expiry; client reconnects with a fresh token. */
type Live={connection:Connection;maintenance?:MaintenanceStatus;history?:HistoryStatus;historyVersion:number;lastMessageAt:number;subscribe:(event:string,handler:(payload:any)=>void)=>()=>void;emit:(event:string,payload?:unknown)=>void};
const Context=createContext<Live|null>(null);
export function useLive(){const v=useContext(Context);if(!v)throw new Error("LiveProvider missing");return v;}
export function useLiveEvent(event:string,handler:(payload:any)=>void){const live=useLive(),ref=useRef(handler);ref.current=handler;useEffect(()=>live.subscribe(event,p=>ref.current(p)),[live,event]);}
export default function LiveProvider({children}:{children:React.ReactNode}){
 const {getToken}=useAuth(),tokenRef=useRef(getToken);tokenRef.current=getToken;
 const [connection,setConnection]=useState<Connection>("connecting"),[maintenance,setMaintenance]=useState<MaintenanceStatus>(),[history,setHistory]=useState<HistoryStatus>(),[historyVersion,setHistoryVersion]=useState(0),[lastMessageAt,setLast]=useState(0);
 const socketRef=useRef<Socket>(undefined),listeners=useRef(new Map<string,Set<(p:any)=>void>>()),pending=useRef<[string,unknown][]>([]);
 const api=useMemo(()=>({subscribe(event:string,handler:(p:any)=>void){let set=listeners.current.get(event);if(!set){set=new Set();listeners.current.set(event,set);}set.add(handler);return()=>{set!.delete(handler);};},emit(event:string,payload?:unknown){socketRef.current?.connected&&socketRef.current.emit(event,payload);}}),[]);
 useEffect(()=>{
  let closed=false,retry:ReturnType<typeof setTimeout>|undefined,attempts=0,socket:Socket|undefined;
  const dispatch=(event:string,p:unknown)=>{setLast(Date.now());listeners.current.get(event)?.forEach(h=>h(p));};
  const later=()=>{if(closed||!socket||socket.active)return;clearTimeout(retry);attempts++;retry=setTimeout(()=>socket?.connect(),Math.min(10000,500*2**Math.min(attempts,5)));};
  import("socket.io-client").then(({io})=>{
   if(closed)return;
   socket=io({path:"/socket.io",transports:["websocket"],reconnection:true,reconnectionDelayMax:10000,auth:cb=>{tokenRef.current({skipCache:true}).then(token=>cb({token}),()=>cb({}));}});
   socketRef.current=socket;
   socket.on("connect",()=>{attempts=0;setConnection("connected");});
   socket.on("disconnect",()=>{setConnection("disconnected");later();});
   socket.on("connect_error",e=>{setConnection("disconnected");if(e.message==="maintenance")setMaintenance(m=>({admin:false,active:true,manual:false,backfill:false,...m,blocked:true}));later();});
   socket.io.on("reconnect_attempt",()=>setConnection("connecting"));
   socket.on("maintenance:state",(p:MaintenanceStatus)=>{setMaintenance(p);dispatch("maintenance:state",p);});
   socket.on("history:state",(p:HistoryStatus)=>{setHistory(p);setHistoryVersion(v=>v+1);dispatch("history:state",p);});
   for(const event of ["room:state","market:update"])socket.on(event,(p:unknown)=>dispatch(event,p));
  }).catch(()=>setConnection("disconnected"));
  return()=>{closed=true;clearTimeout(retry);socket?.disconnect();socketRef.current=undefined;};
 },[]);
 const value=useMemo<Live>(()=>({connection,maintenance,history,historyVersion,lastMessageAt,...api}),[connection,maintenance,history,historyVersion,lastMessageAt,api]);
 return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function ConnectionBadge(){const {connection}=useLive();return <p className="connection-status" role="status" data-state={connection}>{connection==="connected"?"Live":connection==="connecting"?"Connecting…":"Disconnected. Trading is paused until the connection returns."}</p>;}
