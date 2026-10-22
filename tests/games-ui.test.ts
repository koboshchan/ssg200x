import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'/home/kit/out/cal-browser-evidence/node_modules/playwright'),{build}=require('esbuild');
const STUBS:Record<string,string>={
 clerk:'import {useSyncExternalStore} from "react";const subs=new Set();export function useUser(){const id=useSyncExternalStore(cb=>{subs.add(cb);return()=>subs.delete(cb)},()=>window.__uid);return {user:id?{id}:null}};window.__setUid=id=>{window.__uid=id;subs.forEach(f=>f())};',
 live:'export function useLive(){return {connection:"connected",emit(){}}}',
 tab:'export function getTabHeaders(){return {}}',
};
async function bundle(){
 const out=await build({stdin:{contents:'import React from "react";import {createRoot} from "react-dom/client";import GamesClient from "./app/games-client";createRoot(document.getElementById("root")).render(<GamesClient/>);',resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'empty'},plugins:[{name:'stubs',setup(b:any){
  const map:[RegExp,string][]=[[/^@clerk\/nextjs$/,'clerk'],[/live-provider$/,'live'],[/tab-identity$/,'tab']];
  for(const [f,n] of map){b.onResolve({filter:f},()=>({path:n,namespace:'stub'}));}
  b.onLoad({filter:/.*/,namespace:'stub'},(a:any)=>({contents:STUBS[a.path],resolveDir:process.cwd(),loader:'js'}));
  b.onLoad({filter:/\.module\.css$/},()=>({contents:'export default new Proxy({}, {get:(_,k)=>String(k)})',loader:'js'}));}}]});
 return out.outputFiles[0].text;
}
// Page-side fake network: GET answers instantly from window.__snap; POSTs are held until the test replies.
const INIT=`window.__uid='userA';window.__reqs=[];window.__snap={version:1,wallet:100000,maxBet:100000,serverNow:Date.now(),houseEdge:.02,games:[]};
const real=window.fetch;window.fetch=(url,init)=>{if(!init||!init.method||init.method==='GET')return Promise.resolve(new Response(JSON.stringify(window.__snap),{status:200,headers:{'content-type':'application/json'}}));
 return new Promise((resolve,reject)=>{window.__reqs.push({body:init.body,resolve:(status,json)=>resolve(new Response(JSON.stringify(json),{status,headers:{'content-type':'application/json'}})),reject:()=>reject(new TypeError('network'))});});};`;
