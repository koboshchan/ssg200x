import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {MongoClient} from 'mongodb';
import {build} from 'esbuild';
// @ts-expect-error runtime module
import {createChatService} from '../../runtime/chat-service.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/opt/hako/lib/node_modules/playwright');
if(!process.env.MONGODB_DB?.startsWith('fakebucks_test_'))throw Error('Isolated database required');
const client=new MongoClient(process.env.MONGODB_URI!),db=client.db(process.env.MONGODB_DB+'_resetbrowser');
after(async()=>{await db.dropDatabase();await client.close();});
function merge(a:any,p:any){for(const [k,v]of Object.entries(p)){if(v===null)delete a[k];else if(v&&typeof v==='object'&&!Array.isArray(v)){a[k]??={};merge(a[k],v);}else a[k]=v;}return a;}
test('two isolated browser accounts reset real chat state, purge IndexedDB keys, and create fresh recovery words',async()=>{
 const profiles:any={admin:{privateMetadata:{admin:true},publicMetadata:{}},user:{privateMetadata:{},publicMetadata:{}}};
 const clerk={users:{getUser:async(u:string)=>structuredClone(profiles[u]),updateUserMetadata:async(u:string,p:any)=>merge(profiles[u],structuredClone(p))}};
 await db.collection('rooms').insertOne({_id:'main' as never,version:1,members:[{id:'admin',publicId:'b'.repeat(16),approved:true},{id:'user',publicId:'a'.repeat(16),approved:true}]});
 const chat=createChatService(db,{clerk});await chat.ready;
 const bundle=await build({entryPoints:['tests/fixtures/chat-admin-reset-live.tsx'],bundle:true,write:false,outfile:'fixture.js',platform:'browser',format:'iife',jsx:'automatic',loader:{'.module.css':'empty'},plugins:[{name:'isolated-chat-accounts',setup(b){
  b.onResolve({filter:/^@clerk\/nextjs$/},()=>({path:'auth',namespace:'qa'}));
  b.onLoad({filter:/auth/,namespace:'qa'},()=>({contents:'export function useUser(){return {user:{id:window.qaRole},isLoaded:true}}'}));
  b.onResolve({filter:/^\.\/live-provider$/},()=>({path:'live',namespace:'qa'}));
  b.onLoad({filter:/live/,namespace:'qa'},()=>({contents:'const request=(e,p)=>window.qaRequest(e,p);export function useLive(){return {connection:"connected",request}};export function useLiveEvent(e,fn){window.qaHints??={};window.qaHints[e]=fn;}'}));
 }}]});
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/opt/hako/bin/google-chrome',args:['--no-sandbox']});
 try{
  const adminContext=await browser.newContext(),userContext=await browser.newContext({viewport:{width:1360,height:900}});
  const admin=await adminContext.newPage(),user=await userContext.newPage(),errors:string[]=[],resets:any[]=[];let ambiguous=true;
  for(const [page,role]of [[admin,'admin'],[user,'user']] as const){
   page.on('pageerror',(e:Error)=>errors.push(e.message));
   await page.exposeFunction('qaRequest',async(event:string,p:any)=>{try{return await chat.handle(role,event.replace(/^chat:/,''),p);}catch(e:any){throw Error(e.chatCode||e.message);}});
   await page.route('https://chat-reset.test/**',async(route:any)=>{
    if(new URL(route.request().url()).pathname==='/api/admin/chat-reset'){
     const payload=route.request().postDataJSON();resets.push(payload);
     try{const result=await chat.adminReset(role,payload);await user.evaluate(()=>{(window as any).qaHints?.['chat:changed']?.();});
      if(ambiguous){ambiguous=false;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Lost response. Retry.'})});}
      return route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
     }catch(e:any){return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:e.chatCode})});}
    }
    return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><div id="root"></div>'});
   });
   await page.goto('https://chat-reset.test');await page.evaluate((r:string)=>{(window as any).qaRole=r;},role);
   await page.addScriptTag({content:bundle.outputFiles.find(f=>f.path.endsWith('.js'))!.text});
  }
  await user.getByRole('button',{name:'Create my keys'}).click();
  await user.locator('.chat-words li').first().waitFor();const oldWords=await user.locator('.chat-words li').allTextContents();assert.equal(oldWords.length,6);
  await user.getByRole('checkbox').check();await user.getByRole('button',{name:'Continue',exact:true}).click();
  await user.getByRole('button',{name:'Send',exact:true}).waitFor();
  const first=(await chat.handle('user','keys:get',{v:1})).identity;
  await user.evaluate(async()=>{
   const db=await new Promise<IDBDatabase>((r,j)=>{const q=indexedDB.open('ssg200x-tabletalk');q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error);});
   await new Promise<void>((r,j)=>{const t=db.transaction('kv','readwrite');t.objectStore('kv').put({id:'old-outbox'},'pending:user:old-outbox');t.oncomplete=()=>r();t.onerror=()=>j(t.error);});db.close();
  });
  await admin.getByRole('button',{name:'Reset chat words for QA member'}).click();
  await admin.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(resets.length,0);
  await admin.getByRole('button',{name:'Reset chat words for QA member'}).click();
  assert.match(await admin.getByRole('dialog').innerText(),/cannot see their words or private keys/);
  await admin.getByRole('dialog').getByRole('button',{name:'Reset chat words',exact:true}).click();
  await admin.getByRole('alert').waitFor();
  await user.getByText(/An admin reset your chat words/).waitFor();
  await admin.getByRole('dialog').getByRole('button',{name:'Reset chat words',exact:true}).click();
  await admin.getByRole('status').waitFor();assert.equal(resets.length,2);assert.equal(resets[0].requestId,resets[1].requestId);
  assert.equal((await chat.handle('user','keys:get',{v:1})).identity,null);
  const rows=await user.evaluate(async()=>{
   const db=await new Promise<IDBDatabase>(r=>{const q=indexedDB.open('ssg200x-tabletalk');q.onsuccess=()=>r(q.result);});
   return new Promise<string[]>(r=>{const q=db.transaction('kv').objectStore('kv').getAllKeys();q.onsuccess=()=>{db.close();r(q.result.map(String));};});
  });
  for(const prefix of ['identity:user','epoch:user:','pending:user:','setup:user','kek:user'])assert.ok(!rows.some((k:string)=>k.startsWith(prefix)),prefix);
  assert.ok(!JSON.stringify(resets).includes(first.backup.ciphertext));
  for(const word of oldWords)assert.ok(!(await admin.locator('body').innerText()).includes(word),'admin must not display user recovery words');
  await user.getByRole('button',{name:'Create my keys'}).click();await user.locator('.chat-words li').first().waitFor();const newWords=await user.locator('.chat-words li').allTextContents();assert.equal(newWords.length,6);assert.notDeepEqual(newWords,oldWords);
  await user.getByRole('checkbox').check();await user.getByRole('button',{name:'Continue',exact:true}).click();
  await user.getByText(/Waiting for a member to share the key/).waitFor();
  const fresh=(await chat.handle('user','keys:get',{v:1})).identity;assert.notEqual(fresh.deviceId,first.deviceId);assert.equal(fresh.keyVersion,3);
  await admin.setViewportSize({width:390,height:844});await admin.getByRole('button',{name:'Reset chat words for QA member'}).click();
  const bounds=await admin.getByRole('dialog').boundingBox();assert.ok(bounds&&bounds.x>=0&&bounds.x+bounds.width<=391);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
