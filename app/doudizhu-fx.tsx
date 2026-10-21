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
  if(key&&key!==p.trick&&g.trick){const k=g.trick.combo.kind;if(k==="bomb"||k==="rocket")emit(k);else if(k.startsWith("airplane"))emit("airplane");}
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
  if(e.kind==="bomb")return <div key={e.id} className="fx-bomb"><i className="ring r1"/><i className="ring r2"/><i className="ring r3"/><i className="core"/>{sparks.map(s=><b key={s} style={{"--a":s*(360/sparks.length)+"deg","--d":60+(s%3)*22+"px"} as React.CSSProperties}/>)}<strong>炸弹 BOMB</strong></div>;
  if(e.kind==="rocket")return <div key={e.id} className="fx-rocket"><i className="streak"/><i className="streak s2"/>{sparks.map(s=><b key={s} style={{"--a":s*(360/sparks.length)+"deg","--d":70+(s%4)*20+"px"} as React.CSSProperties}/>)}<svg viewBox="0 0 40 64" className="rk"><path d="M20 2c10 10 12 26 10 40H10C8 28 10 12 20 2z" fill="#f4f6fb" stroke="#33405c" strokeWidth="2"/><circle cx="20" cy="22" r="5" fill="#59c4ff" stroke="#33405c" strokeWidth="2"/><path d="M10 34 2 48l10-4zm20 0 8 14-10-4z" fill="#ff5a5a" stroke="#33405c" strokeWidth="2"/><path d="M14 44h12l-6 18z" fill="#ffb02e"/></svg><strong>王炸 ROCKET</strong></div>;
  if(e.kind==="airplane")return <div key={e.id} className="fx-plane"><i className="trail"/><i className="trail t2"/><svg viewBox="0 0 120 56" className="pl"><path d="M6 28 40 20 62 4h12L66 22l34 2c10 0 18 3 18 4s-8 4-18 4l-34 2 8 18H62L40 36 6 28z" fill="#eef3fb" stroke="#33405c" strokeWidth="2.5" strokeLinejoin="round"/><path d="M104 26l8 2-8 2z" fill="#ff6b5f"/></svg><strong>飞机 AIRPLANE</strong></div>;
  if(e.kind==="spring")return <div key={e.id} className="fx-spring"><span>春天</span><small>SPRING ×2</small>{confetti.map(c=><b key={c} style={{"--x":(c*37%100)+"%","--r":(c*53%360)+"deg","--t":(c%5)*.12+"s","--h":c%4} as React.CSSProperties}/>)}</div>;
  if(e.kind==="landlord")return <div key={e.id} className="fx-landlord"><Crown/><span>地主 LANDLORD</span></div>;
  if(e.kind==="multiplier")return <div key={e.id} className="fx-mult">{e.text}</div>;
  return <div key={e.id} className={"fx-end fx-"+e.kind}>{confetti.map(c=><b key={c} style={{"--x":(c*37%100)+"%","--r":(c*53%360)+"deg","--t":(c%6)*.1+"s","--h":c%4} as React.CSSProperties}/>)}</div>;
 })}</div>;
}
export type SettleRow={name:string;self:boolean;win:boolean;beans?:string;money:string};
export function Settlement({win,spring,note,rows,animate}:{win:boolean;spring:boolean;note?:string;rows:SettleRow[];animate:boolean}){
 return <div className={"dd-settle "+(win?"is-win":"is-lose")+(animate?" is-anim":"")} role="status">
  <div className="dd-settle-head"><svg viewBox="0 0 120 70" aria-hidden="true" focusable="false" className="dd-laurel"><path d="M60 8 66 26 86 26 70 38 76 58 60 46 44 58 50 38 34 26 54 26z" fill={win?"#ffe08a":"#9aa5b8"} stroke={win?"#8a5d10":"#4a5568"} strokeWidth="2.5" strokeLinejoin="round"/><path d="M14 52C6 36 12 18 28 10M106 52c8-16 2-34-14-42" fill="none" stroke={win?"#f6dc8e":"#8b94a6"} strokeWidth="4" strokeLinecap="round"/></svg>
   <strong>{win?"胜利":"失败"}<small>{win?"VICTORY":"DEFEAT"}{spring?" · 春天 ×2":""}</small></strong></div>
  {note?<p className="dd-nominal">{note}</p>:null}
  <ul>{rows.map((r,i)=><li key={i} className={(r.self?"is-self ":"")+(r.win?"up":"down")} style={{"--i":i} as React.CSSProperties}><b>{r.name}{r.self?" (you)":""}</b>{r.beans?<em>{r.beans}</em>:null}<small>{r.money}</small></li>)}</ul>
 </div>;
}
