import test from 'node:test';
import assert from 'node:assert/strict';
import {createFeatureSettings} from '../runtime/feature-settings.mjs';
// @ts-expect-error runtime module
import {attachMarketFeatureSubscriptions} from '../runtime/market-feature-subscriptions.mjs';
// @ts-expect-error runtime module
import {attachPolymarketPresence,createPolymarketStream} from '../runtime/polymarket-stream.mjs';
// @ts-expect-error runtime module
import {emitRoomState} from '../runtime/room-state.mjs';
class Client {
 id='test';connected=true;data:any={expires:10000,marketRoute:'/markets'};
 handlers=new Map<string,Function[]>();events:any[]=[];
 on(event:string,fn:Function){this.handlers.set(event,[...(this.handlers.get(event)??[]),fn]);}
 emit(...args:any[]){this.events.push(args);}
 async receive(event:string,...args:any[]){for(const fn of this.handlers.get(event)??[])await fn(...args);}
}
const universe={stocks:['AAPL','MSFT'],forex:['EUR/USD'],crypto:['BTC'],delisted:['OLD']};
async function fixture(){
 let features:any={stocks:true,forex:true,polymarket:true};
 const settings=createFeatureSettings({findOne:async()=>({features})},{pollMs:100000});
 await settings.ready;
 return {settings,async patch(value:any){features={...features,...value};await settings.refresh();}};
}
test('server rejects disabled/unknown new subscriptions and suspends existing selections without restarting sockets',async()=>{
 const f=await fixture(),s=new Client();
 const sub=attachMarketFeatureSubscriptions(s,{settings:f.settings,now:()=>1000});sub.updateSymbols(universe);
 try{
  await s.receive('market:subscribe','AAPL');await s.receive('candles:subscribe',{symbol:'AAPL',granularity:'1m'});
  await f.patch({stocks:false});
  assert.equal(s.data.marketSymbol,undefined);assert.equal(s.data.chart,undefined);
  let ack:any;await s.receive('market:subscribe','MSFT',(value:any)=>ack=value);assert.equal(ack.error,'feature_disabled');
  await s.receive('candles:subscribe',{symbol:'MSFT',granularity:'1m'},(value:any)=>ack=value);assert.equal(ack.error,'feature_disabled');
  await f.patch({stocks:true});assert.equal(s.data.marketSymbol,undefined);assert.equal(s.data.chart,undefined,'disabled new wishes never become subscriptions');
  await s.receive('market:subscribe','UNKNOWN');assert.equal(s.data.marketSymbol,undefined);
  await s.receive('market:subscribe','EUR/USD');await s.receive('candles:subscribe',{symbol:'EUR/USD',granularity:'1m'});
  await f.patch({forex:false});assert.equal(s.data.marketSymbol,undefined);assert.equal(s.data.chart,undefined);
  await f.patch({forex:true});assert.equal(s.data.marketSymbol,'EUR/USD');assert.equal(s.data.chart.symbol,'EUR/USD');
 }finally{await s.receive('disconnect');f.settings.stop();}
});
test('null, navigation, expiry, disconnect and delisting invalidate wishes while disabled',async()=>{
 for(const revoke of ['null','navigation','expiry','disconnect','delisted']){
  const f=await fixture(),s=new Client();const sub=attachMarketFeatureSubscriptions(s,{settings:f.settings,now:()=>1000});sub.updateSymbols(universe);
  try{
   await s.receive('market:subscribe','AAPL');await s.receive('candles:subscribe',{symbol:'AAPL',granularity:'1m'});
   await f.patch({stocks:false});
   if(revoke==='null'){await s.receive('market:subscribe',null);await s.receive('candles:subscribe',null);}
   if(revoke==='navigation'){await s.receive('tab:report',{route:'/poker'});await s.receive('tab:report',{route:'/markets'});}
   if(revoke==='expiry')s.data.expires=0;
   if(revoke==='disconnect'){s.connected=false;await s.receive('disconnect');}
   if(revoke==='delisted')sub.updateSymbols({...universe,stocks:[]});
   await f.patch({stocks:true});assert.equal(s.data.marketSymbol,undefined,revoke);assert.equal(s.data.chart,undefined,revoke);
  }finally{await s.receive('disconnect');f.settings.stop();}
 }
});
test('disabled in-flight snapshot cannot emit chart/forex quote updates or stock summaries',async()=>{
 const f=await fixture(),s=new Client();const sub=attachMarketFeatureSubscriptions(s,{settings:f.settings,now:()=>1000});sub.updateSymbols(universe);
 try{
  await s.receive('market:subscribe','EUR/USD');await s.receive('candles:subscribe',{symbol:'EUR/USD',granularity:'1m'});
  await f.patch({forex:false,stocks:false});
  const room=sub.project({marketSummary:{AAPL:{price:1},'EUR/USD':{price:2},BTC:{price:3}},quotes:{'EUR/USD':{micro:1}},forexQuotes:{'EUR/USD':{micro:1}},forexExecution:{'EUR/USD':{executable:true}}});
  emitRoomState(s,{maintenance:{blocked:false},room});
  const payload=s.events.at(-1)[1].data;
  assert.deepEqual(payload.quotes,{});assert.deepEqual(payload.forexQuotes,{});assert.deepEqual(payload.forexExecution,{});assert.deepEqual(payload.marketSummary,{});
 }finally{await s.receive('disconnect');f.settings.stop();}
});
test('prediction disable fences pending lookup; reenable restores only still-current authenticated demand',async()=>{
 const f=await fixture(),s=new Client();s.data.marketRoute='/polymarket';
 let release!:()=>void,lookup=0,checks=0;const pending=new Promise<void>(r=>release=r);
 const selections:(string|null)[]=[];
 attachPolymarketPresence(s,{settings:f.settings,now:()=>1000,checkSession:async()=>{checks++;},resolveMarket:async()=>{if(++lookup===1)await pending;return {tokens:['11','12']};},stream:{setViewer(_viewer:string,id:string|null){s.data.polyMarketId=id;selections.push(id);},status:()=>({})}});
 try{
  const watching=s.receive('polymarket:watch','1');await new Promise(r=>setImmediate(r));
  await f.patch({polymarket:false});release();await watching;assert.equal(s.data.polyMarketId,null);assert.ok(!selections.includes('1'));
  await f.patch({polymarket:true});await new Promise(r=>setImmediate(r));assert.equal(s.data.polyMarketId,'1');assert.ok(checks>=2);
  await f.patch({polymarket:false});await s.receive('tab:report',{route:'/players'});await s.receive('tab:report',{route:'/polymarket'});
  await f.patch({polymarket:true});await new Promise(r=>setImmediate(r));assert.equal(s.data.polyMarketId,null);
 }finally{await s.receive('disconnect');f.settings.stop();}
});
test('cross-process changes are observed on the next 500ms poll, not synchronously at DB write',async(t)=>{
 t.mock.timers.enable({apis:['setInterval']});
 let row={features:{stocks:true}},reads=0;
 const settings=createFeatureSettings({findOne:async()=>{reads++;return row;}});
 try{
  await settings.ready;assert.equal(reads,1);
  row={features:{stocks:false}};t.mock.timers.tick(499);assert.equal(settings.enabled('stocks'),true);assert.equal(reads,1);
  t.mock.timers.tick(1);await new Promise(r=>setImmediate(r));
  assert.equal(settings.enabled('stocks'),false);assert.equal(reads,2);
 }finally{settings.stop();t.mock.timers.reset();}
});
test('expired prediction grace demand is not reopened on enable',()=>{
 let on=true,now=0,opens=0;
 class Wire extends EventTarget{readyState=0;send(){}close(){this.readyState=3;}}
 const stream=createPolymarketStream({enabled:()=>on,now:()=>now,graceMs:5,connect:()=>{opens++;return new Wire();}});
 try{
  stream.setViewer('v','1',['11','12']);assert.equal(opens,1);
  on=false;stream.syncEnabled();stream.setViewer('v',null);now=10;
  on=true;stream.syncEnabled();assert.equal(opens,1);assert.equal(stream.diagnostics().markets.length,0);
 }finally{stream.stop();}
});
