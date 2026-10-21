import {mutate} from './store';
import {register} from './poker';
import {ensure} from './errors';
import {rouletteAction,rouletteTick,rouletteState,initialAnchor,ROULETTE_MS,type RouletteAction,type RouletteState} from './roulette';
import {ROULETTE_OPEN_MS,ROULETTE_RESULT_MS} from './roulette-clock';
import {PHYS_VERSION,type PhysicsRound} from './roulette-physics';
import {solveRoulette} from './roulette-solver';
import {randomInt,randomUUID} from 'node:crypto';
import type {Identity,Room} from './types';
import {readRoom} from './db';
type RRoom=Room&{roulette?:RouletteState};
const jobs=new Map<string,Promise<void>>();

/** Two separate committed CAS transitions: persist lock first, THEN draw target.
 * Pending targets are private; publication/settlement is another round-id CAS.
 * Competing processes may solve, but cannot choose or settle a second result. */
export async function tickRoulette(){
 const r=await readRoom(),b=(r as RRoom).roulette,now=Date.now();
 if(!b){await mutate(r=>{rouletteState(r,Date.now());});return;}
 if(b.spin){if(now>=b.spin.nextAt)await mutate(r=>rouletteTick(r,Date.now()));return;}
 if(now<b.started+ROULETTE_OPEN_MS||b.pending&&jobs.has(b.pending.id))return;
 const locked=(await mutate(r=>{
  const s=rouletteState(r,Date.now());
  if(s.spin||Date.now()<s.started+ROULETTE_OPEN_MS)return;
  s.anchor??=initialAnchor(s.started);
  s.pending??={id:randomUUID(),lockedAt:Date.now()};
 })).room as RRoom;
 const pending=locked.roulette?.pending;
 if(!pending)return;
 // Re-read state within the NEXT mutation. The lock above is already durable.
 const chosen=(await mutate(r=>{
  const s=(r as RRoom).roulette;
  if(s?.pending?.id!==pending.id||s.spin)return;
  if(s.pending.target===undefined){s.pending.target=randomInt(37);s.pending.generatedAt=Date.now();}
 })).room as RRoom;
 const state=chosen.roulette;
 if(!state?.pending||state.pending.id!==pending.id||state.pending.target===undefined||jobs.has(pending.id))return;
 const job=prepareRound(structuredClone(state)).catch(error=>{
  console.error('Roulette physics preparation failed:',error instanceof Error?error.message:'unknown');
 }).finally(()=>jobs.delete(pending.id));
 jobs.set(pending.id,job);
}
async function prepareRound(state:RouletteState){
 const pending=state.pending!,anchor=state.anchor??initialAnchor(state.started);
 let prep=5000;
 for(let attempt=0;attempt<5;attempt++){
  const began=Date.now(),spinStartAt=Math.max(state.started+ROULETTE_MS,began+prep);
  const solved=await solveRoulette({target:pending.target!,anchor,spinStartAt,seed:randomInt(2**31)});
  // Solve actual analytic anchor at THIS start time. Never shift a solved launch.
  if(Date.now()>spinStartAt-1500){prep=Math.max(prep*2,(Date.now()-began)*2+3000);continue;}
  await mutate(r=>{
   const s=(r as RRoom).roulette,now=Date.now();
   if(!s||s.spin||s.pending?.id!==pending.id||s.pending.target!==pending.target)return;
   if(now>spinStartAt-500)return;
   const physics:PhysicsRound={roundId:pending.id,target:pending.target!,physicsVersion:PHYS_VERSION,lockDeadline:pending.lockedAt,resultGeneratedAt:pending.generatedAt!,broadcastAt:now,serverNow:now,spinStartAt,idleAnchor:anchor,launchParams:solved.launchParams};
   const resultAt=spinStartAt+solved.durationMs;
   rouletteTick(r,now,()=>{throw new Error('Prepared spin must not draw a result');},{round:s.round,number:pending.target!,startedAt:spinStartAt,resultAt,nextAt:resultAt+ROULETTE_RESULT_MS,physics});
   s.anchor=solved.endAnchor;
  });
  const current=(await readRoom() as RRoom).roulette;
  if(current?.spin||current?.pending?.id!==pending.id)return;
  prep*=2;
 }
 throw new Error('Unable to publish a future roulette launch');
}

export async function rouletteMove(who:Identity,action:RouletteAction,round:number,requestId:string,requestAt:number){
 return (await mutate(r=>{
  register(r,who);const now=Date.now();ensure(now-requestAt>=-10_000&&now-requestAt<=120_000,'Request expired.',409);
  const receipt=r.receipts.find(x=>x.id===requestId);if(receipt){ensure(receipt.userId===who.id,'Invalid request.',409);return;}
  rouletteAction(r,who,action,round,requestId,now);
  r.receipts=[{id:requestId,userId:who.id,at:now},...r.receipts.filter(x=>x.at&&now-x.at<300_000)];
 })).room;
}
