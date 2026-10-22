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
 // Every game's held action shares one card-corner spinner, without loading labels.
 for(const [tab,button] of [['Plinko','Drop'],['Hi-Lo','Start'],['Mines','Start'],['Dice','Roll'],['Chicken Road','Start']]){
  const g=await mount();await g.getByRole('tab',{name:tab,exact:true}).click();
  await g.getByRole('button',{name:button,exact:true}).click();await count(g,1);
  assert.equal(await g.getByRole('status',{name:'Game in progress'}).count(),1);
  assert.equal(await g.getByText(/Working…|Retrying…|Dropping…|drops in flight/).count(),0);
  assert.equal(await g.getByRole('region',{name:tab,exact:true}).getAttribute('aria-busy'),'true');
  await reply(g,0,200,snap(2,[]));await g.waitForFunction(()=>!document.querySelector('[aria-label="Game in progress"]'));
  assert.equal(await g.getByRole('region',{name:tab,exact:true}).getAttribute('aria-busy'),'false');await g.close();
 }
 // Delayed success has only neutral progress; transport loss automatically replays once.
 const p=await mount();await ready(p);await p.getByRole('button',{name:'Start',exact:true}).click();await count(p,1);
 await p.getByRole('status',{name:'Game in progress'}).waitFor({state:'attached'});await quiet(p);
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
 assert.equal(await d.getByRole('status',{name:'Game in progress'}).count(),1);
 assert.equal(await d.getByText(/Dropping/i).count(),0);
 const ids=[JSON.parse(await body(d,0)).requestId,JSON.parse(await body(d,1)).requestId];assert.notEqual(ids[0],ids[1]);
 await reply(d,1,200,snap(5,[plinko(ids[1],0,11.31)],{actionGameId:ids[1]}));
 await reply(d,0,200,snap(4,[plinko(ids[0],4,.35)],{actionGameId:ids[0]}));
 await d.waitForFunction(()=>document.querySelectorAll('[aria-label="Recent drops"] li').length===2);
 await d.waitForFunction(()=>!document.querySelector('[aria-label="Game in progress"]'));
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
 await reject(a,0);await a.getByRole('status',{name:'Game in progress'}).waitFor({state:'attached'});await quiet(a);
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

