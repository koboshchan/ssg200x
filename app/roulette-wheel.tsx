"use client";
import {useEffect,useMemo,useRef,useState} from 'react';
import {createTrajectory,idleW,type IdleAnchor,type Trajectory} from '@/lib/roulette-physics';
import {drawWood} from '../runtime/roulette-render.mjs';
import type {RouletteSpin} from '@/lib/roulette-clock';
import styles from './roulette.module.css';
import {poseAt} from '@/lib/roulette-physics';

export default function RouletteWheel({spin,now,idleAnchor}:{spin:RouletteSpin|null;now:number;idleAnchor:IdleAnchor}){
 const canvas=useRef<HTMLCanvasElement>(null),clock=useRef({server:now,local:0});
 const [reduced,setReduced]=useState(false);
 useEffect(()=>{const q=matchMedia('(prefers-reduced-motion: reduce)'),update=()=>setReduced(q.matches);update();q.addEventListener('change',update);return()=>q.removeEventListener('change',update);},[]);
 useEffect(()=>{clock.current={server:now,local:performance.now()};},[now]);
 const physics=spin?.physics;
 // Server result/params/anchor are immutable. Refreshing serverNow never reruns
 // physics; clients execute one trajectory, not a search or target correction.
 const trajectory=useMemo<{value:Trajectory|null;error:boolean}>(()=>{
  if(!physics)return {value:null,error:!!spin};
  try{return {value:createTrajectory(physics),error:false};}catch{return {value:null,error:true};}
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[physics?.roundId,spin?.round]);
 useEffect(()=>{
  const cv=canvas.current,ctx=cv?.getContext('2d');if(!cv||!ctx||trajectory.error)return;
  let frame=0;
  const draw=()=>{
   const t=clock.current.server+performance.now()-clock.current.local;
   const size=cv.getBoundingClientRect(),dpr=Math.min(2,devicePixelRatio||1),w=Math.round(size.width*dpr),h=Math.round(size.height*dpr);
   if(cv.width!==w||cv.height!==h){cv.width=w;cv.height=h;}
   ctx.setTransform(dpr,0,0,dpr,0,0);
   const W=idleW(idleAnchor,t);
   const pose=trajectory.value?poseAt(trajectory.value,t,reduced):{W,a:W+idleAnchor.rel,r:idleAnchor.r,z:0,phi:idleAnchor.rel,e:0,vis:1,phase:'idle'};
   drawWood(ctx,size.width,size.height,pose);
   frame=requestAnimationFrame(draw);
  };
  draw();return()=>cancelAnimationFrame(frame);
 },[trajectory,idleAnchor.atMs,idleAnchor.phase,idleAnchor.vel,idleAnchor.rel,idleAnchor.r,reduced]);
 const landed=!!spin&&now>=spin.resultAt;
 return <div className={styles.wheelScene} role="img" aria-label={trajectory.error?'Wheel unavailable. Refresh to load matching physics.':landed?'Winning number '+spin.number:spin?'Roulette wheel spinning':'European roulette wheel'}>
 <canvas ref={canvas} style={{display:'block',width:'100%',height:'100%',borderRadius:8}} aria-hidden="true"/>
 {trajectory.error?<p role="alert">Wheel unavailable. Refresh to load matching physics.</p>:null}
 {landed?<div className={styles.resultBadge} aria-hidden="true"><small>Result</small><strong>{spin.number}</strong></div>:null}
 </div>;
}
