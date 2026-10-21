import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PHYS_VERSION,POCKETS,idleRate,idleW,idleV,createTrajectory,poseAt,validateRound,type PhysicsRound} from '../lib/roulette-physics';
import {solveRoulette} from '../lib/roulette-solver';
import {rouletteState,roulettePublic,rouletteAction,initialAnchor,rouletteTick} from '../lib/roulette';
import {freshRoom,register,assertRoom} from '../lib/poker';
import {readFileSync} from 'node:fs';
const who={id:'physics',name:'Physics',email:'physics@example.invalid',admin:false};
const base=(target:number,at:number,anchor=initialAnchor(0)):PhysicsRound=>({roundId:'physics-'+target,target,physicsVersion:PHYS_VERSION,lockDeadline:at-5000,resultGeneratedAt:at-4999,broadcastAt:at-4998,spinStartAt:at,serverNow:at-4998,idleAnchor:anchor,launchParams:{d:0,dvk:1,dwb:1}});

test('all 37 fixed labels land with continuous carried state; late joins seek identical trajectories', {timeout:240_000},async()=>{
 let anchor=initialAnchor(0),at=60000,heartbeats=0;
 const timer=setInterval(()=>heartbeats++,5);
 try{
  for(const target of POCKETS){
   const payload=base(target,at,anchor);
   const solved=await solveRoulette({target,anchor,spinStartAt:at,seed:9000+target});
   payload.launchParams=solved.launchParams;
   const sp=createTrajectory(payload),late=createTrajectory({...payload,serverNow:at+5000});
   assert.equal(POCKETS[sp.endAnchor.slot],target);
   assert.deepEqual(sp.endAnchor,solved.endAnchor);
   for(const fraction of [.25,.5,.9]){
    const t=sp.t0+sp.duration*fraction;
    assert.deepEqual(poseAt(sp,t),poseAt(late,t));
   }
   const before=poseAt(sp,sp.t0-.001),launch=poseAt(sp,sp.t0);
   assert.ok(Math.abs(before.W-launch.W)<1e-6);
   assert.ok(Math.abs(before.r-launch.r)<1e-9);
   assert.ok(Math.abs(before.a-launch.a)<1e-6);
   const end=poseAt(sp,sp.endAnchor.atMs),coast=poseAt(sp,sp.endAnchor.atMs+.001);
   assert.ok(Math.abs(end.W-coast.W)<1e-6);
   for(const ms of [0,1000,10000,60000]){
    const t=sp.endAnchor.atMs+ms,p=poseAt(sp,t);
    assert.equal(p.W,idleW(solved.endAnchor,t));assert.equal(p.r,solved.endAnchor.r);
    assert.ok(Math.abs(p.phi-solved.endAnchor.rel)<1e-12);
    assert.equal(poseAt(sp,t,true).W,p.W);
   }
   // Full C1 wheel handoff, not just phase continuity.
   const t=sp.endAnchor.atMs,dt=.01,left=(poseAt(sp,t).W-poseAt(sp,t-dt).W)/dt,right=(poseAt(sp,t+dt).W-poseAt(sp,t).W)/dt;
   assert.ok(Math.abs(left-right)<1e-8);
   assert.ok(Math.abs(idleV(solved.endAnchor,t)-solved.endAnchor.vel)<1e-12);
   anchor=sp.endAnchor;at=anchor.atMs+60000;
  }
 }finally{clearInterval(timer);}
 assert.ok(heartbeats>10,'solver must leave the event loop available');
 assert.ok(Math.abs(idleV(anchor,anchor.atMs+120000)-idleRate())<1e-12);
});

test('client rejects pre-lock results, missing params, version mismatch and invalid timestamps',()=>{
 const valid=base(1,60000);
 validateRound(valid);
 for(const patch of [
  {resultGeneratedAt:valid.lockDeadline-1},
  {broadcastAt:valid.resultGeneratedAt-1},
  {broadcastAt:valid.spinStartAt+1},
  {serverNow:valid.resultGeneratedAt-1},
  {physicsVersion:'old'},
  {launchParams:undefined},
  {idleAnchor:undefined},
  {launchParams:{d:-1,dvk:1,dwb:1}},
  {launchParams:{d:0,dvk:Infinity,dwb:1}},
  {target:37},
 ])assert.throws(()=>validateRound({...valid,...patch} as PhysicsRound));
 // A late join is valid; timestamps must not restart animation.
 validateRound({...valid,serverNow:900000});
});

