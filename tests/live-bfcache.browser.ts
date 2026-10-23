import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {build} from 'esbuild';
import {Server} from 'socket.io';
import {emitState} from '../runtime/state-stream.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'/opt/hako/lib/node_modules/playwright');
const output=process.env.QA_EVIDENCE_DIR||'/tmp/ssg-live-bfcache';mkdirSync(output,{recursive:true});
async function main(){
 let js='',connections=0,maxActive=0,active=0,renews=0;const tokens:string[]=[],reports:string[]=[];
 const http=createServer((req,res)=>{
  if(req.url==='/bundle.js'){res.setHeader('content-type','application/javascript');res.end(js);}
  else if(req.url==='/api/features'){res.setHeader('content-type','application/json');res.end('{"features":{}}');}
  else if(req.url==='/favicon.ico'){res.setHeader('content-type','image/x-icon');res.end(readFileSync('public/favicon.ico'));}
  else {res.setHeader('content-type','text/html');res.end('<!doctype html><meta charset="utf-8">'+(req.url==='/away'?'<p>Away</p>':'<div id="root"></div><script src="/bundle.js"></script>'));}
 });
 const server=new Server(http,{transports:['websocket']});
 server.use((s,next)=>{tokens.push(s.handshake.auth.token);if(typeof s.handshake.auth.token!=='string'||!s.handshake.auth.token.startsWith('fresh-'))return next(Error('unauthorized'));next();});
 server.on('connection',s=>{connections++;active++;maxActive=Math.max(maxActive,active);s.on('disconnect',()=>active--);s.on('auth:renew',(_p,ack)=>{renews++;ack({ok:true});});s.on('tab:report',p=>reports.push(p.route));emitState(s,'room:state',{testSequence:connections},true);});
 await new Promise<void>(r=>http.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+(http.address() as any).port;
 const mocks:Record<string,string>={
  '@clerk/nextjs':"export const useAuth=()=>({getToken:async()=>{window.tokenCalls++;if(window.holdToken)return new Promise(r=>window.finishToken=r);return window.tokenValue??('fresh-'+window.tokenCalls)}});",
  'next/navigation':"export const usePathname=()=>location.pathname;",
  './release-provider':"const api={observe(){},observeFeatures(){},async check(){}};export const useRelease=()=>api;",
 };
 const stubs=['./payment-announcement','./check-in-banner','./advancement-announcement','./airdrop-announcement'];
 const result=await build({stdin:{contents:`import React,{useEffect} from 'react';import {createRoot} from 'react-dom/client';import LiveProvider,{useLive} from './app/live-provider';window.tokenCalls=0;window.events=[];window.mountId=Math.random();const root=createRoot(document.getElementById('root'));window.unmount=()=>root.unmount();function Probe(){const live=useLive();window.live=live;useEffect(()=>live.subscribe('room:state',p=>window.events.push(p)),[live.subscribe]);return <p id="connection">{live.connection}</p>}root.render(<LiveProvider><Probe/></LiveProvider>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',loader:{'.module.css':'empty'},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'isolated-auth-and-display-mocks',setup(b){b.onResolve({filter:/.*/},args=>mocks[args.path]||stubs.includes(args.path)?{path:args.path,namespace:'qa-mock'}:undefined);b.onLoad({filter:/.*/,namespace:'qa-mock'},args=>({contents:mocks[args.path]||'export default function Stub(){return null}',loader:'js'}));}}]});
 js=result.outputFiles[0].text;
 const browser=await chromium.launch({headless:true,channel:'chromium',ignoreDefaultArgs:['--disable-back-forward-cache'],args:['--enable-features=BackForwardCache']});
 const errors:string[]=[],bfcacheReasons:any[]=[];let actualBFCache=false;
 try{
  const page=await browser.newPage();const cdp=await page.context().newCDPSession(page);await cdp.send('Page.enable');cdp.on('Page.backForwardCacheNotUsed',(e:any)=>bfcacheReasons.push(e.notRestoredExplanations));page.on('pageerror',(e:Error)=>errors.push(e.message));
  await page.goto(url+'/wallet');await page.locator('#connection').filter({hasText:'connected'}).waitFor();
  await page.waitForFunction(()=>document.getElementById('connection')?.textContent==='connected');
  await page.waitForFunction(()=>(window as any).events.length===1);const initial=connections;
  // Pause while a token refresh is unresolved. Its completion must never renew.
  await page.evaluate(()=>{(window as any).holdToken=true;});
  server.emit('auth:refresh');await page.waitForFunction(()=>!!(window as any).finishToken);
  await page.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));(window as any).finishToken('old-secret');(window as any).holdToken=false;});
  await page.waitForFunction(()=>document.getElementById('connection')?.textContent==='disconnected');assert.equal(renews,0);
  await page.waitForTimeout(1300);assert.equal(connections,initial);assert.equal(active,0);
  const staleReplay=await page.evaluate(()=>{let replay=0;const off=(window as any).live.subscribe('room:state',()=>replay++);off();return replay;});assert.equal(staleReplay,0);
  for(let i=0;i<3;i++){
   const before=connections;
   await page.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
   await page.waitForFunction(()=>document.getElementById('connection')?.textContent==='connected');
   assert.equal(connections,before+1);await page.waitForFunction((n:number)=>(window as any).events.length===n,connections);
   if(i<2){await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));await page.waitForFunction(()=>document.getElementById('connection')?.textContent==='disconnected');}
  }
  // One auth listener after repeated resume, no stale renewals.
  const beforeCalls=await page.evaluate(()=>(window as any).tokenCalls);server.emit('auth:refresh');
  await page.waitForFunction((n:number)=>(window as any).tokenCalls===n+1,beforeCalls);
  await page.waitForTimeout(100);assert.equal(renews,1);assert.equal(maxActive,1);
  // A handshake token resolving after pagehide must not open a connection.
  const beforeHandshake=connections;
  await page.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));(window as any).holdToken=true;(window as any).finishToken=undefined;window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
  await page.waitForFunction(()=>!!(window as any).finishToken);
  await page.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));(window as any).finishToken('fresh-stale-handshake');(window as any).holdToken=false;});
  await page.waitForTimeout(200);assert.equal(connections,beforeHandshake);assert.equal(active,0);
  // Revoked/missing auth on restore must fail closed, never reuse old token.
  await page.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));(window as any).tokenValue='revoked';window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
  await page.waitForFunction(()=>document.getElementById('connection')?.textContent==='disconnected');assert.equal(active,0);assert.equal(tokens.at(-1),'revoked');
  await page.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));delete (window as any).tokenValue;window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
  await page.waitForFunction(()=>document.getElementById('connection')?.textContent==='connected');
  // Genuine history navigation, record whether this Chromium used BFCache.
  const mount=await page.evaluate(()=>(window as any).mountId);
  await page.evaluate(()=>window.addEventListener('pageshow',e=>(window as any).restored=e.persisted));
  await page.evaluate(()=>{const a=document.createElement('a');a.href='/away';a.id='leave';a.textContent='Leave';document.body.append(a);});await page.locator('#leave').click();await page.waitForURL(url+'/away');await page.goBack({waitUntil:'commit'});await page.waitForFunction(()=>document.getElementById('connection')?.textContent==='connected');
  actualBFCache=await page.evaluate((mount:number)=>(window as any).mountId===mount&&(window as any).restored===true,mount);
  const favicon=await page.request.get(url+'/favicon.ico');assert.equal(favicon.status(),200);assert.match(favicon.headers()['content-type'],/image/);assert.ok((await favicon.body()).length>1000);
  // Unmount removes page lifecycle listeners, so a later pageshow cannot reconnect.
  await page.evaluate(()=>(window as any).unmount());await page.waitForTimeout(100);const count=connections;
  await page.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});await page.waitForTimeout(1200);
  assert.equal(connections,count);assert.equal(active,0);assert.deepEqual(errors,[]);assert.ok(reports.every(p=>p==='/wallet'));
  const evidence={connections,maxActive,renews,actualBFCache,bfcacheReasons,staleReplay,handshakes:tokens.map(t=>t==='revoked'?'revoked':'fresh'),errors,syntheticPersistedCycles:3,unmountCleanup:true,favicon:200,auth:'stub Clerk tokens validated only by local socket server; no production traffic'};
  writeFileSync(output+'/evidence.json',JSON.stringify(evidence,null,2));console.log('PASS mounted LiveProvider lifecycle',evidence);
 }finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
