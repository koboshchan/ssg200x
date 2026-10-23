import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'/home/kit/out/cal-browser-evidence/node_modules/playwright'),{build}=require('esbuild');
const STUBS:Record<string,string>={
 link:'import React from "react";export default function Link(props){return React.createElement("a",props)}',
 clerk:'import {useSyncExternalStore} from "react";const subs=new Set();export function useUser(){const id=useSyncExternalStore(cb=>{subs.add(cb);return()=>subs.delete(cb)},()=>window.__uid);return {user:id?{id}:null}};window.__setUid=id=>{window.__uid=id;subs.forEach(f=>f())};',
 live:'export function useLive(){return {connection:"connected",emit(){}}}',
 tab:'export function getTabHeaders(){return {}}',
};
async function bundle(){
 const out=await build({stdin:{contents:'import React from "react";import {createRoot} from "react-dom/client";import GamesClient from "./app/games-client";createRoot(document.getElementById("root")).render(<GamesClient/>);',resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'empty'},plugins:[{name:'stubs',setup(b:any){
  const map:[RegExp,string][]=[[/^next\/link$/,'link'],[/^@clerk\/nextjs$/,'clerk'],[/live-provider$/,'live'],[/tab-identity$/,'tab']];
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

test('delayed Plinko reserves only unacknowledged debits, ignores stale replies and waits for terminal settlement',async()=>{
 const js=await bundle(),browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
 try{for(const reducedMotion of ['reduce','no-preference'] as const){
 const page=await browser.newPage({viewport:{width:390,height:900},reducedMotion});
 await page.addInitScript(INIT);
 await page.route('https://games.test/**',(r:any)=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><div id="root"></div>'}));
 await page.goto('https://games.test');await page.addScriptTag({content:js});
 const wallet=()=>page.locator('.wallet strong');
 await page.getByRole('button',{name:'Drop',exact:true}).click();
 await page.waitForFunction(()=>(window as any).__reqs.length===1);
 assert.equal(await wallet().textContent(),'$995');
 await page.getByRole('button',{name:'Drop',exact:true}).click();
 await page.waitForFunction(()=>(window as any).__reqs.length===2);
 assert.equal(await wallet().textContent(),'$990');
 const ids=await page.evaluate(()=>(window as any).__reqs.map((r:any)=>JSON.parse(r.body).requestId));
 const now=Date.now(),games=ids.map((requestId:string,i:number)=>({...plinko('server-'+i,4,.5),requestId,status:'active',payout:0,createdAt:now,durationMs:1500,landAt:now+1500}));
 const active=snap(3,games,{wallet:99000});
 // Reply 2 includes both committed debits while reply 1 is still held.
 await page.evaluate((s:any)=>{(window as any).__snap=s;(window as any).__reqs[1].resolve(200,{...s,actionGameId:'server-1'});},active);
 await page.waitForFunction(()=>sessionStorage.getItem('ssg-games-plinko-v1:userA')?.includes('server-impossible')===false);
 await page.waitForTimeout(80);
 assert.equal(await wallet().textContent(),'$990');
 assert.equal(await page.locator('.trail li').count(),0);
 // First reply is older and must not regress wallet, timing or reintroduce terminal results.
 await page.evaluate((s:any)=>(window as any).__reqs[0].resolve(200,{...s,actionGameId:'server-0'}),snap(2,[games[0]],{wallet:99500,serverNow:now-60000}));
 await page.waitForFunction(()=>sessionStorage.getItem('ssg-games-plinko-v1:userA')===null);
 assert.equal(await wallet().textContent(),'$990');
 await page.waitForTimeout(1800);
 assert.equal(await wallet().textContent(),'$990');
 assert.equal(await page.locator('.trail li').count(),0);
 const terminal=snap(4,games.map((g:any)=>({...g,status:'won',revision:1,payout:250,settledAt:Date.now()})),{wallet:99500});
 await page.evaluate((s:any)=>(window as any).__snap=s,terminal);
 await page.waitForFunction(()=>document.querySelectorAll('.trail li').length===2);
 assert.equal(await wallet().textContent(),'$995');
 assert.equal(await page.locator('.ball').count(),0);
 await page.close();
 }}finally{await browser.close();}
});
