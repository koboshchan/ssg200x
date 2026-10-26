"use client";
import {useQaFixture} from "./qa-fixture-provider";
import {useRelease} from "./release-provider";
import {RELEASE_EVENT} from "../runtime/release.mjs";
import {attachSocketAuthClient} from "../runtime/socket-auth.mjs";
import PaymentAnnouncement from "./payment-announcement";
import CheckInBanner from "./check-in-banner";
import {useFeatures} from "./use-features";
import type {FeatureKey} from "@/lib/feature-catalog";
import AdvancementAnnouncement from "./advancement-announcement";
import AirdropAnnouncement from "./airdrop-announcement";
import {AIRDROP_EVENT,createAirdropReceiver} from "../runtime/airdrop-events.mjs";
import {createContext,useContext,useEffect,useMemo,useRef,useState} from "react";
import {usePathname} from "next/navigation";
import {getTabIdentity} from "@/lib/tab-identity";
import {readPokerTableId} from "@/lib/poker-table-selection";
import {useAuth} from "@clerk/nextjs";
import {createStateReceiver,STATE_STREAMS} from "../runtime/state-stream.mjs";
import {createLeaseReadiness} from "@/lib/lease-readiness";
import type {Socket} from "socket.io-client";
export type MaintenanceStatus={admin:boolean;active:boolean;blocked:boolean;manual:boolean};
export type Connection="connecting"|"connected"|"disconnected";
/* Server contract (one authenticated socket.io websocket, auth:{token,tabId,tabProof,route} = fresh Clerk token and document identity):
   State events carry full/diff envelopes, decoded here before notifying subscribers.
   room:state PublicRoom, market:update MarketSnapshot, maintenance:state MaintenanceStatus.
   Non-admin blocked by maintenance: middleware rejects with Error("maintenance") (or emits maintenance:state {blocked:true} then disconnects).
   Credentials renew in place before expiry; missing/invalid refresh still disconnects at the verified deadline. */