test('persisted lock rejects bets and never serializes pending target or seed',()=>{
 const r=freshRoom();register(r,who);const b=rouletteState(r,0);
 rouletteAction(r,who,{type:'bet',bet:{kind:'red',amount:100}},1,'chip',1000);
 assert.equal('physics' in roulettePublic(r,who,1000)!,false);
 b.pending={id:'locked',lockedAt:55000};
 assert.throws(()=>rouletteAction(r,who,{type:'cancel',betId:'chip'},1,'cancel',55000));
 b.pending.target=17;b.pending.generatedAt=55001;
 const view=roulettePublic(r,who,55002)!;
 assert.equal(view.spin,null);assert.doesNotMatch(JSON.stringify(view),/target|seed|launchParams|generatedAt|pending/);
 assert.throws(()=>rouletteTick(r,60000,()=>17),/requires solved physics/);
 assertRoom(r);
});

test('production entrypoint commits a lock before drawing and uses worker_threads, never client search',()=>{
 const store=readFileSync('lib/roulette-store.ts','utf8'),client=readFileSync('app/roulette-wheel.tsx','utf8');
 assert.ok(store.indexOf('const locked=')<store.indexOf('const chosen='));
 assert.ok(store.indexOf('const chosen=')<store.indexOf('randomInt(37)'));
 assert.match(readFileSync('lib/roulette-solver.ts','utf8'),/new Worker/);
 assert.doesNotMatch(client,/solveRoulette|solveLaunch|Math.random|randomInt|labelOffset|newOff/);
});

test('physics version hashes the complete shared implementation',async()=>{
 const {createHash}=await import('node:crypto');
 const source=readFileSync('runtime/roulette-physics.mjs','utf8').replace(/export const PHYS_VERSION='[a-f0-9]+';/,"export const PHYS_VERSION='PHYSICS_HASH';");
 assert.equal(PHYS_VERSION,createHash('sha256').update(source).digest('hex').slice(0,16));
});

test('prepared physics settlement preserves escrow and continuous anchor across next round',async()=>{
 const r=freshRoom();register(r,who);const b=rouletteState(r,0);
 rouletteAction(r,who,{type:'bet',bet:{kind:'straight',pick:7,amount:100}},1,'seven',1000);
 b.pending={id:'lock',lockedAt:55000,target:7,generatedAt:55001};
 const anchor=b.anchor!,start=60000,solved=await solveRoulette({target:7,anchor,spinStartAt:start,seed:23});
 const physics={...base(7,start,anchor),roundId:'lock',launchParams:solved.launchParams};
 const resultAt=start+solved.durationMs;
 rouletteTick(r,56000,()=>{throw Error('No second draw');},{round:1,number:7,startedAt:start,resultAt,nextAt:resultAt+5000,physics});
 b.anchor=solved.endAnchor;
 assert.equal(r.members[0].wallet,103500);assertRoom(r);
 assert.equal(roulettePublic(r,who,56000)!.phase,'locked');
 assert.equal(roulettePublic(r,who,56000)!.history.length,0);
 assert.equal(roulettePublic(r,who,start)!.phase,'spinning');
 assert.equal(roulettePublic(r,who,resultAt)!.phase,'result');
 assert.equal(roulettePublic(r,who,resultAt)!.history[0].number,7);
 const snapshot=structuredClone(r);
 assert.equal(rouletteTick(r,resultAt+4999),false);assert.deepEqual(r,snapshot);
 assert.equal(rouletteTick(r,resultAt+5000),true);
 assert.deepEqual(b.anchor,solved.endAnchor);
 assert.equal(b.round,2);assert.equal(b.spin,undefined);assert.equal(b.pending,undefined);
 assert.deepEqual(roulettePublic(r,who,resultAt+5000)!.idleAnchor,solved.endAnchor);assertRoom(r);
});
