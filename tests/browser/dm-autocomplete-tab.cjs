// Real Chromium/React regression, using the actual DmPanel and static word list.
// No live Clerk account, socket, server restart or private identity is needed.
const path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'../..'),req=createRequire(path.join(root,'package.json'));
const esbuild=req('esbuild');
let playwright;try{playwright=req('playwright');}catch{playwright=require('/opt/hako/lib/node_modules/playwright');}
const {chromium}=playwright;
(async()=>{
 const bundle=await esbuild.build({stdin:{contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';
 import DmPanel from './app/dm-panel';
 createRoot(document.getElementById('root')).render(<><button id="before">Before</button><DmPanel phase="ready" goSetup={()=>{}}/></>);
 `,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'isolated-dm-dependencies',setup(build){
 const mocks={
  '@clerk/nextjs':'export const useUser=()=>({user:{id:"test"}});',
  './live-provider':'const request=async(event)=>event==="dm:profile"?{username:"able about zoo wish"}:{threads:[]};export const useLive=()=>({request,connection:"connected"});export const useLiveEvent=()=>{};',
  '@/lib/chat-store':'export const indexedDbStore=()=>({getIdentity:async()=>({deviceId:"test"})});export const getDmPin=()=>{};export const putDmPin=()=>{};'
 };
 build.onResolve({filter:/.*/},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'dm-mock'}:undefined);
 build.onLoad({filter:/.*/,namespace:'dm-mock'},args=>({contents:mocks[args.path],loader:'js'}));
 }}]});
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  for(const viewport of [{width:1365,height:900},{width:390,height:844}]){
   const page=await browser.newPage({viewport}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.setContent('<!doctype html><meta charset="utf-8"><div id="root"></div>');
   await page.addScriptTag({content:bundle.outputFiles[0].text});
   const input=page.getByRole('combobox',{name:'Exact username'}),message=page.getByRole('button',{name:'Message',exact:true});
   for(let n=0;n<3;n++){
    await input.fill('ab');await page.getByRole('listbox').waitFor();
    await input.press('Tab');
    assert.equal(await message.evaluate(el=>document.activeElement===el),true,'Tab should reach Message');
    await page.waitForFunction(()=>!document.querySelector('[role=listbox]'));
    await message.press('Shift+Tab');
    assert.equal(await input.evaluate(el=>document.activeElement===el),true,'Shift+Tab should return to input');
    await input.press('End');await page.getByRole('listbox').waitFor();
    await input.press('Shift+Tab');
    assert.equal(await page.locator('#before').evaluate(el=>document.activeElement===el),true,'Shift+Tab should reach preceding control');
   }
   assert.deepEqual(errors,[]);await page.close();
  }
  console.log('PASS actual DmPanel native Tab / Shift+Tab at desktop and mobile sizes, three repetitions each');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
