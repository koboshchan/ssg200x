"use client";
import {useEffect,useRef,useState} from 'react';
import {RED} from '@/lib/market-shared';
import {wheelPose,ambientWheelRotation,WHEEL_POCKETS,type RouletteSpin} from '@/lib/roulette-clock';
import styles from './roulette.module.css';
const point=(radius:number,angle:number)=>[160+radius*Math.sin(angle),160-radius*Math.cos(angle)];
const step=Math.PI*2/37;
/** Original SVG geometry and analytic motion, independently built. Server time is
 * the animation position, not an instruction to start another CSS animation. */
export default function RouletteWheel({spin,now,last,started}:{spin:RouletteSpin|null;now:number;started:number;last?:{round:number;number:number}}){
 const rotor=useRef<HTMLDivElement>(null);
 const clock=useRef({server:now,local:0});
 const [reduced,setReduced]=useState(false);
 useEffect(()=>{const query=matchMedia('(prefers-reduced-motion: reduce)');const update=()=>setReduced(query.matches);update();query.addEventListener('change',update);return()=>query.removeEventListener('change',update);},[]);
 useEffect(()=>{clock.current={server:now,local:performance.now()};},[now]);
 const round=spin?.round,number=spin?.number,startedAt=spin?.startedAt,resultAt=spin?.resultAt,nextAt=spin?.nextAt,fromRotation=spin?.fromRotation;
 useEffect(()=>{
  let frame=0;
  const target=round!==undefined?{round,number:number!,startedAt:startedAt!,resultAt:resultAt!,nextAt:nextAt!,fromRotation}:last?{...last,startedAt:0,resultAt:1,nextAt:1}:null;
  const draw=()=>{
   const time=clock.current.server+performance.now()-clock.current.local;
   const pose=round!==undefined?wheelPose(target!,time,reduced):{rotor:reduced?ambientWheelRotation(started,started,last):ambientWheelRotation(started,time,last)};
   if(rotor.current)rotor.current.style.transform=`rotate(${pose.rotor}deg)`;
   if(!reduced&&(round===undefined||time<target!.resultAt))frame=requestAnimationFrame(draw);
  };
  draw();return()=>cancelAnimationFrame(frame);
 },[round,number,startedAt,resultAt,nextAt,fromRotation,last?.round,last?.number,reduced,started]);
 const landed=!!spin&&now>=spin.resultAt;
 return <div className={styles.wheelScene} role="img" aria-label={landed?'Winning number '+spin.number:spin?'Roulette wheel spinning':'European roulette wheel'}>
 <div ref={rotor} className={styles.wheelRotor}><svg viewBox="0 0 320 320" aria-hidden="true">
 {WHEEL_POCKETS.map((n,i)=>{const start=(i-.5)*step,end=(i+.5)*step,a=point(157,start),b=point(157,end),c=point(132,end),d=point(132,start);return <g key={n}><path d={`M${a.join(' ')} A157 157 0 0 1 ${b.join(' ')} L${c.join(' ')} A132 132 0 0 0 ${d.join(' ')} Z`} fill={n===0?'#2ba10c':RED.has(n)?'#e31b2a':'#434141'} stroke="#ffffff" strokeWidth=".6"/><text x="160" y="15" transform={`rotate(${i*360/37} 160 160) rotate(90 160 15)`} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize="11" fontFamily="sans-serif">{n}</text></g>;})}
 <circle cx="160" cy="160" r="131.5" fill="rgb(33,91,120)"/>
 </svg></div>
 <svg viewBox="0 0 320 320" className={styles.wheelPointer} aria-hidden="true"><path d="M158.5 0 H161.5 L160 12 Z" fill="white"/></svg>
 {landed?<div className={styles.resultBadge} aria-hidden="true"><small>Result</small><strong>{spin.number}</strong></div>:null}
 </div>;
}
