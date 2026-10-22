import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlinkoAnimation,samplePlinkoAnimation} from '../lib/plinko-animation';

test('all 256 server paths on desktop/mobile land exact buckets with continuous bounded gravity flights',()=>{
 let maxStep=0,minDuration=Infinity,maxDuration=0;
 for(const [width,height] of [[420,300],[342,250],[280,250]])for(let bits=0;bits<256;bits++){
  const path=Array.from({length:8},(_,i)=>(bits>>i)&1),slot=path.reduce((a,b)=>a+b,0);
  const a=createPlinkoAnimation(path,slot,{width,height},String(bits));
  assert.equal(a.flights.length,9);assert.ok(a.duration>1&&a.duration<4);
  minDuration=Math.min(minDuration,a.duration);maxDuration=Math.max(maxDuration,a.duration);
  assert.deepEqual(samplePlinkoAnimation(a,a.duration),{x:(slot+.5)*width/9,y:height-38});
  for(let i=0;i<a.flights.length;i++){
   const f=a.flights[i];
   assert.ok(Math.abs(f.start.y+f.vy*f.duration+.5*f.gravity*f.duration**2-f.end.y)<1e-8);
   if(i){assert.deepEqual(f.start,a.flights[i-1].end);assert.ok(f.vy<0);}
   const before=samplePlinkoAnimation(a,f.at+f.duration-1e-8),after=samplePlinkoAnimation(a,f.at+f.duration+1e-8);
   assert.ok(Math.hypot(after.x-before.x,after.y-before.y)<1e-4);
  }
  let last=samplePlinkoAnimation(a,0);
  for(let t=1/60;t<a.duration;t+=1/60){const p=samplePlinkoAnimation(a,t);const step=Math.hypot(p.x-last.x,p.y-last.y);maxStep=Math.max(maxStep,step);assert.ok(step<7);assert.ok(p.x>=0&&p.x<=width);last=p;}
 }
 console.log({maxStep,minDuration,maxDuration});
});
test('seed varies motion but not settlement, endpoint overrides and validation',()=>{
 const path=[0,1,0,1,0,1,0,1],g={width:420,height:300,landingX:210,landingY:262};
 const a=createPlinkoAnimation(path,4,g,'one'),b=createPlinkoAnimation(path,4,g,'two');
 assert.notDeepEqual(a,b);assert.deepEqual(samplePlinkoAnimation(a,99),{x:210,y:262});assert.deepEqual(samplePlinkoAnimation(b,99),{x:210,y:262});
 assert.deepEqual(a,createPlinkoAnimation(path,4,g,'one'));
 assert.throws(()=>createPlinkoAnimation(path,5,g));assert.throws(()=>createPlinkoAnimation([],0,g));assert.throws(()=>createPlinkoAnimation(path,4,{width:0,height:300}));
});
test('eight concurrent balls require only bounded direct sampling, no search or engine stepping',()=>{
 const balls=Array.from({length:8},(_,i)=>createPlinkoAnimation(Array(8).fill(i%2),i%2?8:0,{width:342,height:250},String(i)));
 for(let frame=0;frame<240;frame++)for(const ball of balls){const p=samplePlinkoAnimation(ball,frame/60);assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));}
});
