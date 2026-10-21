import test from 'node:test';
import assert from 'node:assert/strict';
import {POCKETS,PHYS_VERSION,createTrajectory,poseAt,idleV,idleW} from '../lib/roulette-physics';
import {solveRoulette} from '../lib/roulette-solver';
import {initialAnchor} from '../lib/roulette';
import {MAX_SOLVER_TRIES,MAX_SOLVE_MS,solveLaunch} from '../runtime/roulette-solver.mjs';
import {readFileSync} from 'node:fs';

test('coarse physics preserves forward diamond motion, all labels and both-mode seeking across real idle gaps',async()=>{
 let anchor=initialAnchor(0),at=60000,previous:ReturnType<typeof createTrajectory>|null=null;
 const starts:number[]=[];
 for(const target of POCKETS){
  const solved=await solveRoulette({target,anchor,spinStartAt:at,seed:61000+target});
  assert.ok(solved.tries<=MAX_SOLVER_TRIES);assert.ok(solved.solveMs<MAX_SOLVE_MS+100);
  const physics={roundId:'v2-'+target,target,physicsVersion:PHYS_VERSION,lockDeadline:at-5000,resultGeneratedAt:at-4999,broadcastAt:at-4998,serverNow:at-4998,spinStartAt:at,idleAnchor:anchor,launchParams:solved.launchParams};
  const sp=createTrajectory(physics);starts.push(poseAt(sp,sp.t0).a);
  assert.equal(POCKETS[sp.endAnchor.slot],target);
  const events=(sp.f.ev as unknown as {dia:{sp0:number;sp1:number;dot:number}[]}).dia;
  for(const h of events)if(h.sp0>.1){assert.ok(h.sp1/h.sp0>.995);assert.ok(h.dot>.9999);}
  for(const reduced of [false,true]){
   const late=createTrajectory({...physics,serverNow:sp.t0+sp.duration*.5});
   for(const fraction of [.25,.5,.9])assert.deepEqual(poseAt(sp,sp.t0+sp.duration*fraction,reduced),poseAt(late,sp.t0+sp.duration*fraction,reduced));
   if(previous)for(const t of [previous.endAnchor.atMs+1000,at,sp.t0]){
    const p=poseAt(previous,t,reduced),q=poseAt(sp,t,reduced);
    assert.ok(Math.abs(p.a-q.a)<1e-10);assert.equal(p.W,q.W);assert.equal(p.r,q.r);
   }
  }
  const end=sp.endAnchor.atMs,dt=.01;
  const left=(poseAt(sp,end).a-poseAt(sp,end-dt).a)/dt,right=(poseAt(sp,end+dt).a-poseAt(sp,end).a)/dt;
  assert.ok(Math.abs(left-right)<1e-8,'seated ball C1');
  assert.ok(idleW(sp.endAnchor,end+60000)>idleW(sp.endAnchor,end+1000));
  assert.ok(idleV(sp.endAnchor,end+60000)>0);
  previous=sp;anchor=sp.endAnchor;at=anchor.atMs+60000;
 }
 for(let i=1;i<starts.length;i++)assert.ok(Math.abs(Math.atan2(Math.sin(starts[i]-starts[i-1]),Math.cos(starts[i]-starts[i-1])))>.01,'successive launch starts must visibly vary');
});
test('solver caps cannot be raised and integrator has no substeps or impact bisection',()=>{
 assert.throws(()=>solveLaunch({target:0,anchor:initialAnchor(0),spinStartAt:60000,seed:1,maxTries:MAX_SOLVER_TRIES+1}),/cap/);
 const source=readFileSync('runtime/roulette-physics.mjs','utf8');
 assert.match(source,/stepMs:16/);assert.doesNotMatch(source,/nsub|for\(let it=0;it<30|dtFine|dtCoarse/);
});
