import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error runtime module
import {createTabLeases,TAB_LEASE_MS} from '../runtime/tab-leases.mjs';
class Socket {connected=true;handlers=new Map<string,Function>();events:any[]=[];emit(e:string,p:any){this.events.push([e,p]);}on(e:string,f:Function){this.handlers.set(e,f);}disconnect(){this.connected=false;this.handlers.get('disconnect')?.('server namespace disconnect');}report(route:any,ack?:any){this.handlers.get('tab:report')?.(route,ack);}}
const id=(n:number)=>n.toString(16).padStart(48,'0');
const auth=(n=1)=>({tabId:id(n),tabProof:id(n+100),route:'/roulette'});
test('success ACK strictly follows accepted update and publish, TTL uses actual lease constant',()=>{
 let time=0;const l=createTabLeases({now:()=>time}),s=new Socket(),a=auth();l.attach('u',s,a);time=5000;
 let replies=0;s.report({route:'/blackjack'},(value:any)=>{replies++;assert.deepEqual(value,{ok:true,leaseTtlMs:TAB_LEASE_MS});assert.equal(s.events.at(-1)[0],'tab:state');assert.equal(l.check('u',a.tabId,a.tabProof,'blackjack'),null);});
 assert.equal(replies,1);time=TAB_LEASE_MS+4999;assert.equal(l.check('u',a.tabId,a.tabProof,'blackjack'),null);
});
test('legacy no-ACK reports still accepted, malformed callbacks ignored',()=>{
 const l=createTabLeases(),s=new Socket(),a=auth();l.attach('u',s,a);s.report({route:'/blackjack'});assert.equal(l.check('u',a.tabId,a.tabProof,'blackjack'),null);s.report({route:'/roulette'},'not callback');assert.equal(l.check('u',a.tabId,a.tabProof,'roulette'),null);
});
test('invalid or missing reports get no success and cannot renew lease or update route',()=>{
 let time=0;const l=createTabLeases({now:()=>time}),s=new Socket(),a=auth();l.attach('u',s,a);time=15000;
 for(const report of [undefined,null,{}, {route:'bad'}, {route:'/roulette?x=1'}]){let reply; s.report(report,(x:any)=>reply=x);assert.deepEqual(reply,{ok:false,reason:'invalid_report'});}
 assert.equal(l.check('u',a.tabId,a.tabProof,'roulette'),null);time=16000;assert.match(l.check('u',a.tabId,a.tabProof,'roulette'),/Reconnect/);
});
test('expired before sweep, removed, disconnected and replaced reports never ACK success',()=>{
 for(const mode of ['expired','removed','disconnected','replaced']){
  let time=0;const l=createTabLeases({now:()=>time}),s=new Socket(),a=auth();l.attach('u',s,a);
  if(mode==='expired')time=TAB_LEASE_MS;
  if(mode==='removed'){time=TAB_LEASE_MS;l.sweepAll();}
  if(mode==='disconnected')s.disconnect();
  if(mode==='replaced')l.attach('u',new Socket(),a);
  let reply;s.report({route:'/blackjack'},(x:any)=>reply=x);assert.deepEqual(reply,{ok:false,reason:'stale'},mode);
  if(mode!=='replaced')assert.match(l.check('u',a.tabId,a.tabProof,'roulette'),/Reconnect/);
  else assert.equal(l.check('u',a.tabId,a.tabProof,'roulette'),null);
 }
});
test('successful report ACK never bypasses multi-tab guard or proof checks',()=>{
 const l=createTabLeases(),s=new Socket(),a=auth();l.attach('u',s,a);l.attach('u',new Socket(),auth(2));let reply;s.report({route:'/roulette'},(x:any)=>reply=x);assert.deepEqual(reply,{ok:true,leaseTtlMs:TAB_LEASE_MS});assert.match(l.check('u',a.tabId,a.tabProof,'roulette'),/Only one/);
});
test('single-tab flag off still ACKs only accepted reports, never revives stale leases or bypasses other checks',()=>{
 let time=0;const l=createTabLeases({now:()=>time,singleTabEnabled:()=>false}),s=new Socket(),o=new Socket(),a=auth();l.attach('u',s,a);l.attach('u',o,auth(2));
 let reply:any;s.report({route:'/blackjack'},(x:any)=>reply=x);assert.deepEqual(reply,{ok:true,leaseTtlMs:TAB_LEASE_MS});
 assert.equal(l.check('u',a.tabId,a.tabProof,'blackjack'),null);
 assert.match(l.check('u',a.tabId,a.tabProof,'roulette'),/Switch/);
 assert.match(l.check('u',a.tabId,id(999),'blackjack'),/Reconnect/);
 s.report({route:'bad'},(x:any)=>reply=x);assert.deepEqual(reply,{ok:false,reason:'invalid_report'});
 time=TAB_LEASE_MS;s.report({route:'/blackjack'},(x:any)=>reply=x);assert.deepEqual(reply,{ok:false,reason:'stale'});
 assert.match(l.check('u',a.tabId,a.tabProof,'blackjack'),/Reconnect/);
 const d=new Socket();s.connected=false;assert.match(l.check('u',a.tabId,a.tabProof,'blackjack'),/Reconnect/);void d;
});
