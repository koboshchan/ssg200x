// Real Chromium regression with the actual DmPanel and app/globals.css: suggestions must sit above populated threads.
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'../..'),req=createRequire(path.join(root,'package.json'));
const esbuild=req('esbuild');
let playwright;try{playwright=req('playwright');}catch{playwright=require('/opt/hako/lib/node_modules/playwright');}
const {chromium}=playwright;
const css=fs.readFileSync(path.join(root,'app/globals.css'),'utf8');
(async()=>{
 const bundle=await esbuild.build({stdin:{contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';
 import DmPanel from './app/dm-panel';
 createRoot(document.getElementById('root')).render(<aside className="chat-dock"><DmPanel phase="ready" goSetup={()=>{}}/></aside>);
 `,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'mocks',setup(build){
 const mocks={
  '@clerk/nextjs':'export const useUser=()=>({user:{id:"test"}});',
  './live-provider':'const th=[{userId:"u1",username:"able about zoo wish",displayName:"Alice",updatedAt:Date.now(),blocked:false},{userId:"u2",username:"moon tower burger drum",displayName:"Bob",updatedAt:Date.now()-9e4,blocked:false}];const request=async(event)=>event==="dm:profile"?{username:"announce direct raw age"}:{threads:th};export const useLive=()=>({request,connection:"connected"});export const useLiveEvent=()=>{};',
  '@/lib/chat-store':'export const indexedDbStore=()=>({getIdentity:async()=>({deviceId:"test"})});export const getDmPin=()=>{};export const putDmPin=()=>{};'
 };
 build.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'m'}:undefined);
 build.onLoad({filter:/.*/,namespace:'m'},a=>({contents:mocks[a.path],loader:'js'}));
 }}]});
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  for(const [name,viewport,touch] of [['desktop',{width:1365,height:900},false],['mobile390',{width:390,height:844},true]]){
   const ctx=await browser.newContext({viewport,hasTouch:touch,isMobile:touch}),page=await ctx.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.setContent('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>');
   await page.addStyleTag({content:css});
   await page.addScriptTag({content:bundle.outputFiles[0].text});
   await page.getByText('Alice').waitFor();
   const input=page.getByRole('combobox',{name:'Exact username'});
   await input.fill('mo');await page.getByRole('listbox').waitFor();
   const n=await page.locator('[role=option]').count();assert.ok(n>0);
   const shot=path.join(process.env.DM_SHOT_DIR||'/tmp','dm-suggestions-'+name+'.png');
   await page.screenshot({path:shot});
   const hits=await page.evaluate(()=>[...document.querySelectorAll('[role=option]')].map(o=>{
    const r=o.getBoundingClientRect(),list=o.parentElement.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
    const top=document.elementFromPoint(x,y);return {top:top&&(top.tagName+'.'+top.className+' '+top.textContent.slice(0,20)),ok:!!top&&(top===o||o.contains(top)),vis:r.bottom<=list.bottom+1&&r.top>=list.top-1&&y<innerHeight};
   }));
   for(const h of hits.filter(h=>h.vis))assert.equal(h.ok,true,name+': option covered by '+h.top);
   assert.ok(hits.filter(h=>h.vis).length>0);
   const covers=await page.evaluate(()=>{const l=document.querySelector('[role=listbox]').getBoundingClientRect(),b=document.querySelector('.dm-threads button').getBoundingClientRect();return {listBottom:l.bottom,threadTop:b.top,overlap:l.bottom>b.top};});
   assert.equal(covers.overlap,true,'test needs the list to overlap threads');
   const first=page.locator('[role=option]').first(),word=await first.innerText();
   if(touch)await first.tap();else await first.click();
   assert.ok((await input.inputValue()).includes(word),name+': click/tap did not pick');
   assert.deepEqual(errors,[]);await ctx.close();
  }
  console.log('PASS suggestions above populated threads, hit-test + click/tap at desktop and 390 mobile');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