type Live={connection:Connection;maintenance?:MaintenanceStatus;lastMessageAt:number;subscribe:(event:string,handler:(payload:any)=>void)=>()=>void;emit:(event:string,payload?:unknown)=>void;request:(event:string,payload?:unknown)=>Promise<any>};
const Context=createContext<Live|null>(null);
export function useLive(){const v=useContext(Context);if(!v)throw new Error("LiveProvider missing");return v;}
export function useLiveEvent(event:string,handler:(payload:any)=>void){const {subscribe}=useLive(),ref=useRef(handler);ref.current=handler;useEffect(()=>subscribe(event,p=>ref.current(p)),[subscribe,event]);}
export default function LiveProvider({children}:{children:React.ReactNode}){
 const release=useRelease();
 const pathname=usePathname(),routeRef=useRef(pathname||"/");routeRef.current=pathname||"/";
 const [tabBlocked,setTabBlocked]=useState(false);
 const {getToken}=useAuth(),tokenRef=useRef(getToken);tokenRef.current=getToken;
 const [transport,setTransport]=useState<Connection>("connecting"),[leaseFresh,setLeaseFresh]=useState(false),reportRef=useRef<()=>void>(()=>{}),[maintenance,setMaintenance]=useState<MaintenanceStatus>(),[lastMessageAt,setLast]=useState(0);
 const airdropReceiver=useRef<ReturnType<typeof createAirdropReceiver>|null>(null);
 const socketRef=useRef<Socket>(undefined),listeners=useRef(new Map<string,Set<(p:any)=>void>>()),latest=useRef(new Map<string,unknown>());
 // Transport "connected" is only action-ready while the server has acknowledged a recent tab:report.
 const connection:Connection=transport==="connected"&&!leaseFresh?"connecting":transport;
 const api=useMemo(()=>({subscribe(event:string,handler:(p:any)=>void){let set=listeners.current.get(event);if(!set){set=new Set();listeners.current.set(event,set);}set.add(handler);if(latest.current.has(event)&&event!=="market:update")handler(latest.current.get(event));return()=>{set!.delete(handler);};},emit(event:string,payload?:unknown){socketRef.current?.connected&&socketRef.current.emit(event,payload);},request(event:string,payload?:unknown){
   const socket=socketRef.current;
   if(!socket?.connected)return Promise.reject(new Error("disconnected"));
   return new Promise<any>((resolve,reject)=>socket.timeout(15000).emit(event,payload,(err:Error|null,res:{ok:boolean;error?:string;retryAfter?:number;retryAfterUnit?:string;retryAfterMs?:number}|undefined)=>{
    if(err||!res)reject(new Error("timeout"));else if(!res.ok)reject(Object.assign(new Error(res.error||"unavailable"),{retryAfter:res.retryAfter,retryAfterUnit:res.retryAfterUnit,retryAfterMs:res.retryAfterMs}));else resolve(res);
   }));
  }}),[]);
 useEffect(()=>{
  reportRef.current();
 },[pathname]);
 useEffect(()=>{
  let closed=false,paused=false,authGeneration=0,retry:ReturnType<typeof setTimeout>|undefined,attempts=0,socket:Socket|undefined,disposeAuth:(()=>void)|undefined;
  const dispatch=(event:string,p:unknown)=>{if(event!==AIRDROP_EVENT&&event!=="poker:taunt")latest.current.set(event,p);setLast(Date.now());listeners.current.get(event)?.forEach(h=>h(p));};
  airdropReceiver.current??=createAirdropReceiver(p=>listeners.current.get(AIRDROP_EVENT)?.forEach(h=>h(p)));
  const receiver=createStateReceiver(event=>socket?.connected&&socket.emit("state:resync",event));
  const later=()=>{if(closed||paused||!socket||socket.active)return;clearTimeout(retry);attempts++;retry=setTimeout(()=>{if(!closed&&!paused)socket?.connect();},Math.min(10000,500*2**Math.min(attempts,5)));};
  const lease=createLeaseReadiness({now:()=>performance.now(),recover:()=>{if(closed||paused||!socket)return;socket.disconnect();socket.connect();}});
  const report=()=>{
   if(paused||!socket?.connected)return;
   const token=lease.sending();
   // Servers without the ack contract never call back, so the connection simply never becomes action-ready.
   socket.emit("tab:report",{route:routeRef.current},(res:unknown)=>{if(!closed&&lease.ack(token,res))setLeaseFresh(lease.fresh());});
  };
  reportRef.current=report;
  const reportTimer=setInterval(report,5000);
  const leaseTimer=setInterval(()=>{if(closed||paused)return;const fresh=lease.fresh();setLeaseFresh(f=>f===fresh?f:fresh);lease.check();},1000);
  document.addEventListener("visibilitychange",report);
  // A cached document keeps React mounted. Stop transport/retries and pending
  // credential renewals before it freezes; resume once with fresh handshake auth.
  const pause=()=>{
   if(closed||paused)return;
   paused=true;authGeneration++;clearTimeout(retry);disposeAuth?.();disposeAuth=undefined;
   receiver.clear();latest.current.clear();setTransport("disconnected");lease.closed();setLeaseFresh(false);socket?.disconnect();
  };
  const resume=()=>{
   if(closed)return;
   if(!paused){report();return;}
   paused=false;
   if(socket){disposeAuth=attachSocketAuthClient(socket,()=>tokenRef.current({skipCache:true}));setTransport("connecting");socket.connect();}
  };
  window.addEventListener("pagehide",pause);
  window.addEventListener("pageshow",resume);
  import("socket.io-client").then(({io})=>{
   if(closed)return;
   socket=io({path:"/socket.io",transports:["websocket"],autoConnect:false,reconnection:true,reconnectionDelayMax:10000,auth:cb=>{
    const generation=authGeneration;
    tokenRef.current({skipCache:true}).then(token=>{if(!closed&&!paused&&generation===authGeneration)cb({token,...getTabIdentity(),route:routeRef.current,pokerTableId:readPokerTableId()});}).catch(()=>{if(!closed&&!paused&&generation===authGeneration)cb({});});
   }});
   socketRef.current=socket;
   socket.on(RELEASE_EVENT,release.observe);socket.on("features:state",release.observeFeatures);
   if(!paused)disposeAuth=attachSocketAuthClient(socket,()=>tokenRef.current({skipCache:true}));
   socket.on("connect",()=>{receiver.clear();latest.current.clear();void release.check();attempts=0;lease.opened();setLeaseFresh(false);setTransport("connected");socket?.emit("poker:subscribe",readPokerTableId());report();});
   socket.on("disconnect",()=>{receiver.clear();latest.current.clear();lease.closed();setLeaseFresh(false);setTransport("disconnected");later();});
   socket.on("connect_error",e=>{void release.check();lease.closed();setLeaseFresh(false);setTransport("disconnected");if(e.message==="maintenance")setMaintenance(m=>({admin:false,active:true,manual:false,...m,blocked:true}));later();});
   socket.io.on("reconnect_attempt",()=>setTransport("connecting"));
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
   socket.on("poker:taunt",(p:unknown)=>dispatch("poker:taunt",p));
   // TableTalk's encrypted protocol and invalidation hints stay untouched.
   socket.on("chat:changed",(p:unknown)=>dispatch("chat:changed",p));
   // Payload-free hint that a direct message or block changed for this user.
   socket.on("polymarket:price",(p:unknown)=>dispatch("polymarket:price",p));
   socket.on("polymarket:positions",(p:unknown)=>dispatch("polymarket:positions",p));
   socket.on("dm:changed",(p:unknown)=>dispatch("dm:changed",p));
   if(!paused)socket.connect();
  }).catch(()=>{if(!closed)setTransport("disconnected");});
  return()=>{closed=true;lease.closed();reportRef.current=()=>{};authGeneration++;clearInterval(reportTimer);clearInterval(leaseTimer);document.removeEventListener("visibilitychange",report);window.removeEventListener("pagehide",pause);window.removeEventListener("pageshow",resume);receiver.clear();latest.current.clear();clearTimeout(retry);disposeAuth?.();socket?.disconnect();socketRef.current=undefined;};
 },[release]);
 const value=useMemo<Live>(()=>({connection,maintenance,lastMessageAt,...api}),[connection,maintenance,lastMessageAt,api]);
 return <Context.Provider value={value}>{children}<AirdropAnnouncement subscribe={api.subscribe}/><AdvancementAnnouncement subscribe={api.subscribe}/><FlagGated k="checkIn"><CheckInBanner/></FlagGated><PaymentAnnouncement subscribe={api.subscribe}/>{tabBlocked?<TabBlockedOverlay/>:null}</Context.Provider>;
}
export function ConnectionBadge(){const fixture=useQaFixture();const {connection}=useLive();/* Fixture warning belongs to charts; the badge always shows the real transport. */return <p className="connection-status" role="status" data-state={connection} data-qa-fixture={fixture?"true":undefined}>{connection==="connected"?"Live":connection==="connecting"?"Connecting…":"Disconnected. Trading is paused until the connection returns."}</p>;}

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

function FlagGated({k,children}:{k:FeatureKey;children:React.ReactNode}){const {features}=useFeatures();return features[k]===false?null:<>{children}</>;}
