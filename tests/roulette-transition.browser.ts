import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import {freshRoom,register} from '../lib/poker';
import {rouletteState} from '../lib/roulette';
import {solveLaunch} from '../runtime/roulette-solver.mjs';
import {PHYS_VERSION} from '../lib/roulette-physics';
import {publicRoom} from '../lib/public';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/opt/hako/lib/node_modules/playwright');
const who={id:'qa-transition',name:'QA',email:'qa@example.invalid',admin:false};
const r=freshRoom(),start=Date.now();register(r,who,start);rouletteState(r,start);
const initial=publicRoom(r,who),output=process.env.QA_EVIDENCE_DIR||'/tmp/ssg-roulette-transition';mkdirSync(output,{recursive:true});
async function main(){
 const bundle=await build({stdin:{contents:`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import Roulette from './app/roulette-client';function Harness(){const [room,setRoom]=useState(window.initialRoom);window.updateRoom=setRoom;return <Roulette room={room} busy={false} post={async()=>{throw Error('No bets allowed in transition QA')}}/>}createRoot(document.getElementById('root')).render(<Harness/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',loader:{'.module.css':'empty'},define:{'process.env.NODE_ENV':'"production"'},plugins:process.env.QA_BASELINE_REF?[{name:'baseline-roulette',setup(b){b.onLoad({filter:/app\/roulette-client\.tsx$/},()=>({contents:execFileSync('git',['show',process.env.QA_BASELINE_REF+':app/roulette-client.tsx'],{encoding:'utf8'}),loader:'tsx'}));}}]:[]});
 const browser=await chromium.launch({headless:true});
 const errors:string[]=[],phases:string[]=[];
 try{
  const page=await browser.newPage({viewport:{width:1100,height:900},reducedMotion:'reduce'});page.on('pageerror',(e:Error)=>errors.push(e.message));
  let enabled=true;
  await page.route('https://roulette.test/**',async(route:any)=>{if(route.request().url().includes('/api/features'))return route.fulfill({json:{features:{roulette:enabled}}});return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><div id="root"></div>'});});
  await page.goto('https://roulette.test');await page.evaluate((room:any)=>{(window as any).initialRoom=room},process.env.QA_BASELINE_LOCKED?{...initial,serverNow:start+55000}:initial);await page.addScriptTag({content:bundle.outputFiles[0].text});
  async function update(room:any,label:string){await page.evaluate((room:any)=>(window as any).updateRoom(room),room);await page.getByText(label,{exact:true}).last().waitFor({timeout:5000});assert.deepEqual(errors,[]);phases.push(label);}
  if(process.env.QA_BASELINE_LOCKED){await page.getByText('Locked',{exact:true}).waitFor();await update(initial,'Open');return;}
  await page.getByText('Open',{exact:true}).waitFor();
  // Same component instance through all boundaries, including first-load null table.
  if(!process.env.QA_SKIP_NULL){await update({...initial,roulette:null},'Opening the shared table…');await update(initial,'Open');}
  const table=initial.roulette!,solved=solveLaunch({target:7,anchor:table.idleAnchor,spinStartAt:start+60000,seed:61007}),resultAt=start+60000+solved.durationMs,spin={round:1,number:7,startedAt:start+60000,resultAt,nextAt:resultAt+5000,physics:{roundId:'browser-1',target:7,physicsVersion:PHYS_VERSION,lockDeadline:start+55000,resultGeneratedAt:start+55001,broadcastAt:start+55002,serverNow:start+55002,spinStartAt:start+60000,idleAnchor:table.idleAnchor,launchParams:solved.launchParams}};
  await update({...initial,serverNow:start+55000},'Locked');
  await update({...initial,serverNow:start+60000,roulette:{...table,spin}},'Spinning');
  await update({...initial,serverNow:resultAt,roulette:{...table,spin,history:[{round:1,number:7,at:resultAt,winners:[]}]}},'Result');
  await page.screenshot({path:output+'/result.png',fullPage:true});
  const next={...initial,serverNow:spin.nextAt,roulette:{...table,round:2,started:spin.nextAt,locksAt:spin.nextAt+55000,spinsAt:spin.nextAt+60000,idleAnchor:solved.endAnchor,spin:null}};
  await update(next,'Open');
  enabled=false;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).filter(b=>b.textContent==='Red').every(b=>b.disabled));
  assert.equal(await page.getByRole('button',{name:'$5 chip',exact:true}).isDisabled(),true);
  enabled=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Red'&&!b.disabled));
  assert.equal(await page.getByRole('alert').count(),0);assert.deepEqual(errors,[]);writeFileSync(output+'/evidence.json',JSON.stringify({phases,featureToggle:true,errors,mode:'production React mounted actual Roulette; no server/wallet writes'},null,2));console.log('PASS roulette null/betting/locked/spinning/result/next betting + feature off/on',phases);
 }finally{writeFileSync(output+'/last-errors.json',JSON.stringify(errors));await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
