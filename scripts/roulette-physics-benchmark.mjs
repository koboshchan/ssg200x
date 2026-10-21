import {writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import * as P from '../runtime/roulette-physics.mjs';
import {solveLaunch} from '../runtime/roulette-solver.mjs';
const out=process.argv[2]||'out/roulette-v2-benchmark.json',steps=[];
for(const stepMs of [4,8,12,16,20,24,32,48]){
 P.PHY.stepMs=stepMs;const began=performance.now();let settled=0,maxPen=0,minSpeedRatio=1,minDot=1,contacts=0;const pockets=new Set();
 for(let j=0;j<500;j++){
  const wp=P.makeWheel(j*.17,P.idleRate(),P.SPIN_VP*(.96+j%9/100),P.SPIN_TUP,P.SPIN_TAU);
  wp.r0=.6;const f=P.simulate(wp,j*.17+(j%37)*P.STEP,P.SPIN_WB*(.85+j%31/100),false);
  if(f.ev.tRest!==null){settled++;pockets.add(P.pocketAtRest(f.ev.phiRest));}
  maxPen=Math.max(maxPen,f.ev.maxPen);
  for(const h of f.ev.dia)if(h.sp0>.1){contacts++;minSpeedRatio=Math.min(minSpeedRatio,h.sp1/h.sp0);minDot=Math.min(minDot,h.dot);}
 }
 steps.push({stepMs,settled,pockets:pockets.size,maxPen,minSpeedRatio,minDot,contacts,totalMs:performance.now()-began,acceptable:maxPen<P.PHY.rb});
}
P.PHY.stepMs=16;
let anchor={atMs:0,phase:.6,vel:P.idleRate(),slot:0,rel:0,r:.6},at=60000;const solves=[];
for(const target of P.POCKETS){
 const result=solveLaunch({target,anchor,spinStartAt:at,seed:61000+target});
 solves.push({target,tries:result.tries,solveMs:result.solveMs});
 anchor=result.endAnchor;at=anchor.atMs+60000;
}
const report={steps,selectedMs:16,solves,maxSolveMs:Math.max(...solves.map(s=>s.solveMs)),maxTries:Math.max(...solves.map(s=>s.tries))};
writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
