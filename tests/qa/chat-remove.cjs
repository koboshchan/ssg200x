// Real Chromium IndexedDB + exact Room/Bubble source + production client/crypto/store.
// Injected transport only, no external accounts, server writes, or production chat sends.
// Run CHAT_QA_PLAYWRIGHT=/path/to/playwright node tests/qa/chat-remove.cjs
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const http=require('node:http'),assert=require('node:assert/strict');
const esbuild=require('esbuild');
const {chromium}=require(process.env.CHAT_QA_PLAYWRIGHT||'playwright');
(async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'tabletalk-remove-'));
 let browser,server;
 const report={kind:'Chromium real IndexedDB, exact Room/Bubble, production ChatClient/crypto/store, injected transport',checks:[]};
 try{
  const root=process.cwd(),source=fs.readFileSync('app/chat-dock.tsx','utf8');
  const room=source.slice(source.indexOf('function Room('));
  const entry=path.join(tmp,'fixture.tsx');
  fs.writeFileSync(entry,`
import React,{useState,useRef,useEffect,useSyncExternalStore} from "${root}/node_modules/react";
import {createRoot} from "${root}/node_modules/react-dom/client";
import {ChatClient} from "${root}/lib/chat-client";
import {indexedDbStore} from "${root}/lib/chat-store";
import {createIdentity,newEpochKey,MAX_TEXT_BYTES} from "${root}/lib/chat-crypto";
const group=(s:string)=>s,time=(n:number)=>new Date(n).toLocaleTimeString();
${room}
async function boot(){
 const store=indexedDbStore();let identity=await store.getIdentity('qa-remove');
 const epoch='qa-remove-epoch';
 if(!identity){const made=await createIdentity('qa-remove',0);identity=made.identity;await store.putIdentity('qa-remove',identity);await store.putEpoch('qa-remove',epoch,await newEpochKey());}
 const posted:any[]=[];let fail=true,events:string[]=[];
 const client=new ChatClient('qa-remove',async(e,p:any)=>{
  events.push(e);
  if(e==='keys:get')return {identity};
  if(e==='register')return {};
  if(e==='state')return {revision:1,epoch,status:'active',leaseUntil:0,owner:null,members:[{userId:'qa-remove',devices:[{...identity,fingerprint:'fixture'}]}],wraps:[]};
  if(e==='history')return {messages:posted,nextCursor:null};
  if(e==='send'){if(fail)throw Error('timeout');const message={...p,senderUserId:'qa-remove',senderSignPublic:identity!.signPublic,serverTs:Date.now(),cursor:posted.length+1};posted.push(message);return {message};}
  throw Error(e);
 },store);
 Object.assign(window,{client,store,events,posted,setFail:(v:boolean)=>{fail=v;}});
 function App(){const snap=useSyncExternalStore(client.subscribe,client.getSnapshot,client.getSnapshot);return <aside className="chat-dock"><Room snap={snap} client={client} names={{}}/></aside>;}
 await client.start();createRoot(document.getElementById('root')!).render(<App/>);
 (window as any).ready=true;
}
boot();
`);
  const result=await esbuild.build({entryPoints:[entry],bundle:true,write:false,nodePaths:[path.join(root,'node_modules')],jsx:'automatic',loader:{'.tsx':'tsx'}});
  const js=result.outputFiles[0].contents,css=fs.readFileSync('app/globals.css');
  server=http.createServer((req,res)=>{
   if(req.url==='/app.js'){res.setHeader('content-type','application/javascript');res.end(js);}
   else if(req.url==='/app.css'){res.setHeader('content-type','text/css');res.end(css);}
   else{res.setHeader('content-type','text/html');res.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  browser=await chromium.launch({headless:true,executablePath:process.env.CHAT_QA_CHROMIUM||chromium.executablePath(),args:['--no-sandbox']});
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.waitForFunction(()=>window.ready);
  await page.evaluate(async()=>{await client.send('remove target');await client.send('keep target');});
  await page.getByLabel('Message',{exact:true}).fill('unrelated draft');
  assert.equal(await page.getByText('Security keys',{exact:true}).count(),0);
  assert.equal(await page.locator('details.chat-safety').count(),0);
  const target=page.locator('.chat-msg').filter({hasText:'remove target'});
  await target.getByRole('button',{name:'Remove',exact:true}).waitFor();
  const before=await page.evaluate(()=>{window.old=client.getSnapshot().messages.find(m=>m.text==='remove target');return events.length;});
  await target.getByRole('button',{name:'Remove',exact:true}).click();
  await page.waitForFunction(()=>!client.getSnapshot().messages.some(m=>m.text==='remove target'));
  assert.equal(await page.evaluate(()=>events.length),before);
  assert.equal(await page.evaluate(()=>client.retry(window.old)),false);
  assert.equal(await page.evaluate(()=>events.length),before);
  assert.equal(await page.getByLabel('Message',{exact:true}).inputValue(),'unrelated draft');
  assert.equal(await page.evaluate(async()=>(await store.getPending('qa-remove')).length),1);
  report.checks.push('Actual Remove deletes only failed target after IDB commit, makes zero transport calls, blocks stale Retry, preserves draft and other queue entry');
  await page.reload();await page.waitForFunction(()=>window.ready);
  assert.equal(await page.getByText('remove target',{exact:true}).count(),0);
  const kept=page.locator('.chat-msg').filter({hasText:'keep target'});
  await kept.getByRole('button',{name:'Retry',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>events.filter(e=>e==='send').length),0);
  report.checks.push('Browser reload retains other failed entry and never restores or sends removed target');
  await page.evaluate(()=>setFail(false));
  await kept.getByRole('button',{name:'Retry',exact:true}).click();
  await page.waitForFunction(()=>client.getSnapshot().messages.some(m=>m.text==='keep target'&&m.status==='ok'));
  assert.equal(await page.evaluate(()=>posted.length),1);
  assert.equal(await page.evaluate(async()=>(await store.getPending('qa-remove')).length),0);
  assert.equal(await page.getByRole('button',{name:'Remove',exact:true}).count(),0);
  assert.deepEqual(errors,[]);
  report.checks.push('Actual Retry posts remaining exact envelope once, clears IDB, posted message has no Remove; no page errors');
  report.pass=true;
 }catch(e){report.error=e.stack;process.exitCode=1;}
 finally{
  if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));
  fs.rmSync(tmp,{recursive:true,force:true});
  console.log(JSON.stringify(report,null,2));
  if(process.env.CHAT_QA_REPORT)fs.writeFileSync(process.env.CHAT_QA_REPORT,JSON.stringify(report,null,2));
 }
})();