const hilo=(id:string)=>({id,kind:'hilo',bet:500,status:'active',revision:0,steps:0,multiplier:.98,payout:490,createdAt:Date.now(),card:7,cards:[7]});
const plinko=(id:string,slot:number,mult:number)=>({id,kind:'plinko',bet:500,status:'won',revision:1,steps:0,multiplier:mult,payout:Math.floor(500*mult),createdAt:Date.now(),result:{path:Array.from({length:8},(_,i)=>i<slot?1:0),slot}});
const snap=(version:number,games:object[],extra:object={})=>({version,wallet:99500,maxBet:100000,serverNow:Date.now(),houseEdge:.02,games,...extra});
test('hydrated Games UI reconciles identical receipts, restoration, concurrent drops and stale accounts',async()=>{
 const js=await bundle(),browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
 try{
 for(const width of [1280,390]){
 async function mount(restored?:{key:string,value:object}){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
  await page.addInitScript(INIT);
  if(restored)await page.addInitScript(({key,value}:any)=>sessionStorage.setItem(key,JSON.stringify(value)),restored);
  await page.route('https://games.test/**',(r:any)=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><div id="root"></div>'}));
  await page.goto('https://games.test');await page.addScriptTag({content:js});return page;
 }
 const count=(p:any,n:number)=>p.waitForFunction((n:number)=>(window as any).__reqs.length===n,n);
 const reply=(p:any,i:number,status:number,json:object)=>p.evaluate(([i,status,json]:any)=>(window as any).__reqs[i].resolve(status,json),[i,status,json]);
 const reject=(p:any,i:number)=>p.evaluate((i:number)=>(window as any).__reqs[i].reject(),i);
 const body=(p:any,i:number)=>p.evaluate((i:number)=>(window as any).__reqs[i].body,i);
 const storage=(p:any,k='ssg-games-v1:userA')=>p.evaluate((k:string)=>sessionStorage.getItem(k),k);
 const quiet=async(p:any)=>{assert.equal(await p.locator('[role=alert]').count(),0);assert.equal(await p.getByText(/unconfirmed/i).count(),0);};
 const ready=async(p:any)=>{await p.getByRole('tab',{name:/Hi-Lo/}).click();await p.waitForFunction(()=>!(document.querySelector('button.primary') as HTMLButtonElement)?.disabled);};
 // Delayed success has only neutral progress; transport loss automatically replays once.
 const p=await mount();await ready(p);await p.getByRole('button',{name:'Start',exact:true}).click();await count(p,1);
 await p.getByText('Working…').waitFor();await quiet(p);
 const first=await body(p,0),id=JSON.parse(first).requestId;
 await reply(p,0,200,snap(2,[hilo(id)],{actionGameId:id}));await p.getByRole('button',{name:/Higher/}).waitFor();
 assert.equal(await storage(p),null);await quiet(p);
 await p.getByRole('button',{name:/Higher/}).click();await count(p,2);const step=await body(p,1);
 await reject(p,1);await count(p,3);assert.equal(await body(p,2),step);await quiet(p);
 await reply(p,2,200,snap(3,[{...hilo(id),revision:1,steps:1,card:9,cards:[7,9]}]));
 await p.waitForFunction(()=>sessionStorage.getItem('ssg-games-v1:userA')===null);await quiet(p);
 // Both automatic attempts fail; manual retry must still use the original body.
 await p.getByRole('button',{name:/Higher/}).click();await count(p,4);const lost=await body(p,3);
 await reject(p,3);await count(p,5);await reject(p,4);await p.getByRole('alert').waitFor();
 assert.ok(await storage(p));await p.getByRole('button',{name:'Retry',exact:true}).click();await count(p,6);
 assert.equal(await body(p,5),lost);await reply(p,5,400,{error:'Round finished'});
 await p.getByText('Round finished').waitFor();assert.equal(await storage(p),null);assert.equal(await p.getByText(/unconfirmed/i).count(),0);
 await p.close();
 // Restored singular envelope reconciles automatically before any warning.
 const envelope={label:'Start hilo',body:JSON.stringify({type:'start',game:'hilo',amount:500,requestId:'restored',requestAt:123})};
 const r=await mount({key:'ssg-games-v1:userA',value:envelope});await count(r,1);await quiet(r);
 assert.equal(await body(r,0),envelope.body);await reply(r,0,200,snap(2,[hilo('restored')]));
 await r.waitForFunction(()=>sessionStorage.getItem('ssg-games-v1:userA')===null);await quiet(r);await r.close();
 // Out-of-order Plinko results retain both identities despite snapshot version ordering.
 const d=await mount();const drop=d.getByRole('button',{name:'Drop',exact:true});await drop.click();await drop.click();await count(d,2);
 assert.equal(await d.getByRole('status',{name:'Plinko in progress'}).count(),1);
 assert.equal(await d.getByText(/Dropping/i).count(),0);
 const ids=[JSON.parse(await body(d,0)).requestId,JSON.parse(await body(d,1)).requestId];assert.notEqual(ids[0],ids[1]);
 await reply(d,1,200,snap(5,[plinko(ids[1],0,11.31)],{actionGameId:ids[1]}));
 await reply(d,0,200,snap(4,[plinko(ids[0],4,.35)],{actionGameId:ids[0]}));
 await d.waitForFunction(()=>document.querySelectorAll('[aria-label="Recent drops"] li').length===2);
 await d.waitForFunction(()=>!document.querySelector('[aria-label="Plinko in progress"]'));
 const trail=await d.locator('[aria-label="Recent drops"]').innerText();assert.match(trail,/11\.31×/);assert.match(trail,/0\.35×/);
 assert.equal(await storage(d,'ssg-games-plinko-v1:userA'),null);await quiet(d);
 // Plinko retries exactly once and leaves an identical manual receipt after repeated loss.
 await drop.click();await count(d,3);const db=await body(d,2);await reject(d,2);await count(d,4);assert.equal(await body(d,3),db);await quiet(d);
 await reject(d,3);await d.getByText('Unconfirmed',{exact:true}).waitFor();await d.getByRole('button',{name:'Retry',exact:true}).click();await count(d,5);
 assert.equal(await body(d,4),db);await reply(d,4,200,snap(6,[plinko(JSON.parse(db).requestId,2,2)],{actionGameId:JSON.parse(db).requestId}));
 await d.waitForFunction(()=>sessionStorage.getItem('ssg-games-plinko-v1:userA')===null);
 // A stale success and a stale failure cannot overwrite B's wallet or warnings.
 await drop.click();await drop.click();await count(d,7);
 await d.evaluate(()=>{(window as any).__snap={...(window as any).__snap,wallet:777700,games:[]};(window as any).__setUid('userB')});
 await d.getByText('$7,777',{exact:true}).waitFor();
 await reply(d,5,200,snap(99,[plinko('stale',0,10)]));await reject(d,6);
 await d.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await d.getByText('$7,777',{exact:true}).waitFor();await quiet(d);assert.equal(await storage(d,'ssg-games-plinko-v1:userB'),null);
 await d.close();
 // Server failure and malformed successful JSON are ambiguous, 429 is never tight-retried.
 for(const status of [503,200,408,429]){
  const q=await mount();await ready(q);await q.getByRole('button',{name:'Start',exact:true}).click();await count(q,1);
  const qb=await body(q,0);await reply(q,0,status,{error:'temporary'});
  if(status===429){
   await q.getByRole('alert').waitFor();
   assert.equal(await q.evaluate(()=>(window as any).__reqs.length),1);
  }else{
   await count(q,2);assert.equal(await body(q,1),qb);await quiet(q);
   await reply(q,1,200,snap(2,[hilo(JSON.parse(qb).requestId)]));
   await q.waitForFunction(()=>sessionStorage.getItem('ssg-games-v1:userA')===null);await quiet(q);
  }
  await q.close();
 }
 // Singular stale catch/finally must not clear the new account's working state.
 const a=await mount();await ready(a);await a.getByRole('button',{name:'Start',exact:true}).click();await count(a,1);
 await a.evaluate(()=>(window as any).__setUid('userB'));
 await a.waitForFunction(()=>!(document.querySelector('button.primary') as HTMLButtonElement)?.disabled);
 await a.getByRole('button',{name:'Start',exact:true}).click();await count(a,2);
 await reject(a,0);await a.getByText('Working…').waitFor();await quiet(a);
 assert.ok(await storage(a,'ssg-games-v1:userB'));
 const ab=JSON.parse(await body(a,1));await reply(a,1,200,snap(2,[hilo(ab.requestId)]));
 await a.waitForFunction(()=>sessionStorage.getItem('ssg-games-v1:userB')===null);await quiet(a);await a.close();
 // Restored per-drop envelope automatically acknowledges too.
 const rd=await mount({key:'ssg-games-plinko-v1:userA',value:[{rid:'restore-drop',body:JSON.stringify({type:'start',game:'plinko',amount:500,requestId:'restore-drop',requestAt:123}),label:'Drop'}]});
 await count(rd,1);await quiet(rd);await reply(rd,0,200,snap(2,[plinko('restore-drop',0,2)],{actionGameId:'restore-drop'}));
 await rd.waitForFunction(()=>sessionStorage.getItem('ssg-games-plinko-v1:userA')===null);await quiet(rd);await rd.close();
 }
 }finally{await browser.close();}
});
