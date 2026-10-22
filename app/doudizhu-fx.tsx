"use client";
import {useCallback,useEffect,useRef,useState,useSyncExternalStore} from "react";
import type {PublicDoudizhu} from "@/lib/doudizhu";
import "./doudizhu-fx.css";
type Room=NonNullable<PublicDoudizhu["room"]>;
export type FxKind="bomb"|"rocket"|"airplane"|"spring"|"landlord"|"win"|"lose"|"multiplier";
type Snap={code:string;handId:string;version:number;phase:string;landlord:number|null;multiplier:number;trick:string;result:boolean};
export type FxState={dealing:boolean;dealId:number;flyTrick:string;flyFrom:"self"|"right"|"left";landlordId:number;popId:number;popTo:number;shakeId:number;settleId:number};
const query="(prefers-reduced-motion: reduce)";
function subscribe(cb:()=>void){const m=window.matchMedia(query);m.addEventListener("change",cb);return()=>m.removeEventListener("change",cb);}
export function useReducedMotion(){return useSyncExternalStore(subscribe,()=>window.matchMedia(query).matches,()=>true);}
export const trickKey=(g:Room)=>g.trick?g.handId+":"+g.trick.seat+":"+g.trick.cards.join(","):"";
const rel=(seat:number,me:number)=>["self","right","left"][(seat-Math.max(me,0)+3)%3] as FxState["flyFrom"];
const idle:FxState={dealing:false,dealId:0,flyTrick:"",flyFrom:"self",landlordId:0,popId:0,popTo:1,shakeId:0,settleId:0};
/** Detects REAL state transitions (version increases within the same room) and drives effects.
 * The first view after load/reconnect only records a baseline, so polling never replays animations. */
