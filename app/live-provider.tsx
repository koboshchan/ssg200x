"use client";
import AirdropAnnouncement from "./airdrop-announcement";
import {AIRDROP_EVENT,createAirdropReceiver} from "../runtime/airdrop-events.mjs";
import {createContext,useContext,useEffect,useMemo,useRef,useState} from "react";
import {usePathname} from "next/navigation";
import {getTabIdentity} from "@/lib/tab-identity";
import {useAuth} from "@clerk/nextjs";
import {createStateReceiver,STATE_STREAMS} from "../runtime/state-stream.mjs";
import type {Socket} from "socket.io-client";
export type MaintenanceStatus={admin:boolean;active:boolean;blocked:boolean;manual:boolean};
export type Connection="connecting"|"connected"|"disconnected";
/* Server contract (one authenticated socket.io websocket, auth:{token,tabId,tabProof,route} = fresh Clerk token and document identity):
   State events carry full/diff envelopes, decoded here before notifying subscribers.
   room:state PublicRoom, market:update MarketSnapshot, maintenance:state MaintenanceStatus.
   Non-admin blocked by maintenance: middleware rejects with Error("maintenance") (or emits maintenance:state {blocked:true} then disconnects).
   Server disconnects at token expiry; client reconnects with a fresh token. */
type Live={connection:Connection;maintenance?:MaintenanceStatus;lastMessageAt:number;subscribe:(event:string,handler:(payload:any)=>void)=>()=>void;emit:(event:string,payload?:unknown)=>void;request:(event:string,payload?:unknown)=>Promise<any>};
const Context=createContext<Live|null>(null);
export function useLive(){const v=useContext(Context);if(!v)throw new Error("LiveProvider missing");return v;}
export function useLiveEvent(event:string,handler:(payload:any)=>void){const {subscribe}=useLive(),ref=useRef(handler);ref.current=handler;useEffect(()=>subscribe(event,p=>ref.current(p)),[subscribe,event]);}
export default function LiveProvider({children}:{children:React.ReactNode}){
 const pathname=usePathname(),routeRef=useRef(pathname||"/");routeRef.current=pathname||"/";
 const [tabBlocked,setTabBlocked]=useState(false);
 const {getToken}=useAuth(),tokenRef=useRef(getToken);tokenRef.current=getToken;
 const [connection,setConnection]=useState<Connection>("connecting"),[maintenance,setMaintenance]=useState<MaintenanceStatus>(),[lastMessageAt,setLast]=useState(0);
 const airdropReceiver=useRef<ReturnType<typeof createAirdropReceiver>|null>(null);
 const socketRef=useRef<Socket>(undefined),listeners=useRef(new Map<string,Set<(p:any)=>void>>()),latest=useRef(new Map<string,unknown>());
 const api=useMemo(()=>({subscribe(event:string,handler:(p:any)=>void){let set=listeners.current.get(event);if(!set){set=new Set();listeners.current.set(event,set);}set.add(handler);if(latest.current.has(event)&&event!=="market:update")handler(latest.current.get(event));return()=>{set!.delete(handler);};},emit(event:string,payload?:unknown){socketRef.current?.connected&&socketRef.current.emit(event,payload);},request(event:string,payload?:unknown){
   const socket=socketRef.current;
   if(!socket?.connected)return Promise.reject(new Error("disconnected"));
   return new Promise<any>((resolve,reject)=>socket.timeout(15000).emit(event,payload,(err:Error|null,res:{ok:boolean;error?:string;retryAfter?:number;retryAfterUnit?:string;retryAfterMs?:number}|undefined)=>{
    if(err||!res)reject(new Error("timeout"));else if(!res.ok)reject(Object.assign(new Error(res.error||"unavailable"),{retryAfter:res.retryAfter,retryAfterUnit:res.retryAfterUnit,retryAfterMs:res.retryAfterMs}));else resolve(res);
   }));
  }}),[]);
 useEffect(()=>{
  if(socketRef.current?.connected)socketRef.current.emit("tab:report",{route:routeRef.current});
 },[pathname]);
 useEffect(()=>{
  let closed=false,retry:ReturnType<typeof setTimeout>|undefined,attempts=0,socket:Socket|undefined;
  const dispatch=(event:string,p:unknown)=>{if(event!==AIRDROP_EVENT)latest.current.set(event,p);setLast(Date.now());listeners.current.get(event)?.forEach(h=>h(p));};
  airdropReceiver.current??=createAirdropReceiver(p=>listeners.current.get(AIRDROP_EVENT)?.forEach(h=>h(p)));
  const receiver=createStateReceiver(event=>socket?.connected&&socket.emit("state:resync",event));
  const later=()=>{if(closed||!socket||socket.active)return;clearTimeout(retry);attempts++;retry=setTimeout(()=>socket?.connect(),Math.min(10000,500*2**Math.min(attempts,5)));};
  const report=()=>{if(socket?.connected)socket.emit("tab:report",{route:routeRef.current});};
  const reportTimer=setInterval(report,5000);
  document.addEventListener("visibilitychange",report);
  window.addEventListener("pageshow",report);
  import("socket.io-client").then(({io})=>{
   if(closed)return;
   socket=io({path:"/socket.io",transports:["websocket"],reconnection:true,reconnectionDelayMax:10000,auth:cb=>{tokenRef.current({skipCache:true}).then(token=>cb({token,...getTabIdentity(),route:routeRef.current}),()=>cb({}));}});
   socketRef.current=socket;
   socket.on("connect",()=>{receiver.clear();latest.current.clear();attempts=0;setConnection("connected");report();});
   socket.on("disconnect",()=>{receiver.clear();latest.current.clear();setConnection("disconnected");later();});
   socket.on("connect_error",e=>{setConnection("disconnected");if(e.message==="maintenance")setMaintenance(m=>({admin:false,active:true,manual:false,...m,blocked:true}));later();});
   socket.io.on("reconnect_attempt",()=>setConnection("connecting"));
   for(const event of STATE_STREAMS)socket.on(event,(message:unknown)=>{
    const result=receiver.receive(event,message);if(!result.ok)return;
    if(event==="maintenance:state")setMaintenance(result.value as MaintenanceStatus);
    dispatch(event,result.value);
   });
   socket.on("tab:state",(state:{blocked?:unknown;tabs?:unknown}|null)=>{
    if(state&&typeof state.blocked==="boolean"&&typeof state.tabs==="number"&&Number.isSafeInteger(state.tabs)&&state.tabs>=0){
     setTabBlocked(state.blocked);
     dispatch("tab:state",state);
    }
   });
   socket.on(AIRDROP_EVENT,(p:unknown)=>airdropReceiver.current?.(p));
   // TableTalk's encrypted protocol and invalidation hints stay untouched.
   socket.on("chat:changed",(p:unknown)=>dispatch("chat:changed",p));
  }).catch(()=>setConnection("disconnected"));
  return()=>{closed=true;clearInterval(reportTimer);document.removeEventListener("visibilitychange",report);window.removeEventListener("pageshow",report);receiver.clear();latest.current.clear();clearTimeout(retry);socket?.disconnect();socketRef.current=undefined;};
 },[]);
 const value=useMemo<Live>(()=>({connection,maintenance,lastMessageAt,...api}),[connection,maintenance,lastMessageAt,api]);
 return <Context.Provider value={value}>{children}<AirdropAnnouncement subscribe={api.subscribe}/>{tabBlocked?<TabBlockedOverlay/>:null}</Context.Provider>;
}
export function ConnectionBadge(){const {connection}=useLive();return <p className="connection-status" role="status" data-state={connection}>{connection==="connected"?"Live":connection==="connecting"?"Connecting…":"Disconnected. Trading is paused until the connection returns."}</p>;}

function TabBlockedOverlay(){
 const dialogRef=useRef<HTMLDialogElement>(null);
 useEffect(()=>{
  const dialog=dialogRef.current;
  dialog?.showModal();
  return()=>{dialog?.close();};
 },[]);
 return <dialog ref={dialogRef} aria-modal="true" aria-labelledby="tab-blocked-title" aria-describedby="tab-blocked-description" onCancel={event=>event.preventDefault()}
  style={{position:"fixed",inset:0,margin:0,width:"100vw",height:"100dvh",maxWidth:"none",maxHeight:"none",border:0,padding:24,background:"var(--paper)",color:"var(--ink)"}}>
  <div style={{minHeight:"100%",display:"grid",placeContent:"center",textAlign:"center"}}>
   <h1 id="tab-blocked-title" tabIndex={-1} autoFocus style={{fontSize:"clamp(28px,5vw,40px)",letterSpacing:"-.03em",margin:"0 0 14px"}}>Only one tab is allowed.</h1>
   <p id="tab-blocked-description" style={{color:"var(--muted)",margin:0,lineHeight:1.6}}>Close the other tabs.</p>
  </div>
 </dialog>;
}
