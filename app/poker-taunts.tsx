"use client";
import {createContext,useContext,useEffect,useRef,useState,type ReactNode,type RefObject,CSSProperties} from "react";
import {useLive,useLiveEvent} from "./live-provider";
import type {PublicRoom} from "../lib/public";
const EMOTES={laugh:["😂","Laugh"],cry:["😭","Cry"],wow:["😮","Wow"],think:["🤔","Thinking"],nice:["👏","Nice hand"],oops:["🙈","Oops"]} as const;
type Effect={tableId?:string;id:string;kind:"emote"|"throw";value:string;source:number;sourceId:string;target?:number;targetId?:string};
type Point={x:number;y:number};
function Reaction({kind}:{kind:string}){return <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="21" fill="#ffd66b" stroke="#bc852d" strokeWidth="1.5"/>{kind==="laugh"?<><path d="m10 18 5-4 5 4m8 0 5-4 5 4" fill="none" stroke="#654222" strokeWidth="3" strokeLinecap="round"/><path d="M12 25h24c0 17-24 17-24 0" fill="#754634"/><path d="M15 25h18v5H15" fill="white"/><path d="M7 22c-8 10 4 12 3 4m31-4c8 10-4 12-3 4" fill="#68bce1"/></>:kind==="cry"?<><path d="m11 16 8 3m10 0 8-3M15 34q9-10 18 0" fill="none" stroke="#654222" strokeWidth="3" strokeLinecap="round"/><path d="M12 21h6v16h-6m18-16h6v16h-6" fill="#68bce1"/></>:kind==="wow"?<><circle cx="16" cy="18" r="3" fill="#654222"/><circle cx="32" cy="18" r="3" fill="#654222"/><ellipse cx="24" cy="31" rx="5" ry="7" fill="#654222"/></>:kind==="think"?<><path d="m11 14 9 2m9 1 8-4m-16 18 10-2" stroke="#654222" strokeWidth="3" strokeLinecap="round"/><circle cx="16" cy="22" r="2" fill="#654222"/><circle cx="32" cy="22" r="2" fill="#654222"/><path d="m25 40 8-13q4-3 5 1l-2 8 8-1-2 10H27" fill="#efb24e" stroke="#bc852d" strokeWidth="1.5"/></>:kind==="nice"?<><path d="m11 19 5-3 5 3m6 0 5-3 5 3M14 29q10 12 20 0" fill="none" stroke="#654222" strokeWidth="3" strokeLinecap="round"/><path d="m38 3 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" fill="#fff7bf"/></>:<><circle cx="16" cy="18" r="3" fill="#654222"/><circle cx="32" cy="18" r="3" fill="#654222"/><path d="M19 30h10" stroke="#654222" strokeWidth="3" strokeLinecap="round"/><path d="m5 37 2-15q1-5 4-1l4 9 4-7q3-3 4 2l-2 17H8m35-5-2-15q-1-5-4-1l-4 9-4-7q-3-3-4 2l2 17h13" fill="#efb24e" stroke="#bc852d" strokeWidth="1.5"/></>}</svg>;}
function Food({kind}:{kind:string}){return <svg viewBox="0 0 48 48" aria-hidden="true">{kind==="egg"?<><path d="M24 3C14 3 7 24 8 32c2 17 30 17 32 0C41 24 34 3 24 3Z" fill="#fff9de" stroke="#baab8a" strokeWidth="2"/><path d="M16 27c0-8 4-15 6-17" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"/></>:<><path d="M42 28c0 22-36 22-36 0C6 8 42 8 42 28" fill="#e54b3c" stroke="#ae302a" strokeWidth="2"/><path d="m24 15-10-6 9 1 4-7 1 8 9-1-9 6-5-4-6 6Z" fill="#38703b"/><path d="M14 24c0-3 2-5 5-6" stroke="#ff9584" strokeWidth="3" fill="none" strokeLinecap="round"/></>}</svg>;}
function Splat({kind}:{kind:string}){return <svg viewBox="0 0 100 80" aria-hidden="true"><path d="M23 28 8 17 28 18 29 4 43 21 58 8 62 24 84 15 75 34 96 43 73 50 85 70 61 59 54 77 42 60 20 73 24 53 3 47 24 39Z" fill={kind==="egg"?"#fff6d8":"#e54b3c"} stroke={kind==="egg"?"#cfbd8d":"#b93c2d"} strokeWidth="2"/>{kind==="egg"?<ellipse cx="48" cy="41" rx="17" ry="14" fill="#f5bd34"/>:<><circle cx="41" cy="37" r="3" fill="#f8c17b"/><circle cx="57" cy="48" r="3" fill="#f8c17b"/></>}</svg>;}
function AnimatedEffect({effect,wrapper,room}:{effect:Effect;wrapper:RefObject<HTMLDivElement|null>;room:PublicRoom}){
 const [points,setPoints]=useState<{from:Point;to:Point}|null>(null);
 useEffect(()=>{
  const el=wrapper.current;if(!el)return;
  const measure=()=>{const base=el.getBoundingClientRect();const point=(seat:number)=>{const r=el.querySelector('[data-poker-seat="'+seat+'"] .seat-top')?.getBoundingClientRect();return r?{x:r.left+r.width/2-base.left,y:r.top+r.height/2-base.top}:null;};const from=point(effect.source),to=point(effect.target??effect.source);setPoints(from&&to?{from,to}:null);};
  measure();const observer=new ResizeObserver(measure);observer.observe(el);return()=>observer.disconnect();
 },[effect,wrapper]);
 if(!points||room.seats[effect.source]?.publicId!==effect.sourceId||(effect.kind==="throw"&&room.seats[effect.target!]?.publicId!==effect.targetId))return null;
 const {from,to}=points;
 if(effect.kind==="emote"){const pair=EMOTES[effect.value as keyof typeof EMOTES];return pair?<div className="poker-emote-bubble" style={{left:from.x,top:from.y}} role="img" aria-label={room.seats[effect.source]?.name+": "+pair[1]}>{<Reaction kind={effect.value}/>}</div>:null;}
 const style={"--sx":from.x+"px","--sy":from.y+"px","--tx":to.x+"px","--ty":to.y+"px","--mx":(from.x+to.x)/2+"px","--my":Math.min(from.y,to.y)-60+"px"} as CSSProperties;
 return <><div className="poker-projectile" style={style}><Food kind={effect.value}/></div><div className={"poker-splat "+effect.value} style={{left:to.x,top:to.y}} role="img" aria-label={effect.value+" splat on "+room.seats[effect.target!]?.name}><Splat kind={effect.value}/></div></>;
}
export function PokerTauntEffects({room,wrapper,muted}:{room:PublicRoom;wrapper:RefObject<HTMLDivElement|null>;muted:boolean}){
 const [effects,setEffects]=useState<Effect[]>([]),timers=useRef(new Set<ReturnType<typeof setTimeout>>());
 useEffect(()=>()=>{for(const timer of timers.current)clearTimeout(timer);},[]);
 useEffect(()=>{if(muted)setEffects([]);},[muted]);
 useLiveEvent("poker:taunt",(e:Effect)=>{
  if(muted||!e||e.tableId!==tableIdOf(room)||typeof e.id!=="string"||!Number.isInteger(e.source)||e.source<0||e.source>=12||!["emote","throw"].includes(e.kind))return;
  if(e.kind==="emote"&&!Object.hasOwn(EMOTES,e.value)||e.kind==="throw"&&(!["egg","tomato"].includes(e.value)||!Number.isInteger(e.target)))return;
  setEffects(old=>old.some(x=>x.id===e.id)?old:[...old.slice(-15),e]);
  const timer=setTimeout(()=>{setEffects(old=>old.filter(x=>x.id!==e.id));timers.current.delete(timer);},3200);timers.current.add(timer);
 });
 return <div className="poker-effects" aria-live="off">{effects.map(effect=><AnimatedEffect key={effect.id} effect={effect} room={room} wrapper={wrapper}/>)}</div>;
}
const tableIdOf=(room:PublicRoom)=>(room as PublicRoom&{pokerTableId?:string}).pokerTableId??"01";
function useTauntState(room:PublicRoom,muted:boolean){
 const {connection,request}=useLive(),[pending,setPending]=useState(false),[cooling,setCooling]=useState(false),[error,setError]=useState("");
 const pendingByTable=useRef(new Map<string,Record<string,unknown>>());
 const price=(kind:string)=>kind==="egg"?(room.casinoLimits?.pokerEggPrice??5000):(room.casinoLimits?.pokerTomatoPrice??5000);
 const money=(cents:number)=>"$"+(cents/100).toLocaleString();
 const lock=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);},[]);

 const disabled=connection!=="connected"||pending||cooling||room.me.seat<0||muted;
 async function send(kind:"emote"|"throw",value:string,target?:{seat:number;id:string}){
  if(disabled||lock.current)return;
  lock.current=true;setPending(true);setError("");
  try{
   const table=tableIdOf(room);
   const payload=pendingByTable.current.get(table)??{tableId:table,kind,value,...(kind==="throw"?{target:target?.seat,targetId:target?.id,requestId:crypto.randomUUID(),requestAt:Date.now(),expectedPrice:price(value)}:{})};
   if(kind==="throw")pendingByTable.current.set(table,payload);
   await request("poker:taunt",payload);pendingByTable.current.delete(table);setCooling(true);timer.current=setTimeout(()=>setCooling(false),4000);}
  catch(e){const err=e as Error&{retryAfterMs?:number};if(!["timeout","disconnected","unavailable","cooldown"].includes(err.message))pendingByTable.current.delete(tableIdOf(room));if(err.message==="cooldown"){setCooling(true);timer.current=setTimeout(()=>setCooling(false),Math.min(4000,err.retryAfterMs||4000));}else setError(err.message==="insufficient_funds"?"Not enough money in your wallet.":err.message==="price_changed"?"Price changed. Review the new price and try again.":["timeout","disconnected","unavailable"].includes(err.message)?"Not confirmed. Retry to check the same throw, without paying twice.":err.message==="expired"?"That request expired. Try a new throw.":err.message==="target"?"That player left. Pick another seat.":err.message==="not_seated"?"Take a seat to react.":"Could not send. Try again.");}
  finally{setPending(false);lock.current=false;}
 }
 return {send,disabled,error,cooling,price,money,unresolved:pendingByTable.current.has(tableIdOf(room)),retry:()=>send("throw",String(pendingByTable.current.get(tableIdOf(room))?.value))};
}
type TauntState=ReturnType<typeof useTauntState>;
const TauntContext=createContext<TauntState|null>(null);
function useTaunts(){const state=useContext(TauntContext);if(!state)throw new Error("PokerTauntProvider is required");return state;}
export function PokerTauntProvider({room,muted,children}:{room:PublicRoom;muted:boolean;children:ReactNode}){
 const state=useTauntState(room,muted);return <TauntContext.Provider value={state}>{children}</TauntContext.Provider>;
}
// Slot for the shared kick/vote-kick player menu. It never owns a second popup.
export function PokerThrowMenuActions({room,targetSeat,targetId,onSent}:{room:PublicRoom;targetSeat:number;targetId:string;onSent?:()=>void}){
 const t=useTaunts(),seat=room.seats[targetSeat],valid=!!seat&&!seat.isYou&&seat.publicId===targetId;
 return <>{(["egg","tomato"] as const).map(food=><button role="menuitem" type="button" key={food} aria-label={"Throw "+food} disabled={!valid||t.disabled||t.unresolved||room.me.wallet<t.price(food)} onClick={()=>{void t.send("throw",food,{seat:targetSeat,id:targetId}).then(onSent);}}><Food kind={food}/><span>{food==="egg"?"Egg":"Tomato"}</span><span className="poker-menu-price">{t.money(t.price(food))}</span></button>)}{room.me.seat<0?<small>Take a seat to throw.</small>:room.me.wallet<Math.min(t.price("egg"),t.price("tomato"))?<small>Not enough money in your wallet.</small>:null}</>;
}
export function PokerEmoteMenuActions(){
 const t=useTaunts();
 return <><small>Free emotes</small><div className="poker-emote-choices" role="group" aria-label="Quick reactions">{Object.entries(EMOTES).map(([key,[,label]])=><button type="button" role="menuitem" key={key} aria-label={label} title={label} disabled={t.disabled||t.unresolved} onClick={()=>void t.send("emote",key)}><Reaction kind={key}/></button>)}</div></>;
}
export function PokerTauntControls({room,muted,setMuted}:{room:PublicRoom;muted:boolean;setMuted:(v:boolean)=>void}){
 const t=useTaunts();
 return <div className="poker-taunt-controls"><div className="poker-taunt-heading"><small>Click your seat for free emotes.</small><button type="button" aria-pressed={muted} onClick={()=>setMuted(!muted)}>{muted?"Show reactions":"Hide reactions"}</button></div>{t.unresolved?<button type="button" disabled={t.disabled} onClick={()=>void t.retry()}>Retry unconfirmed throw</button>:null}<small role="status">{t.error||(room.me.seat<0?"Take a seat to react.":muted?"Reactions hidden on this device.":t.cooling?"One reaction every 4 seconds.":"Emotes are free. Throws charge your wallet and go to the house.")}</small></div>;
}