test('Mines preferences are account scoped; lost boards reveal bombs and all result lines reserve space',async()=>{
 const {readFile}=await import('node:fs/promises');
 const css=(await readFile('app/globals.css','utf8'))+'\n'+await readFile('app/games.module.css','utf8');
 const js=await bundle(),browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
 try{for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});
  await page.addInitScript(INIT);
  await page.route('https://games.test/**',(r:any)=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><div id="root"></div>'}));
  const hydrate=async()=>{await page.addStyleTag({content:css});await page.addScriptTag({content:js});await page.getByRole('tab',{name:'Mines',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[aria-label="Game in progress"]'));};
  await page.goto('https://games.test');await hydrate();
  const slider=()=>page.getByRole('slider',{name:'Number of mines'});
  const change=async(n:number)=>{await slider().fill(String(n));};
  await change(8);
  assert.equal(await slider().inputValue(),'8');
  await page.getByText('Next bet · 8 mines · 5 × 5 grid',{exact:true}).waitFor();
  await page.getByRole('tab',{name:'Dice',exact:true}).click();await page.getByRole('tab',{name:'Mines',exact:true}).click();assert.equal(await slider().inputValue(),'8');
  await page.reload();await hydrate();assert.equal(await slider().inputValue(),'8');
  await page.evaluate(()=>(window as any).__setUid('userB'));await page.getByText('Next bet · 3 mines · 5 × 5 grid',{exact:true}).waitFor();assert.equal(await slider().inputValue(),'3');
  await change(5);await page.evaluate(()=>(window as any).__setUid('userA'));await page.getByText('Next bet · 8 mines · 5 × 5 grid',{exact:true}).waitFor();assert.equal(await slider().inputValue(),'8');
  const tabs=page.getByRole('tablist',{name:'Games'});assert.equal(await tabs.locator('[aria-selected=true]').count(),1);
  assert.equal(await tabs.locator('[aria-selected=true]').innerText(),'Mines');
  const colors=await page.evaluate(()=>['Plinko','Mines'].map(name=>getComputedStyle(Array.from(document.querySelectorAll('[role=tab]')).find(e=>e.textContent===name)!).backgroundColor));
  assert.notEqual(colors[0],colors[1]);
  // No round is needed to test empty vs very long result geometry for every game.
  for(const name of ['Plinko','Hi-Lo','Mines','Dice','Chicken Road']){
   await page.getByRole('tab',{name,exact:true}).click();
   const result=page.getByRole('status',{name:'Round result'}),before=await result.boundingBox();
   const panelBefore=await page.locator('.panel').boundingBox();
   await result.evaluate((el:any)=>{el.textContent='Won $999,999,999,999,999.99 at 999999999999.99×';});
   const after=await result.boundingBox(),panelAfter=await page.locator('.panel').boundingBox();
   assert.equal(before!.height,52);assert.equal(after!.height,before!.height);assert.equal(after!.y,before!.y);assert.equal(panelAfter!.y,panelBefore!.y);
  }
  await page.getByRole('tab',{name:'Dice',exact:true}).click();
  const direction=page.getByRole('group',{name:'Direction'}),target=page.getByRole('slider',{name:'Target number'});
  const directionBox=await direction.boundingBox(),targetBox=await target.boundingBox(),betBox=await page.getByLabel('Bet in dollars').boundingBox();
  const diceCard=await page.getByRole('region',{name:'Dice',exact:true}).boundingBox();
  assert.ok(directionBox!.y>=diceCard!.y+diceCard!.height);
  assert.ok(directionBox!.y+directionBox!.height<=targetBox!.y);
  assert.ok(targetBox!.y+targetBox!.height<betBox!.y);
  const expectedBarWidth=Math.min(420,diceCard!.width-(width<=560?26:38));
  assert.ok(Math.abs(targetBox!.width-expectedBarWidth)<1);
  assert.ok(Math.abs(targetBox!.x+targetBox!.width/2-(diceCard!.x+diceCard!.width/2))<1);
  const betY=betBox!.y;
  await page.getByRole('button',{name:'Roll under',exact:true}).click();await target.fill('69');
  await page.getByText('Target 69 · about 68% to win · ≈1.44×',{exact:true}).waitFor();
  assert.equal((await page.getByLabel('Bet in dollars').boundingBox())!.y,betY);
  await page.getByRole('button',{name:'Roll',exact:true}).click();
  await page.waitForFunction(()=>(window as any).__reqs.length===1);
  await page.evaluate(()=>(window as any).__reqs[0].resolve(200,{version:2,wallet:100000,maxBet:100000,serverNow:Date.now(),houseEdge:.02,games:[{id:'dice-result',kind:'dice',status:'won',bet:500,multiplier:1.44,payout:720,createdAt:Date.now(),revision:1,steps:0,target:69,direction:'under',result:{roll:20}}]}));
  await page.getByText('Roll under 69',{exact:true}).waitFor();
  const bar=await page.locator('.bar').boundingBox(),sliderAfter=await target.boundingBox();
  assert.ok(Math.abs(bar!.width-sliderAfter!.width)<1);assert.ok(Math.abs(bar!.x-sliderAfter!.x)<1);
  await page.evaluate(()=>(window as any).__reqs=[]);
  await page.getByRole('tab',{name:'Chicken Road',exact:true}).click();
  assert.equal(await page.locator('[data-lane]').count(),15);
  const startBox=await page.getByRole('button',{name:'Start',exact:true}).boundingBox();
  const cardBefore=await page.getByRole('region',{name:'Chicken Road',exact:true}).boundingBox();
  assert.equal(await page.getByRole('button',{name:'Cash out',exact:true}).count(),0);
  await page.getByRole('button',{name:'Start',exact:true}).click();
  await page.waitForFunction(()=>(window as any).__reqs.length===1);
  const chicken={id:'chicken-scroll',kind:'chicken',status:'active',bet:500,revision:0,steps:0,multiplier:.98,payout:490,createdAt:Date.now()};
  const chickenReply=async(i:number,steps:number)=>page.evaluate(([i,game,steps]:any)=>(window as any).__reqs[i].resolve(200,{version:10+steps,wallet:99500,maxBet:100000,serverNow:Date.now(),houseEdge:.02,games:[{...game,steps,revision:steps,multiplier:.98*Math.pow(1.25,steps),payout:Math.floor(490*Math.pow(1.25,steps))}]}),[i,chicken,steps]);
  await chickenReply(0,1);await page.getByRole('button',{name:'Go',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>(window as any).__reqs.length),1);
  const goBox=await page.getByRole('button',{name:'Go',exact:true}).boundingBox();
  assert.equal(goBox!.x,startBox!.x);assert.equal(goBox!.y,startBox!.y);
  const cashBox=await page.getByRole('button',{name:'Cash out',exact:true}).boundingBox();
  assert.ok(cashBox!.x+cashBox!.width<goBox!.x);
  const cardActive=await page.getByRole('region',{name:'Chicken Road',exact:true}).boundingBox();
  assert.deepEqual(cardActive,cardBefore);
  const cross=page.getByRole('button',{name:'Go',exact:true}),crossBefore=await cross.boundingBox();
  await cross.click();await page.waitForFunction(()=>(window as any).__reqs.length===2);await chickenReply(1,5);
  await page.getByText('5 / 15',{exact:true}).waitFor();
  const view=page.getByRole('region',{name:'Chicken road lanes'});
  await page.waitForFunction(()=>document.querySelector('[aria-label="Chicken road lanes"]')!.scrollLeft>0);
  assert.equal((await cross.boundingBox())!.y,crossBefore!.y);
  let bounds=await view.boundingBox(),upcoming=await page.locator('[data-lane="6"]').boundingBox();
  assert.ok(upcoming!.x>=bounds!.x&&upcoming!.x+upcoming!.width<=bounds!.x+bounds!.width);
  await cross.click();await page.waitForFunction(()=>(window as any).__reqs.length===3);await chickenReply(2,14);
  await page.getByText('14 / 15',{exact:true}).waitFor();
  bounds=await view.boundingBox();upcoming=await page.locator('[data-lane="15"]').boundingBox();
  assert.ok(upcoming!.x>=bounds!.x&&upcoming!.x+upcoming!.width<=bounds!.x+bounds!.width);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  assert.equal((await cross.boundingBox())!.y,crossBefore!.y);
  const finalLane=await page.locator('[data-lane="15"]').getAttribute('aria-label');
  assert.match(finalLane!,new RegExp((.98*Math.pow(1.25,15)).toFixed(2).replace('.','\.')));
  await cross.click();await page.waitForFunction(()=>(window as any).__reqs.length===4);
  await page.evaluate((game:any)=>(window as any).__reqs[3].resolve(200,{version:29,wallet:99500,maxBet:100000,serverNow:Date.now(),houseEdge:.02,games:[{...game,status:'lost',steps:15,revision:15,payout:0,result:{hit:15}}]}),chicken);
  await page.getByRole('button',{name:'Start',exact:true}).waitFor();
  assert.deepEqual(await page.getByRole('region',{name:'Chicken Road',exact:true}).boundingBox(),cardBefore);
  const restartBox=await page.getByRole('button',{name:'Start',exact:true}).boundingBox();
  assert.equal(restartBox!.y,startBox!.y);assert.equal(restartBox!.x,startBox!.x);
  assert.equal(await page.getByRole('button',{name:'Cash out',exact:true}).count(),0);
  await page.evaluate(()=>(window as any).__reqs=[]);
  await page.getByRole('tab',{name:'Mines',exact:true}).click();
  await page.getByRole('button',{name:'Start',exact:true}).click();
  await page.waitForFunction(()=>(window as any).__reqs.length===1);
  const request=await page.evaluate(()=>JSON.parse((window as any).__reqs[0].body));assert.equal(request.mines,8);
  const active={id:request.requestId,kind:'mines',status:'active',bet:500,mines:8,revision:0,steps:0,multiplier:.98,payout:490,createdAt:Date.now(),revealed:[],bombs:[0,2,4,6,8,10,12,14],result:{hit:0}};
  await page.evaluate((game:any)=>(window as any).__reqs[0].resolve(200,{version:30,wallet:99500,maxBet:100000,serverNow:Date.now(),games:[game],houseEdge:.02}),active);
  await page.getByText('Current round · 8 mines · 0 safe',{exact:true}).waitFor();
  assert.equal(await slider().count(),0);assert.equal(await page.getByRole('button',{name:/mine/}).count(),0);
  await page.getByRole('button',{name:'Cell 1',exact:true}).click();
  await page.waitForFunction(()=>(window as any).__reqs.length===2);
  await page.evaluate((game:any)=>(window as any).__reqs[1].resolve(200,{version:31,wallet:99500,maxBet:100000,serverNow:Date.now(),games:[{...game,status:'lost',revision:1,payout:0}],houseEdge:.02}),active);
  await page.getByText('Finished round · 8 mines · 0 safe',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:/, mine/}).count(),8);
  assert.equal(await page.getByRole('button',{name:/, mine, hit/}).count(),1);
  await change(4);
  await page.getByText('Finished round · 8 mines · 0 safe',{exact:true}).waitFor();assert.equal(await slider().inputValue(),'4');
  await page.getByText('Next bet · 4 mines',{exact:true}).waitFor();
  await page.close();
 }}finally{await browser.close();}
});

