import {parentPort,workerData} from 'node:worker_threads';
import {POCKETS,idleW,idleV,makeWheel,simulate,pocketAtRest,rng32,SPIN_VP,SPIN_TUP,SPIN_TAU,SPIN_WB,LAUNCH_WINDOW_MS,wheelOf,wheelVelOf} from './roulette-physics.mjs';
// This module is only loaded in a worker AFTER the persisted betting lock.
export function solveLaunch({target,anchor,spinStartAt,seed,maxTries=40000}){
 const rnd=rng32(seed),idx=POCKETS.indexOf(target);
 if(idx<0)throw new Error('Invalid target');
 for(let tries=1;tries<=maxTries;tries++){
  const d=Math.round(rnd()*LAUNCH_WINDOW_MS),dvk=1+(rnd()-.5)*.08,dwb=1+(rnd()-.5)*.3,t0=spinStartAt+d;
  const W=idleW(anchor,t0),wp=makeWheel(W,idleV(anchor,t0),SPIN_VP*dvk,SPIN_TUP,SPIN_TAU);wp.r0=anchor.r;
  const f=simulate(wp,W+anchor.rel,SPIN_WB*dwb,false),e=f.ev;
  if(e.tRest!==null&&!e.badLaunch&&pocketAtRest(e.phiRest)===idx){
   const duration=e.tRest+700;
   return {launchParams:{d,dvk,dwb},durationMs:d+duration,endAnchor:{atMs:t0+duration,phase:wheelOf(wp,duration),vel:wheelVelOf(wp,duration),slot:idx,rel:e.phiRest,r:e.rRest},tries};
  }
 }
 throw new Error('No valid launch found');
}
if(parentPort){try{parentPort.postMessage({ok:true,value:solveLaunch(workerData)});}catch(e){parentPort.postMessage({ok:false,error:e.message});}}
