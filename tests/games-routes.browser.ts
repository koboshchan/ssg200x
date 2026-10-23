// Isolated browser + real Mongo wallets/receipts; real production tab lease and API tab guard.
// Clerk identity alone is stubbed. No production network or database is used.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {mkdirSync,writeFileSync} from 'node:fs';
import {build} from 'esbuild';
import {Server} from 'socket.io';
// @ts-expect-error runtime JS
import {createTabLeases} from '../runtime/tab-leases.mjs';
import {checkActionTab} from '../lib/tab-guard';
import {mutate} from '../lib/store';
import {db,readRoom,closeDatabase} from '../lib/db';
import {miniAction,miniSnapshot,type MiniInput} from '../lib/minigames';
import {register,assertRoom} from '../lib/poker';
if(!process.env.MONGODB_DB?.startsWith('fakebucks_test_')||!/^mongodb:\/\/(localhost|127\.0\.0\.1):\d+\//.test(process.env.MONGODB_URI??''))throw Error('Requires isolated localhost test database');
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'/opt/hako/lib/node_modules/playwright');
const who={id:'qa-games-route',name:'QA',email:'qa@example.invalid',admin:false};
async function main(){
 let js='';const leases=createTabLeases(),posts:any[]=[];
 const http=createServer(async(req,res)=>{
  const json=(code:number,data:unknown)=>{res.statusCode=code;res.setHeader('content-type','application/json');res.end(JSON.stringify(data));};
  try{
   if(req.url==='/bundle.js'){res.setHeader('content-type','application/javascript');res.end(js);return;}
   if(req.url==='/favicon.ico'){res.statusCode=204;res.end();return;}
   if(req.url==='/api/features'){json(200,{features:{games:true,plinko:true,hilo:true,mines:true,dice:true,chicken:true}});return;}
   if(req.url==='/internal-tab-check'||(req.url==='/api/games'&&req.method==='POST')){
    let raw='';for await(const c of req)raw+=c;
    const input=JSON.parse(raw);
    if(req.url==='/internal-tab-check'){
     if(req.headers['x-internal-live-secret']!==process.env.INTERNAL_LIVE_SECRET){json(403,{});return;}
     const error=leases.check(input.userId,input.tabId,input.tabProof,input.game);json(error?409:200,error?{error}:{ok:true});return;
    }
    const request=new Request('http://127.0.0.1:'+process.env.PORT+'/api/games',{method:'POST',headers:{"x-tab-id":String(req.headers['x-tab-id']||''),"x-tab-proof":String(req.headers['x-tab-proof']||'')}});
    await checkActionTab(request,who.id);
    const {room,result}=await mutate(r=>miniAction(r,who,input as MiniInput,()=>1));
    posts.push({requestId:input.requestId,game:input.game,type:input.type});
    json(200,{...miniSnapshot(room,who),actionGameId:result});return;
   }
   if(req.url==='/api/games'){json(200,miniSnapshot(await readRoom(),who));return;}
   res.setHeader('content-type','text/html');res.end('<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/bundle.js"><\/script>');
  }catch(e:any){json(e.status||503,{error:e.message});}
 });
 const io=new Server(http,{transports:['websocket']});
 io.on('connection',s=>leases.attach(who.id,s,s.handshake.auth));
 const mocks:Record<string,string>={
  '@clerk/nextjs':"export const useAuth=()=>({getToken:async()=> 'local-fixture'});export const useUser=()=>({user:{id:'qa-games-route'}});",
  'next/navigation':"import {useSyncExternalStore} from 'react';export const usePathname=()=>useSyncExternalStore(cb=>{window.addEventListener('popstate',cb);return()=>window.removeEventListener('popstate',cb)},()=>location.pathname);",
  'next/link':"import React from 'react';export default function Link(p){return React.createElement('a',p)}",
  './release-provider':"const api={observe(){},observeFeatures(){},async check(){}};export const useRelease=()=>api;",
 };
 const stubs=['./payment-announcement','./check-in-banner','./advancement-announcement','./airdrop-announcement'];
 const bundle=await build({stdin:{contents:"import React from 'react';import {createRoot} from 'react-dom/client';import {usePathname} from 'next/navigation';import LiveProvider,{useLive} from './app/live-provider';import GamesClient from './app/games-client';function App(){const p=usePathname(),live=useLive();return <><p id='connection'>{live.connection}</p><GamesClient key={p} initialKind={p.split('/')[2]||'plinko'} singleGame/></>}window.navigate=p=>{history.pushState({},'',p);dispatchEvent(new PopStateEvent('popstate'))};createRoot(document.getElementById('root')).render(<LiveProvider><App/></LiveProvider>);",resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',loader:{'.module.css':'empty'},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'local-identity-only',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]||stubs.includes(a.path)?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]||'export default function Stub(){return null}',loader:'js',resolveDir:process.cwd()}));}}]});
 js=bundle.outputFiles[0].text;
 await new Promise<void>(r=>http.listen(0,'127.0.0.1',r));const port=(http.address() as any).port,url='http://127.0.0.1:'+port;
 process.env.PORT=String(port);process.env.INTERNAL_LIVE_SECRET='isolated-qa-only';
 await mutate(r=>register(r,who));
 const browser=await chromium.launch({headless:true}),page=await browser.newPage(),errors:string[]=[],routes:any[]=[];
 page.on('pageerror',(e:Error)=>errors.push(e.message));
 try{
  await page.goto(url+'/games/plinko');await page.waitForFunction(()=>document.getElementById('connection')?.textContent==='connected');
  for(const kind of ['plinko','hilo','mines','dice','chicken']){
   await page.evaluate((p:string)=>(window as any).navigate(p),'/games/'+kind);
   const button=page.getByRole('button',{name:kind==='plinko'?'Drop':kind==='dice'?'Roll':'Start',exact:true});
   await button.waitFor();await page.getByRole('spinbutton',{name:'Bet in dollars'}).fill('1');
   const response=page.waitForResponse((r:any)=>r.url()===url+'/api/games'&&r.request().method()==='POST');
   await button.click();const result=await response;assert.equal(result.status(),200,await result.text());
   const data=await result.json();assert.ok(data.actionGameId);routes.push({kind,status:200,id:data.actionGameId});
  }
  await page.evaluate(()=>(window as any).navigate('/games/plinko'));
  const drop=page.getByRole('button',{name:'Drop',exact:true});await drop.waitFor();await page.getByRole('spinbutton',{name:'Bet in dollars'}).fill('1');
  await page.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
  await page.waitForFunction(()=>document.getElementById('connection')?.textContent==='connected');
  // Multiple real clicks in flight, each with its own receipt.
  let completed=0;const onResponse=(r:any)=>{if(r.url()===url+'/api/games'&&r.request().method()==='POST'&&r.status()===200)completed++};page.on('response',onResponse);
  for(let i=0;i<4;i++)await drop.click();
  await page.waitForFunction(()=>document.querySelectorAll('[role="alert"]').length===0);
  await new Promise<void>((resolve,reject)=>{const deadline=setTimeout(()=>reject(Error('Missing concurrent drops')),10000);const done=(r:any)=>{if(completed===4){clearTimeout(deadline);page.off('response',done);resolve();}};page.on('response',done);if(completed===4){clearTimeout(deadline);page.off('response',done);resolve();}});
  page.off('response',onResponse);
  const room=await readRoom();assertRoom(room);const games=room.miniGames!.filter(g=>g.owner===who.id);
  assert.equal(games.length,9);assert.equal(new Set(posts.map(p=>p.requestId)).size,9);
  assert.equal(room.members.find(m=>m.id===who.id)!.wallet,100000-games.reduce((n,g)=>n+g.bet,0)+games.filter(g=>g.status!=='active').reduce((n,g)=>n+g.payout,0));
  assert.equal(await(await db()).collection('audit').countDocuments({who:who.id,what:'minigame-start'}),9);
  assert.deepEqual(errors,[]);
  const dir=process.env.QA_EVIDENCE_DIR||'/tmp/ssg-games-routes';mkdirSync(dir,{recursive:true});writeFileSync(dir+'/evidence.json',JSON.stringify({routes,concurrentDrops:4,uniqueReceipts:9,walletVerified:true,realTabGuard:true,realMongo:true,errors},null,2));
  console.log('PASS actual GamesClient + production tab guard + isolated Mongo',routes,'four concurrent drops, nine unique wallet/audit receipts');
 }finally{await browser.close();await new Promise<void>(r=>io.close(()=>r()));await(await db()).dropDatabase();await closeDatabase();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