test('Plinko risk persists per account and each receipt/history retains its original risk',async()=>{
 const {PLINKO_RISK_TABLES,LEGACY_PLINKO_TABLE}=await import('../lib/plinko-risk');
 const js=await bundle(),browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
 try{for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});
  await page.addInitScript(INIT);await page.route('https://games.test/**',(r:any)=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><div id="root"></div>'}));
  const hydrate=async()=>{await page.addScriptTag({content:js});await page.getByRole('button',{name:'Drop',exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('[aria-label="Game in progress"]'));};
  await page.goto('https://games.test');await hydrate();
  const check=async(risk:'low'|'medium'|'high')=>{
   assert.equal(await page.getByRole('group',{name:'Plinko risk'}).locator('[aria-pressed=true]').innerText(),risk[0].toUpperCase()+risk.slice(1));
   const labels=await page.locator('.slots b').allTextContents();
   assert.deepEqual(labels,PLINKO_RISK_TABLES[risk].map(b=>b.multiplier.toFixed(2)+'×'));
  };
  await check('medium');await page.getByRole('button',{name:'Low',exact:true}).click();await check('low');
  await page.getByRole('tab',{name:'Mines',exact:true}).click();await page.getByRole('tab',{name:'Plinko',exact:true}).click();await check('low');
  await page.reload();await hydrate();await check('low');
  await page.evaluate(()=>(window as any).__setUid('userB'));
  await page.waitForFunction(()=>document.querySelector('[aria-pressed=true]')?.textContent==='Medium');await check('medium');
  await page.getByRole('button',{name:'High',exact:true}).click();
  await page.evaluate(()=>(window as any).__setUid('userA'));
  await page.waitForFunction(()=>document.querySelector('[aria-pressed=true]')?.textContent==='Low');await check('low');
  await page.getByRole('button',{name:'Drop',exact:true}).click();
  await page.waitForFunction(()=>(window as any).__reqs.length===1);
  const first=await page.evaluate(()=>JSON.parse((window as any).__reqs[0].body));assert.equal(first.risk,'low');
  await page.getByRole('button',{name:'High',exact:true}).click();await check('high');
  await page.getByRole('button',{name:'Drop',exact:true}).click();
  await page.waitForFunction(()=>(window as any).__reqs.length===2);
  const second=await page.evaluate(()=>JSON.parse((window as any).__reqs[1].body));assert.equal(second.risk,'high');
  // Settle high then the older low snapshot. Both exact per-round payouts survive.
  const high={...plinko(second.requestId,0,PLINKO_RISK_TABLES.high[0].multiplier),risk:'high',plinkoTable:PLINKO_RISK_TABLES.high};
  const low={...plinko(first.requestId,4,PLINKO_RISK_TABLES.low[4].multiplier),risk:'low',plinkoTable:PLINKO_RISK_TABLES.low};
  await page.evaluate(([high,low]:any)=>{(window as any).__reqs[1].resolve(200,{version:3,wallet:99000,maxBet:100000,serverNow:Date.now(),houseEdge:.02,games:[high],actionGameId:high.id});(window as any).__reqs[0].resolve(200,{version:2,wallet:99500,maxBet:100000,serverNow:Date.now(),houseEdge:.02,games:[low],actionGameId:low.id});},[high,low]);
  await page.waitForFunction(()=>document.querySelectorAll('[aria-label="Recent drops"] li').length===2);
  await check('high');
  const history=await page.getByRole('list',{name:'Recent drops'}).innerText();
  for(const g of [high,low])assert.ok(history.includes(g.multiplier.toFixed(2)+'×'));
  // Legacy response remains its own stored multiplier even when current risk changes.
  await page.getByRole('button',{name:'Drop',exact:true}).click();await page.waitForFunction(()=>(window as any).__reqs.length===3);
  const legacy=plinko('legacy',0,LEGACY_PLINKO_TABLE[0].multiplier);
  await page.evaluate((game:any)=>(window as any).__reqs[2].resolve(200,{version:4,wallet:98500,maxBet:100000,serverNow:Date.now(),houseEdge:.02,games:[game],actionGameId:game.id}),legacy);
  await page.waitForFunction(()=>document.querySelectorAll('[aria-label="Recent drops"] li').length===3);
  await page.getByRole('button',{name:'Medium',exact:true}).click();await check('medium');
  assert.ok((await page.getByRole('list',{name:'Recent drops'}).innerText()).includes(legacy.multiplier.toFixed(2)+'×'));
  await page.close();
 }}finally{await browser.close();}
});
