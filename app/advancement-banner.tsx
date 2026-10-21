"use client";
import {useEffect,useRef} from "react";
import "./airdrop-announcement.css";
export function AdvancementBanner({icon,name,reward,onDismiss}:{icon:React.ReactNode;name:string;reward:number;onDismiss:()=>void}){
 useEffect(()=>{const timer=setTimeout(onDismiss,3250);return()=>clearTimeout(timer);},[onDismiss]);
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
   const cols=["#ec4899"],ox=w/2,oy=Math.min(150,h*.25),n=w<540?35:55,T=2000,t0=performance.now();
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
 return <div className="airdrop-status" role="status" aria-live="polite"><canvas ref={canvas} className="airdrop-confetti" aria-hidden="true"/><div className="airdrop-announcement play advancement-drop"><span className="airdrop-icon" style={{display:"grid",placeItems:"center"}}>{icon}</span><span className="airdrop-message">Advancement unlocked · {name}{reward>0?" · +$"+reward/100:""}</span><button style={{pointerEvents:"auto"}} aria-label="Dismiss advancement notification" onClick={onDismiss}>×</button></div></div>;
}
