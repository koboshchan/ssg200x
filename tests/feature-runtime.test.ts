import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFeatureSettings} from '../runtime/feature-settings.mjs';
import {attachFeatureSocket,socketFeature} from '../runtime/feature-sockets.mjs';
// @ts-expect-error runtime is tested directly
import {createPolymarketStream} from '../runtime/polymarket-stream.mjs';

test('feature settings require initial read, honor force-off, and publish dynamic changes',async()=>{
 let row:any={features:{stocks:true,forex:true,chat:false}},reads=0;
 const settings=createFeatureSettings({async findOne(filter){assert.deepEqual(filter,{_id:'global'});reads++;return row;}},{env:{SSG_FEATURES_FORCE_OFF:' stocks,forex '},pollMs:100_000});
 try{
  await settings.ready;assert.equal(settings.enabled('stocks'),false);assert.equal(settings.enabled('forex'),false);assert.equal(settings.enabled('chat'),false);assert.equal(settings.enabled('poker'),true);
  const updates:any[]=[];const off=settings.subscribe(next=>updates.push(next));
  row={features:{chat:true,poker:false,forex:true}};await Promise.all([settings.refresh(),settings.refresh()]);assert.equal(reads,2);assert.equal(updates.length,1);assert.equal(settings.enabled('poker'),false);assert.equal(settings.enabled('forex'),false);
  assert(Object.isFrozen(settings.current()));off();row=null;await settings.refresh();assert.equal(updates.length,1);assert.equal(settings.enabled('poker'),true);
 }finally{settings.stop();}
});

test('settings failures retain last explicit disable rather than resetting defaults',async()=>{
 let fails=false;
 const settings=createFeatureSettings({async findOne(){if(fails)throw Error('offline');return{features:{polymarket:false,chat:false}};}},{pollMs:100_000});
 try{await settings.ready;fails=true;await assert.rejects(settings.refresh(),/offline/);assert.equal(settings.enabled('chat'),false);assert.equal(settings.enabled('polymarket'),false);}finally{settings.stop();}
});

test('socket feature middleware rejects posting before handlers, not history or release',()=>{
 let middleware:(packet:any[],next:()=>void)=>void=()=>{};
 const disabled=new Set(['chat','tableTalk','dms','polymarket','poker']);
 attachFeatureSocket({use(fn){middleware=fn;}},{enabled:key=>!disabled.has(key)});
 for(const event of ['chat:send','chat:wrap','chat:claim','chat:keys:put','dm:send','polymarket:watch','poker:taunt']){
  let invoked=false,reply:any;
  middleware([event,'1',(value:any)=>{reply=value;}],()=>{invoked=true;});
  assert.equal(invoked,false,event);assert.equal(reply.error,'feature_disabled',event);
 }
 for(const [event,payload]of [['chat:history',{}],['dm:history',{}],['dm:read',{}],['chat:keys:get',{}],['polymarket:watch',null],['tab:report',{route:'/'}]]){
  let invoked=false;middleware([event,payload],()=>{invoked=true;});assert.equal(invoked,true,String(event));
 }
 assert.deepEqual(socketFeature('dm:send',{}),['chat','dms']);
});

class Wire extends EventTarget{
 readyState=0;closed=false;frames:string[]=[];
 send(value:string){this.frames.push(value);}
 close(){this.closed=true;this.readyState=3;this.dispatchEvent(new Event('close'));}
 open(){this.readyState=1;this.dispatchEvent(new Event('open'));}
}
test('disabled prediction feature opens no socket even for durable pins, closes on disable, and resumes',()=>{
 let enabled=false;const wires:Wire[]=[];
 const stream=createPolymarketStream({enabled:()=>enabled,connect:()=>{const wire=new Wire();wires.push(wire);return wire;}});
 try{
  stream.setViewer('viewer','1',['11','12']);stream.syncPositions([{marketId:'1',tokenId:'11',shareMicros:3}]);stream.sweep();assert.equal(wires.length,0);
  enabled=true;stream.syncEnabled();assert.equal(wires.length,1);wires[0].open();assert.equal(stream.diagnostics().connected,true);
  enabled=false;stream.syncEnabled();assert.equal(wires[0].closed,true);assert.equal(stream.diagnostics().connections,0);assert.equal(stream.read('11'),null);
  stream.sweep();assert.equal(wires.length,1);
  enabled=true;stream.syncEnabled();assert.equal(wires.length,2);assert.equal(stream.diagnostics().markets[0].positions,1);
 }finally{stream.stop();}
});
test('pending upstream open cannot subscribe after a feature disable',()=>{
 let enabled=true;const wire=new Wire();const stream=createPolymarketStream({enabled:()=>enabled,connect:()=>wire});
 try{stream.setViewer('viewer','1',['11','12']);enabled=false;wire.open();assert.equal(wire.closed,true);assert.equal(wire.frames.length,0);assert.equal(stream.diagnostics().connections,0);}finally{stream.stop();}
});

// @ts-expect-error runtime module
import {createChatService} from '../runtime/chat-service.mjs';
// @ts-expect-error runtime module
import {createDmService} from '../runtime/dm-service.mjs';
import {createPokerTaunts} from '../runtime/poker-taunts.mjs';
test('disabled chat/DM service rejects queued sends before DB work, even without socket middleware',async()=>{
 let operations=0;
 const collection={createIndex:async()=>{},findOne:async()=>{operations++;throw Error('unexpected DB read');},updateOne:async()=>{operations++;throw Error('unexpected DB write');}};
 const db={collection:()=>collection};
 for(const service of [createChatService(db,{canSend:()=>false}),createDmService(db,{canSend:()=>false})]){
  await service.ready;
  await assert.rejects(service.handle('alice','send',{}),(error:any)=>error.chatCode==='feature_disabled');
 }
 assert.equal(operations,0);
});
test('disabled paid taunts reject before reads, charges, or effects',async()=>{
 let operations=0,handler:any;
 const attach=createPokerTaunts({enabled:()=>false,collection:{findOne:async()=>{operations++;return null;},updateOne:async()=>{operations++;return{matchedCount:0};}},io:{sockets:{sockets:new Map()}},checkSession:async()=>{},checkTab:()=>null});
 const socket:any={on:(_event:string,fn:any)=>{handler=fn;},data:{identity:{id:'alice'}}};attach(socket);
 let reply:any;await handler({kind:'throw'},(value:any)=>{reply=value;});
 assert.equal(reply.error,'feature_disabled');assert.equal(operations,0);
});

test('all shipped minigame keys can be independently disabled and force-off includes chicken',async()=>{
 const games=['plinko','hilo','mines','dice','chicken'] as const;
 const settings=createFeatureSettings({async findOne(){return{features:{plinko:false,hilo:false,mines:false,dice:false,chicken:true}};}},{env:{SSG_FEATURES_FORCE_OFF:'chicken'},pollMs:100_000});
 try{await settings.ready;for(const game of games)assert.equal(settings.enabled(game),false,game);assert.equal(settings.enabled('games'),true);}finally{settings.stop();}
});
