"use client";
import {createContext,useContext,useEffect,useMemo,useRef,useState} from "react";
import {useAuth} from "@clerk/nextjs";
import type {Socket} from "socket.io-client";
export type MaintenanceStatus={admin:boolean;active:boolean;blocked:boolean;manual:boolean};
export type Connection="connecting"|"connected"|"disconnected";
/* Server contract (one authenticated socket.io websocket, auth:{token} = fresh Clerk session token):
   room:state PublicRoom, market:update MarketSnapshot, maintenance:state MaintenanceStatus.
   Non-admin blocked by maintenance: middleware rejects with Error("maintenance") (or emits maintenance:state {blocked:true} then disconnects).
   Server disconnects at token expiry; client reconnects with a fresh token. */
type Live={connection:Connection;maintenance?:MaintenanceStatus;lastMessageAt:number;subscribe:(event:string,handler:(payload:any)=>void)=>()=>void;emit:(event:string,payload?:unknown)=>void;request:(event:string,payload?:unknown)=>Promise<any>};
const Context=createContext<Live|null>(null);
export function useLive(){const v=useContext(Context);if(!v)throw new Error("LiveProvider missing");return v;}
export function useLiveEvent(event:string,handler:(payload:any)=>void){const {subscribe}=useLive(),ref=useRef(handler);ref.current=handler;useEffect(()=>subscribe(event,p=>ref.current(p)),[subscribe,event]);}
export default function LiveProvider({children}:{children:React.ReactNode}){
 const {getToken}=useAuth(),tokenRef=useRef(getToken);tokenRef.current=getToken;
 const [connection,setConnection]=useState<Connection>("connecting"),[maintenance,setMaintenance]=useState<MaintenanceStatus>(),[lastMessageAt,setLast]=useState(0);
 const socketRef=useRef<Socket>(undefined),listeners=useRef(new Map<string,Set<(p:any)=>void>>()),latest=useRef(new Map<string,unknown>());
 const api=useMemo(()=>({subscribe(event:string,handler:(p:any)=>void){let set=listeners.current.get(event);if(!set){set=new Set();listeners.current.set(event,set);}set.add(handler);if(latest.current.has(event)&&event!=="market:update")handler(latest.current.get(event));return()=>{set!.delete(handler);};},emit(event:string,payload?:unknown){socketRef.current?.connected&&socketRef.current.emit(event,payload);},request(event:string,payload?:unknown){
   const socket=socketRef.current;
   if(!socket?.connected)return Promise.reject(new Error("disconnected"));
   return new Promise<any>((resolve,reject)=>socket.timeout(15000).emit(event,payload,(err:Error|null,res:{ok:boolean;error?:string}|undefined)=>{
    if(err||!res)reject(new Error("timeout"));else if(!res.ok)reject(new Error(res.error||"unavailable"));else resolve(res);
   }));
  }}),[]);
 useEffect(()=>{
  let closed=false,retry:ReturnType<typeof setTimeout>|undefined,attempts=0,socket:Socket|undefined;
  const dispatch=(event:string,p:unknown)=>{latest.current.set(event,p);setLast(Date.now());listeners.current.get(event)?.forEach(h=>h(p));};
  const later=()=>{if(closed||!socket||socket.active)return;clearTimeout(retry);attempts++;retry=setTimeout(()=>socket?.connect(),Math.min(10000,500*2**Math.min(attempts,5)));};
  import("socket.io-client").then(({io})=>{
   if(closed)return;
   socket=io({path:"/socket.io",transports:["websocket"],reconnection:true,reconnectionDelayMax:10000,auth:cb=>{tokenRef.current({skipCache:true}).then(token=>cb({token}),()=>cb({}));}});
   socketRef.current=socket;
   socket.on("connect",()=>{attempts=0;setConnection("connected");});
   socket.on("disconnect",()=>{setConnection("disconnected");later();});
   socket.on("connect_error",e=>{setConnection("disconnected");if(e.message==="maintenance")setMaintenance(m=>({admin:false,active:true,manual:false,...m,blocked:true}));later();});
   socket.io.on("reconnect_attempt",()=>setConnection("connecting"));
   socket.on("maintenance:state",(p:MaintenanceStatus)=>{setMaintenance(p);dispatch("maintenance:state",p);});
   for(const event of ["room:state","market:update","candles:state","chat:changed"])socket.on(event,(p:unknown)=>dispatch(event,p));
  }).catch(()=>setConnection("disconnected"));
  return()=>{closed=true;clearTimeout(retry);socket?.disconnect();socketRef.current=undefined;};
 },[]);
 const value=useMemo<Live>(()=>({connection,maintenance,lastMessageAt,...api}),[connection,maintenance,lastMessageAt,api]);
 return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function ConnectionBadge(){const {connection}=useLive();return <p className="connection-status" role="status" data-state={connection}>{connection==="connected"?"Live":connection==="connecting"?"Connecting…":"Disconnected. Trading is paused until the connection returns."}</p>;}
