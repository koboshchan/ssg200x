import http from 'node:http';
import {readFileSync} from 'node:fs';
import {randomInt,randomUUID} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {PHYS_VERSION,idleRate} from '../runtime/roulette-physics.mjs';
import {choosePreviewTarget} from './roulette-preview-policy.mjs';
import {sourceHash} from './roulette-demo-build.mjs';
const dir='out/roulette-demo',manifest=JSON.parse(readFileSync(dir+'/manifest.json'));
if(manifest.sourceHash!==sourceHash())throw Error('Build source mismatch');
let anchor={atMs:Date.now(),phase:.6,vel:idleRate(),slot:0,rel:0,r:.6},spin=null,pending=null,round=0;
const state=()=>({serverNow:Date.now(),idleAnchor:spin?spin.physics.idleAnchor:anchor,spin,busy:!!pending});
const solve=input=>new Promise((resolve,reject)=>{const w=new Worker(new URL('../runtime/roulette-solver.mjs',import.meta.url),{workerData:input}),timer=setTimeout(()=>{void w.terminate();reject(Error('Solver deadline'));},3000);w.once('message',m=>{clearTimeout(timer);m.ok?resolve(m.value):reject(Error(m.error));});w.once('error',e=>{clearTimeout(timer);reject(e);});});
const send=(r,status,v)=>{r.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});r.end(JSON.stringify(v));};
http.createServer(async(q,r)=>{
 const url=new URL(q.url,'http://local'),path=url.pathname;
 if(path==='/api/state')return send(r,200,state());
 if(path==='/manifest.json')return send(r,200,manifest);
 if(path==='/api/round'&&q.method==='POST'){
  const requested=url.searchParams.get('target');
  let choose;
  try{choose=choosePreviewTarget(requested,{nodeEnv:process.env.NODE_ENV,enabled:process.env.ROULETTE_PREVIEW_TARGET,previewBuild:manifest.previewTarget},()=>randomInt(37));}
  catch(e){return send(r,e.status||400,{error:e.message});}
  if(pending||spin&&Date.now()<spin.nextAt)return send(r,409,{error:'Round in progress'});
  // Single event-loop atomic lock. This isolated demo has no bets/database;
  // production retains its two durable CAS transitions in roulette-store.ts.
  pending={id:randomUUID(),lockedAt:Date.now()};
  const locked=pending;
  try{
   const target=choose(),resultGeneratedAt=Date.now(),spinStartAt=Date.now()+2000;
   const solved=await solve({target,anchor,spinStartAt,seed:randomInt(2**31)});
   if(Date.now()>spinStartAt-100)throw Error('Missed publish window');
   const now=Date.now(),physics={roundId:locked.id,target,physicsVersion:PHYS_VERSION,lockDeadline:locked.lockedAt,resultGeneratedAt,broadcastAt:now,spinStartAt,serverNow:now,idleAnchor:anchor,launchParams:solved.launchParams};
   const resultAt=spinStartAt+solved.durationMs;
   spin={round:++round,number:target,startedAt:spinStartAt,resultAt,nextAt:resultAt+5000,physics};
   anchor=solved.endAnchor;pending=null;return send(r,200,{...state(),solveStats:{tries:solved.tries,ms:solved.solveMs}});
  }catch(e){pending=null;return send(r,503,{error:e.message});}
 }
 const files={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript'],'/app.css':['app.css','text/css']};
 if(!files[path]){r.writeHead(404);return r.end();}
 r.writeHead(200,{'content-type':files[path][1],'cache-control':'no-store','x-build-commit':manifest.commit,'x-source-hash':manifest.sourceHash});
 r.end(readFileSync(dir+'/'+files[path][0]));
}).listen(Number(process.env.PORT||41873),'0.0.0.0');
