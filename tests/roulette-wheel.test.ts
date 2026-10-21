import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {solveRoulette} from '../lib/roulette-solver';
import {readFileSync} from 'node:fs';
import {PHYS_VERSION,createTrajectory,idleW} from '../lib/roulette-physics';
import {initialAnchor} from '../lib/roulette';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/home/kit/out/cal-browser-evidence/node_modules/playwright');
test('mounted wood canvas receives locked physics and late seek; missing params fail closed',async()=>{
 const anchor=initialAnchor(0),spinStartAt=60000,target=7;
 const solved=await solveRoulette({target,anchor,spinStartAt,seed:77});
 const physics={roundId:'mounted-wood',target,physicsVersion:PHYS_VERSION,lockDeadline:55000,resultGeneratedAt:55001,broadcastAt:55002,spinStartAt,serverNow:55002,idleAnchor:anchor,launchParams:solved.launchParams};
 const trajectory=createTrajectory(physics),resultAt=spinStartAt+solved.durationMs;
 const bundle=await build({stdin:{contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';import Wheel from './app/roulette-wheel';
 const root=createRoot(document.getElementById('root'));window.drawWheel=p=>root.render(<div style={{width:460,height:460}}><Wheel {...p}/></div>);
 `,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',loader:{'.module.css':'empty'}});
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{channel:'chromium'})});
 try{
  const page=await browser.newPage(),errors:string[]=[];page.on('pageerror',(e:Error)=>errors.push(e.message));
  await page.setContent('<!doctype html><meta charset="utf-8"><div id="root"></div>');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const spin={round:1,number:target,startedAt:spinStartAt,resultAt,nextAt:resultAt+5000,physics};
  for(const now of [55002,trajectory.t0+trajectory.duration*.5,resultAt+2000]){
   await page.evaluate((p:any)=>(window as any).drawWheel(p),{spin,now,idleAnchor:anchor});
   await page.locator('canvas').waitFor();
   await page.waitForFunction(()=>{const c=document.querySelector('canvas');return c&&c.width>0&&c.height>0;});
   assert.equal(await page.getByRole('alert').count(),0);
  }
  await page.getByRole('img',{name:'Winning number 7',exact:true}).waitFor();
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>{
   const original=CanvasRenderingContext2D.prototype.drawImage;
   (window as any).wheelComposites=0;
   CanvasRenderingContext2D.prototype.drawImage=function(this:CanvasRenderingContext2D,...args:any[]){
    (window as any).wheelComposites++;
    return (original as any).apply(this,args);
   } as typeof original;
  });
  await page.evaluate((p:any)=>(window as any).drawWheel(p),{spin,now:trajectory.t0+trajectory.f.ev.tRest+100,idleAnchor:anchor});
  await page.waitForFunction(()=>(window as any).wheelComposites>0);
  assert.equal(await page.getByRole('alert').count(),0);
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate((p:any)=>(window as any).drawWheel(p),{spin:{...spin,round:2,physics:{...physics,roundId:'bad',launchParams:undefined}},now:resultAt,idleAnchor:anchor});
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(),/Refresh/);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});


test('reduced-motion mid-spin join uses idle display on the very first canvas draw',async()=>{
 const anchor=initialAnchor(0),spinStartAt=60000,target=7;
 const solved=await solveRoulette({target,anchor,spinStartAt,seed:77});
 const physics={roundId:'first-draw-reduced',target,physicsVersion:PHYS_VERSION,lockDeadline:55000,resultGeneratedAt:55001,broadcastAt:55002,spinStartAt,serverNow:55002,idleAnchor:anchor,launchParams:solved.launchParams};
 const trajectory=createTrajectory(physics),resultAt=spinStartAt+solved.durationMs;
 const now=trajectory.t0+trajectory.f.ev.tRest*.4;
 const bundle=await build({stdin:{contents:`
  import React from 'react';import {createRoot} from 'react-dom/client';import Wheel from './app/roulette-wheel';
  const root=createRoot(document.getElementById('root'));
  window.drawWheel=p=>root.render(<div style={{width:460,height:460}}><Wheel {...p}/></div>);
 `,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',loader:{'.module.css':'empty'},plugins:[{
  name:'record-real-renderer-poses',setup(b){
   b.onLoad({filter:/roulette-render\.mjs$/},args=>({contents:readFileSync(args.path,'utf8').replace(
    'export function drawWood(ctx,w,h,pose){',
    'export function drawWood(ctx,w,h,pose){window.wheelDraws.push({...pose,mediaReduced:matchMedia("(prefers-reduced-motion: reduce)").matches});'
   ),loader:'js'}));
  }
 }]});
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{channel:'chromium'})});
 try{
  const page=await browser.newPage(),errors:string[]=[];
  page.on('pageerror',(e:Error)=>errors.push(e.message));
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.setContent('<!doctype html><meta charset="utf-8"><div id="root"></div>');
  await page.evaluate(()=>{(window as any).wheelDraws=[];});
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.evaluate((p:any)=>(window as any).drawWheel(p),{
   spin:{round:1,number:target,startedAt:spinStartAt,resultAt,nextAt:resultAt+5000,physics},
   now,idleAnchor:anchor
  });
  await page.waitForFunction(()=>(window as any).wheelDraws.length>=3);
  const draws=await page.evaluate(()=>(window as any).wheelDraws);
  assert.ok(draws.length>=3);
  for(const [i,p] of draws.entries()){
   assert.equal(p.mediaReduced,true);
   assert.equal(p.W,idleW(anchor,trajectory.t0+p.e),'draw '+i+' must already use the reduced idle wheel');
   assert.equal(p.vis,0,'mid-spin reduced ball must already be hidden on draw '+i);
   assert.equal(p.phi,anchor.rel);
  }
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.waitForFunction(()=>(window as any).wheelDraws.some((p:any)=>!p.mediaReduced&&p.vis===1));
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
