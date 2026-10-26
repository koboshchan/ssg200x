import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error runtime JS
import {createTabLeases,TAB_LEASE_MS} from '../runtime/tab-leases.mjs';
class Socket {connected=true; events:any[]=[];handlers=new Map<string,Function>();emit(e:string,p:any){this.events.push([e,p]);}on(e:string,f:Function){this.handlers.set(e,f);}disconnect(){this.connected=false;this.handlers.get('disconnect')?.();}report(route:string){this.handlers.get('tab:report')?.({route});}}
const id=(n:number)=>n.toString(16).padStart(48,'0');
const auth=(n:number,route='/roulette')=>({tabId:id(n),tabProof:id(n+100),route});
test('all tabs blocked, disconnect unblocks and users stay isolated',()=>{const l=createTabLeases(),a=new Socket(),b=new Socket(),c=new Socket();l.attach('u',a,auth(1));l.attach('u',b,auth(2));l.attach('v',c,auth(3));assert.match(l.check('u',id(1),id(101),'roulette'),/Only one/);assert.equal(a.events.at(-1)[1].blocked,true);assert.equal(b.events.at(-1)[1].blocked,true);assert.equal(l.check('v',id(3),id(103),'roulette'),null);b.disconnect();assert.equal(l.check('u',id(1),id(101),'roulette'),null);assert.equal(a.events.at(-1)[1].blocked,false);});
test('reconnect replacement never counts twice and old close cannot erase new lease',()=>{const l=createTabLeases(),a=new Socket(),b=new Socket();l.attach('u',a,auth(1));l.attach('u',b,auth(1));assert.equal(a.connected,false);assert.equal(l.check('u',id(1),id(101),'roulette'),null);assert.equal(b.events.at(-1)[1].tabs,1);});
test('route mismatch rejected, report updates route, expired and forged proofs fail',()=>{let now=0;const l=createTabLeases({now:()=>now}),a=new Socket();l.attach('u',a,auth(1));assert.equal(l.check('u',id(1),id(101),'blackjack'),'Switch to the blackjack tab to bet');a.report('/blackjack');assert.equal(l.check('u',id(1),id(101),'blackjack'),null);assert.match(l.check('u',id(1),id(999),'blackjack'),/Reconnect/);assert.throws(()=>l.attach('u',new Socket(),{...auth(1),tabProof:id(200)}));now+=TAB_LEASE_MS;l.sweepAll();a.report('/roulette');assert.match(l.check('u',id(1),id(101),'roulette'),/Reconnect/);});
test('UUIDv4 browser credentials are accepted and reconnect replacement is one document',()=>{const l=createTabLeases(),a=new Socket(),b=new Socket();const c={tabId:'12345678-1234-4567-8123-123456789abc',tabProof:'abcdef12-abcd-4abc-9abc-abcdefabcdef',route:'/poker'};l.attach('u',a,c);l.attach('u',b,c);assert.equal(l.check('u',c.tabId,c.tabProof,'poker'),null);assert.equal(b.events.at(-1)[1].tabs,1);});
test('expired socket is disconnected and cannot renew a removed lease',()=>{let time=0;const l=createTabLeases({now:()=>time}),a=new Socket(),b=new Socket();l.attach('u',a,auth(1));time=5000;l.attach('u',b,auth(2));time=16000;l.sweepAll();assert.equal(a.connected,false);assert.equal(b.connected,true);assert.equal(l.check('u',id(2),id(102),'roulette'),null);a.report('/roulette');assert.match(l.check('u',id(1),id(101),'roulette'),/Reconnect/);});
test('all shipped mini-game pages share the games lease without accepting arbitrary prefixes',()=>{
 const l=createTabLeases(),a=new Socket();l.attach('u',a,auth(1,'/games'));
 for(const route of ['/games','/games/plinko','/games/hilo','/games/mines','/games/dice','/games/chicken']){
  a.report(route);assert.equal(l.check('u',id(1),id(101),'games'),null,route);
  assert.match(l.check('u',id(1),id(101),'roulette'),/Switch/);
 }
 for(const route of ['/wallet','/markets','/games-other','/games/unknown','/games/plinko/admin','/games//plinko']){
  a.report(route);assert.match(l.check('u',id(1),id(101),'games'),/Switch/,route);
 }
 a.report('/games/plinko');for(const bad of ['/games/dice?tab=games','/games/dice#x','https://evil.test/games']){
  a.report(bad);assert.equal(l.check('u',id(1),id(101),'games'),null,'invalid report cannot replace valid lease');
 }
 assert.match(l.check('u',id(1),id(999),'games'),/Reconnect/);
 const b=new Socket();l.attach('u',b,auth(2,'/games/dice'));assert.match(l.check('u',id(1),id(101),'games'),/Only one/);
 b.disconnect();assert.equal(l.check('u',id(1),id(101),'games'),null);
 a.disconnect();assert.match(l.check('u',id(1),id(101),'games'),/Reconnect/);
});
test('single-tab flag toggles existing tabs without bypassing lease or route validation',()=>{
 let enabled=true,time=0;
 const l=createTabLeases({now:()=>time,singleTabEnabled:()=>enabled}),a=new Socket(),b=new Socket();
 l.attach('u',a,auth(1));l.attach('u',b,auth(2));
 assert.match(l.check('u',id(1),id(101),'roulette'),/Only one/);
 enabled=false;l.publishAll();
 for(const socket of [a,b])assert.equal(socket.events.at(-1)[1].blocked,false);
 assert.equal(l.check('u',id(1),id(101),'roulette'),null);
 assert.equal(l.check('u',id(2),id(102),'roulette'),null);
 assert.match(l.check('u',id(1),id(999),'roulette'),/Reconnect/);
 assert.match(l.check('u',id(9),id(109),'roulette'),/Reconnect/);
 assert.equal(l.check('u',id(1),id(101),'blackjack'),'Switch to the blackjack tab to bet');
 assert.throws(()=>l.attach('u',new Socket(),{...auth(1),tabProof:id(999)}),/ownership/);
 assert.throws(()=>l.attach('u',new Socket(),{...auth(3),route:'invalid'}),/Reload/);
 enabled=true;l.publishAll();
 for(const socket of [a,b])assert.equal(socket.events.at(-1)[1].blocked,true);
 assert.match(l.check('u',id(2),id(102),'roulette'),/Only one/);
 enabled=false;time=TAB_LEASE_MS;l.sweepAll();
 assert.match(l.check('u',id(1),id(101),'roulette'),/Reconnect/);
});
test('admin flag refresh broadcasts the current lock state to existing documents',async()=>{
 const {createFeatureSettings}=await import('../runtime/feature-settings.mjs');
 let document={features:{singleTab:true},revision:0};
 const settings=createFeatureSettings({findOne:async()=>document},{env:{},pollMs:60000});
 try{
  await settings.ready;
  const leases=createTabLeases({singleTabEnabled:()=>settings.enabled('singleTab')});
  settings.subscribe(()=>leases.publishAll());
  const a=new Socket(),b=new Socket();leases.attach('u',a,auth(1));leases.attach('u',b,auth(2));
  assert.equal(a.events.at(-1)[1].blocked,true);
  document={features:{singleTab:false},revision:1};await settings.refresh();
  assert.equal(a.events.at(-1)[1].blocked,false);assert.equal(b.events.at(-1)[1].blocked,false);
  assert.equal(leases.check('u',id(2),id(102),'roulette'),null);
  document={features:{singleTab:true},revision:2};await settings.refresh();
  assert.equal(a.events.at(-1)[1].blocked,true);assert.equal(b.events.at(-1)[1].blocked,true);
  assert.match(leases.check('u',id(2),id(102),'roulette'),/Only one/);
 }finally{settings.stop();}
});