export function useDoudizhuFx(g:Room|null|undefined,mySeat:number,allowPreview=false){
 const reduced=useReducedMotion(),reducedRef=useRef(reduced),prev=useRef<Snap|null>(null),seq=useRef(0);
 const [fx,setFx]=useState<FxState>(idle),[list,setList]=useState<{id:number;kind:FxKind;text?:string}[]>([]);
 reducedRef.current=reduced;
 const emit=useCallback((kind:FxKind,text?:string)=>{if(reducedRef.current)return;const id=++seq.current;setList(l=>[...l.slice(-3),{id,kind,text}]);window.setTimeout(()=>setList(l=>l.filter(x=>x.id!==id)),kind==="win"||kind==="lose"?3600:2800);},[]);
 useEffect(()=>{
  if(!g){prev.current=null;return;}
  const key=trickKey(g),p=prev.current;
  prev.current={code:g.code,handId:g.handId,version:g.version,phase:g.phase,landlord:g.landlord,multiplier:g.multiplier,trick:key,result:!!g.result};
  if(!p||p.code!==g.code||g.version<=p.version||g.version-p.version>8||document.hidden||reducedRef.current)return;
  setFx(f=>{
   const n={...f};
   if(g.handId!==p.handId||((p.phase==="waiting"||p.phase==="finished")&&g.phase==="bidding")){n.dealing=true;n.dealId=f.dealId+1;}
   if(p.landlord===null&&g.landlord!==null){n.landlordId=f.landlordId+1;}
   if(g.multiplier>p.multiplier){n.popId=f.popId+1;n.popTo=g.multiplier;}
   if(key&&key!==p.trick&&g.trick){n.flyTrick=key;n.flyFrom=rel(g.trick.seat,mySeat);const k=g.trick.combo.kind;if(k==="bomb"||k==="rocket")n.shakeId=f.shakeId+1;}
   if(!p.result&&g.result)n.settleId=f.settleId+1;
   return n;
  });
  if(g.handId!==p.handId||((p.phase==="waiting"||p.phase==="finished")&&g.phase==="bidding"))window.setTimeout(()=>setFx(f=>({...f,dealing:false})),2600);
  if(p.landlord===null&&g.landlord!==null)emit("landlord");
  if(key&&key!==p.trick&&g.trick){const k=g.trick.combo.kind;if(k==="bomb"||k==="rocket")emit(k,g.trick.combo.special==="black78"?"BLACK 78":undefined);else if(k.startsWith("airplane"))emit("airplane");}
  if(g.multiplier>p.multiplier&&g.phase!=="finished")emit("multiplier","×"+g.multiplier);
  if(!p.result&&g.result){if(g.result.spring)emit("spring");const b=g.landlord,w=g.result.winner,me=mySeat,side=(s:number)=>s===b;emit(side(w)===side(me)?"win":"lose");}
 },[g,mySeat,emit]);
 useEffect(()=>{if(!allowPreview)return;const on=(e:Event)=>{const d=(e as CustomEvent<{kind:FxKind|"deal"}>).detail;if(d.kind==="deal"){if(reducedRef.current)return;setFx(f=>({...f,dealing:true,dealId:f.dealId+1}));window.setTimeout(()=>setFx(f=>({...f,dealing:false})),2600);}else emit(d.kind,d.kind==="multiplier"?"×2":undefined);};window.addEventListener("dd-fx-preview",on);return()=>window.removeEventListener("dd-fx-preview",on);},[allowPreview,emit]);
 return {fx,list,reduced};
}
export function TableArt(){return <svg className="dd-art" viewBox="0 0 800 420" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><defs>
 <radialGradient id="ddfelt" cx="50%" cy="42%" r="75%"><stop offset="0" stopColor="#2c7a53"/><stop offset=".6" stopColor="#1b5a3d"/><stop offset="1" stopColor="#0f3425"/></radialGradient>
 <linearGradient id="ddgold" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#f6dc8e"/><stop offset=".5" stopColor="#b98a2f"/><stop offset="1" stopColor="#f3d27a"/></linearGradient>
 <pattern id="ddweave" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 7h14M7 0v14" stroke="#fff" strokeOpacity=".035" strokeWidth="1"/></pattern></defs>
 <rect width="800" height="420" fill="url(#ddfelt)"/><rect width="800" height="420" fill="url(#ddweave)"/>
 <rect x="14" y="14" width="772" height="392" rx="26" fill="none" stroke="url(#ddgold)" strokeWidth="3" strokeOpacity=".75"/>
 <rect x="24" y="24" width="752" height="372" rx="20" fill="none" stroke="#f6dc8e" strokeOpacity=".22" strokeDasharray="2 7"/>
 <g transform="translate(400 215)" opacity=".13" fill="none" stroke="#f6dc8e" strokeWidth="3"><circle r="120"/><circle r="104" strokeDasharray="3 9"/><path d="M-46 8c-4-38 30-62 56-44 26 18 22 62-8 76-26 12-46-4-48-32z" fill="#f6dc8e" fillOpacity=".25"/><path d="M-12-6c8-10 22-6 24 4" strokeLinecap="round"/></g>
 {[[40,40,0],[760,40,90],[760,380,180],[40,380,270]].map(([x,y,r])=><path key={x+"-"+y} transform={"translate("+x+" "+y+") rotate("+r+")"} d="M0 0h34M0 0v34M0 0c12 0 22 10 22 22" fill="none" stroke="url(#ddgold)" strokeWidth="2.5" strokeLinecap="round" opacity=".8"/>)}
</svg>;}
export function Crown({className=""}:{className?:string}){return <svg className={"dd-crown "+className} viewBox="0 0 48 34" aria-hidden="true" focusable="false"><defs><linearGradient id="ddcg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#ffe9a0"/><stop offset="1" stopColor="#c8921f"/></linearGradient></defs><path d="M4 28 7 8l11 11L24 4l6 15L41 8l3 20z" fill="url(#ddcg)" stroke="#7a5412" strokeWidth="2" strokeLinejoin="round"/><rect x="4" y="28" width="40" height="5" rx="2" fill="#e0aa2f" stroke="#7a5412" strokeWidth="2"/><circle cx="7" cy="7" r="3" fill="#ff6b5f"/><circle cx="24" cy="3.5" r="3" fill="#6bd4ff"/><circle cx="41" cy="7" r="3" fill="#ff6b5f"/></svg>;}
const sparks=Array.from({length:14},(_,i)=>i);
const confetti=Array.from({length:26},(_,i)=>i);
export function DealFlight({id}:{id:number}){return <div className="dd-deal" key={id} aria-hidden="true">{["self","right","left"].map(d=><div key={d} className={"dd-deal-to dd-deal-"+d}>{Array.from({length:6},(_,i)=><span key={i} style={{"--i":i} as React.CSSProperties}/>)}</div>)}<div className="dd-deal-deck"><span/><span/><span/></div></div>;}
export function FxLayer({list}:{list:{id:number;kind:FxKind;text?:string}[]}){
 return <div className="dd-fx" aria-hidden="true">{list.map(e=>{
  if(e.kind==="bomb")return <div key={e.id} className="fx-bomb"><i className="ring r1"/><i className="ring r2"/><i className="ring r3"/><i className="core"/>{sparks.map(s=><b key={s} style={{"--a":s*(360/sparks.length)+"deg","--d":60+(s%3)*22+"px"} as React.CSSProperties}/>)}<strong>{e.text??"BOMB"}</strong></div>;
  if(e.kind==="rocket")return <div key={e.id} className="fx-rocket"><div className="rk-fly">{[0,1,2,3,4].map(s=><i key={s} className="puff" style={{"--i":s} as React.CSSProperties}/>)}<svg viewBox="0 0 48 110" className="rk" aria-hidden="true"><defs><linearGradient id="rkb" x1="0" x2="1"><stop offset="0" stopColor="#c9d3e6"/><stop offset=".45" stopColor="#fff"/><stop offset="1" stopColor="#aeb9d0"/></linearGradient></defs><path className="flame" d="M16 74h16c2 12-2 24-8 34-6-10-10-22-8-34z" fill="#ff9d2e"/><path className="flame f2" d="M20 74h8c1 8-1 15-4 22-3-7-5-14-4-22z" fill="#fff3a6"/><path d="M12 62 2 82l6 2 4-6zm24 0 10 20-6 2-4-6z" fill="#e5484d" stroke="#2b3550" strokeWidth="2" strokeLinejoin="round"/><path d="M24 2c9 10 14 26 13 46l-2 28H13l-2-28C10 28 15 12 24 2z" fill="url(#rkb)" stroke="#2b3550" strokeWidth="2.2" strokeLinejoin="round"/><path d="M24 2c5 6 8 12 10 18H14c2-6 5-12 10-18z" fill="#e5484d" stroke="#2b3550" strokeWidth="2" strokeLinejoin="round"/><circle cx="24" cy="38" r="7" fill="#59c4ff" stroke="#2b3550" strokeWidth="2.2"/><circle cx="22" cy="36" r="2" fill="#fff"/><path d="M13 62h22" stroke="#2b3550" strokeWidth="2"/></svg></div><strong>{e.text??"ROCKET"}</strong></div>;
  if(e.kind==="airplane")return <div key={e.id} className="fx-plane"><div className="pl-fly"><i className="contrail"/><i className="contrail c2"/><svg viewBox="0 0 140 60" className="pl" aria-hidden="true"><path d="M128 28c8 0 12 2 12 3s-4 3-12 3H40L10 52H2l10-21-6-19h8l22 19h92z" fill="#f4f7fc" stroke="#2b3550" strokeWidth="2.2" strokeLinejoin="round"/><path d="M62 31 40 6h12l36 25zM64 33l22 22H74L52 33z" fill="#d7dfee" stroke="#2b3550" strokeWidth="2" strokeLinejoin="round"/><path d="M112 27c4-4 12-4 18 0z" fill="#59c4ff" stroke="#2b3550" strokeWidth="1.8"/><path d="M8 14h8l6 16H12z" fill="#e5484d" stroke="#2b3550" strokeWidth="1.6" strokeLinejoin="round"/><circle cx="84" cy="28" r="1.8" fill="#2b3550"/><circle cx="96" cy="28" r="1.8" fill="#2b3550"/></svg></div><strong>AIRPLANE</strong></div>;
  if(e.kind==="spring")return <div key={e.id} className="fx-spring"><span>SPRING</span><small>×2</small>{confetti.map(c=><b key={c} style={{"--x":(c*37%100)+"%","--r":(c*53%360)+"deg","--t":(c%5)*.12+"s","--h":c%4} as React.CSSProperties}/>)}</div>;
  if(e.kind==="landlord")return <div key={e.id} className="fx-landlord"><Crown/><span>LANDLORD</span></div>;
  if(e.kind==="multiplier")return <div key={e.id} className="fx-mult">{e.text}</div>;
  return <div key={e.id} className={"fx-end fx-"+e.kind}>{confetti.map(c=><b key={c} style={{"--x":(c*37%100)+"%","--r":(c*53%360)+"deg","--t":(c%6)*.1+"s","--h":c%4} as React.CSSProperties}/>)}</div>;
 })}</div>;
}
export type SettleRow={name:string;self:boolean;win:boolean;beans?:React.ReactNode;money:string};
export function Settlement({win,spring,note,rows,animate}:{win:boolean;spring:boolean;note?:React.ReactNode;rows:SettleRow[];animate:boolean}){
 return <div className={"dd-settle "+(win?"is-win":"is-lose")+(animate?" is-anim":"")} role="status">
  <div className="dd-settle-head"><svg viewBox="0 0 120 70" aria-hidden="true" focusable="false" className="dd-laurel"><path d="M60 8 66 26 86 26 70 38 76 58 60 46 44 58 50 38 34 26 54 26z" fill={win?"#ffe08a":"#9aa5b8"} stroke={win?"#8a5d10":"#4a5568"} strokeWidth="2.5" strokeLinejoin="round"/><path d="M14 52C6 36 12 18 28 10M106 52c8-16 2-34-14-42" fill="none" stroke={win?"#f6dc8e":"#8b94a6"} strokeWidth="4" strokeLinecap="round"/></svg>
   <strong>{win?"VICTORY":"DEFEAT"}{spring?<small>Spring ×2</small>:null}</strong></div>
  {note?<p className="dd-nominal">{note}</p>:null}
  <ul>{rows.map((r,i)=><li key={i} className={(r.self?"is-self ":"")+(r.win?"up":"down")} style={{"--i":i} as React.CSSProperties}><b>{r.name}{r.self?" (you)":""}</b>{r.beans?<em>{r.beans}</em>:null}<small>{r.money}</small></li>)}</ul>
 </div>;
}

export const BeanIcon=()=><svg className="dd-bean" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><defs><linearGradient id="ddbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffe9a0"/><stop offset="1" stopColor="#d9962b"/></linearGradient></defs><path d="M10 1.5c4.6 0 8 3.3 8 7.6 0 5.2-3.6 9.4-8.2 9.4C5.6 18.5 2 15.3 2 11 2 5.8 5.6 1.5 10 1.5z" fill="url(#ddbg)" stroke="#a8691a" strokeWidth="1"/><path d="M6.5 6.5c1.2-1.4 3-2 4.6-1.6" stroke="#fff8d6" strokeWidth="1.4" strokeLinecap="round" fill="none"/></svg>;
export const BeanAmount=({v,sign}:{v:string|number;sign?:string}):React.ReactElement=><span className="dd-beanamt">{sign}{v}<BeanIcon/></span>;
