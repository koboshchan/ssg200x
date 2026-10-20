"use client";
import {useEffect,useRef,useState} from "react";
import {AIRDROP_EVENT,type AirdropEvent} from "../runtime/airdrop-events.mjs";
import "./airdrop-announcement.css";

export function airdropMessage(amount:number){
 return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(amount/100).replace(/\.00$/,"")+" airdropped to everyone";
}
type Subscribe=(event:string,handler:(payload:AirdropEvent)=>void)=>()=>void;
export default function AirdropAnnouncement({subscribe}:{subscribe:Subscribe}){
 const [queue,setQueue]=useState<AirdropEvent[]>([]);
 useEffect(()=>subscribe(AIRDROP_EVENT,event=>setQueue(q=>[...q,event])),[subscribe]);
 const current=queue[0];
 useEffect(()=>{
  if(!current)return;
  const timer=setTimeout(()=>setQueue(q=>q.filter(event=>event.id!==current.id)),3250);
  return()=>clearTimeout(timer);
 },[current]);
 return <div role="status" aria-live="polite" aria-atomic="true" className="airdrop-status">
  {current?<Notice key={current.id} event={current}/>:null}
 </div>;
}
function Notice({event}:{event:AirdropEvent}){
 const canvas=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{
  const cv=canvas.current,cx=cv?.getContext("2d");
  if(!cv||!cx)return;
  const still=matchMedia("(prefers-reduced-motion: reduce)");
  let raf=0,timer:ReturnType<typeof setTimeout>;
  function stop(){cancelAnimationFrame(raf);clearTimeout(timer);cx!.setTransform(1,0,0,1,0,0);cx!.clearRect(0,0,cv!.width,cv!.height);}
  function confetti(){
   if(still.matches)return;
   const d=Math.min(window.devicePixelRatio||1,3),w=innerWidth,h=innerHeight;
   cv!.width=w*d;cv!.height=h*d;cx!.setTransform(d,0,0,d,0,0);
   const cols=["#e5484d","#f5a524","#30a46c","#3e63dd","#8e4ec6","#12a594"],ox=w/2,oy=Math.min(150,h*.25),n=w<540?70:110,T=2000,t0=performance.now();
   const ps=Array.from({length:n},()=>{const a=Math.random()*Math.PI*2,s=2+Math.random()*7;return{x:ox,y:oy,vx:Math.cos(a)*s,vy:Math.sin(a)*s-3,r:Math.random()*6.28,vr:(Math.random()-.5)*.4,w:5+Math.random()*5,h:3+Math.random()*4,c:cols[Math.random()*cols.length|0]};});
   let last=t0;
   function frame(now:number){
    const el=now-t0,k=Math.min((now-last)/16.7,3);last=now;cx!.clearRect(0,0,w,h);
    if(el>=T){stop();return;}
    cx!.globalAlpha=Math.min(1,(T-el)/700);
    for(const p of ps){p.vx*=Math.pow(.985,k);p.vy=p.vy*Math.pow(.985,k)+.18*k;p.x+=p.vx*k;p.y+=p.vy*k;p.r+=p.vr*k;cx!.save();cx!.translate(p.x,p.y);cx!.rotate(p.r);cx!.fillStyle=p.c;cx!.fillRect(-p.w/2,-p.h/2,p.w,p.h);cx!.restore();}
    raf=requestAnimationFrame(frame);
   }
   frame(t0);
  }
  timer=setTimeout(confetti,650);
  const changed=()=>{if(still.matches)stop();};
  still.addEventListener("change",changed);
  return()=>{stop();still.removeEventListener("change",changed);};
 },[]);
 return <><canvas ref={canvas} className="airdrop-confetti" aria-hidden="true"/>
  <div className="airdrop-announcement play" data-airdrop-id={event.id}>
   <svg className="airdrop-icon" viewBox="0 0 44 48" fill="none" aria-hidden="true"><g className="airdrop-drop"><g className="airdrop-canopy" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 16C5 1 39 1 39 16Q35 12 31 16Q27 12 22 16Q17 12 13 16Q9 12 5 16Z" fill="var(--airdrop-soft)"/><path d="m5 16 13 20m21-20L26 36M13 16l7 20m11-20-7 20M22 5c-5 2-8 5-9 11m9-11c5 2 8 5 9 11"/></g><path d="m12 33 10-5 10 5v11l-10 4-10-4Z" fill="var(--airdrop-soft)" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><path d="m12 33 10 5 10-5m-10 5v10m-5-17 10 5v5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></g></svg>
   <span className="airdrop-message">{airdropMessage(event.amount)}</span>
  </div>
 </>;
}
