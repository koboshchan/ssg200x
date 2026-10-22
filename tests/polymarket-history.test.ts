import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
// @ts-expect-error directly tested server runtime
import {createPolymarketHistory,authorizePolymarketHistory,polymarketFinancialPins} from '../runtime/polymarket-history.mjs';
class Store{
 docs=new Map<string,any>();writes=0;
 async findOne(query:any){return structuredClone(this.docs.get(query._id)??null);}
 async updateOne(query:any,update:any){this.writes++;let doc=this.docs.get(query._id);if(update.$setOnInsert&&!doc){doc=structuredClone(update.$setOnInsert);this.docs.set(query._id,doc);}if(doc&&update.$push){doc.points.push(...structuredClone(update.$push.points.$each));doc.points=doc.points.slice(update.$push.points.$slice);Object.assign(doc,update.$set);}return{matchedCount:doc?1:0};}
}
function setup(){let mode='none',calls=0,time=1700000000000;const store=new Store();const options={collection:store,authorize:async(id:string,demand:any)=>!!demand&&['viewed','held'].includes(mode),canPersist:async()=>mode==='held'||mode==='order',resolveToken:async()=> '11',fetchHistory:async()=>{calls++;return[{t:1699999999,p:.5},{t:1699999998,p:.4},{t:1699999998,p:.45}];},now:()=>time,maxPoints:3};return{store,options,create:()=>createPolymarketHistory(options),calls:()=>calls,mode:(m:string)=>mode=m,time:(n:number)=>time+=n};}
test('no demand means no fetch or metadata resolution, even arbitrary direct cold chart requests',async()=>{
 const s=setup();let resolutions=0;s.options.resolveToken=async()=>{resolutions++;return'11';};const service=s.create();await assert.rejects(()=>service.read('1','all',{userId:'attacker'}),/View or hold/);assert.equal(s.calls(),0);assert.equal(resolutions,0);assert.equal(s.store.docs.size,0);
});
test('viewed and held empty markets backfill once, all ranges use durable stored history after service restart',async()=>{
 for(const mode of ['viewed','held']){const s=setup();s.mode(mode);let service=s.create();const first=await service.read('1','all',{userId:'u'});assert.equal(s.calls(),1);assert.deepEqual(first.points,[{t:1699999998000,p:.45},{t:1699999999000,p:.5}]);service=s.create();await service.read('1','1d',{userId:'u'});await service.read('1','1m',{userId:'u'});assert.equal(s.calls(),1);}
});
test('concurrent first demand shares one history fetch and durable empty result avoids repeated backfill',async()=>{
 const s=setup();s.mode('viewed');let calls=0;let release:Function=()=>{};s.options.fetchHistory=()=>{calls++;return new Promise<any[]>(r=>{release=r;});};const service=s.create();const reads=Array.from({length:20},()=>service.read('1','all',{userId:'u'}));await new Promise(r=>setImmediate(r));assert.equal(calls,1);release([]);await Promise.all(reads);assert.equal((await s.create().read('1','all',{userId:'u'})).points.length,0);assert.equal(calls,1);
});
test('failed backfill retries only on later explicit demand; expired presence before fetch never backfills',async()=>{
 const s=setup();s.mode('held');s.options.fetchHistory=async()=>{throw new Error('upstream');};await assert.rejects(()=>s.create().read('1','all',{userId:'u'}),/upstream/);assert.equal(s.store.docs.size,0);
 let authorizations=0;s.options.authorize=async()=>++authorizations===1;await assert.rejects(()=>s.create().read('1','all',{userId:'u'}),/demand ended/);assert.equal(s.calls(),0);
});
test('held live append retains bounded persisted points, throttles writes, never initiates history fetch',async()=>{
 const s=setup();s.mode('held');const service=s.create();const b={source:'stream',bids:[{price:'.4'}],asks:[{price:'.6'}]};await service.append('1','11',b);assert.equal(s.calls(),0);assert.equal(s.store.docs.size,0);await service.read('1','all',{userId:'u'});
 for(let i=0;i<7;i++){s.time(61000);await Promise.all(Array.from({length:5},()=>service.append('1','11',b)));}assert.equal(s.calls(),1);assert.equal(s.store.docs.get('1').points.length,3);assert.equal(s.store.writes,8);
 const writes=s.store.writes;await service.append('1','11',b);await service.append('1','12',b);assert.equal(s.store.writes,writes);const reused=await s.create().read('1','all',{userId:'u'});assert.equal(reused.points.length,3);assert.equal(s.calls(),1);
});
test('history authorization uses durable own holdings or matching live authenticated view and tab proof',async()=>{
 const socket={connected:true,data:{expires:200000,identity:{id:'u'},polyMarketId:'1',marketRoute:'/polymarket'},handshake:{auth:{tabId:'t',tabProof:'p'}}};let holding=false,checks=0;
 const options={marketId:'1',demand:{userId:'u',tabId:'t',tabProof:'p'},collection:{findOne:async(query:any)=>{assert.deepEqual(query['polymarket.positions'].$elemMatch,{userId:'u',marketId:'1',shareMicros:{$gt:0}});return holding?{_id:'main'}:null;}},sockets:()=>[socket],checkTab:()=>null,checkSession:async()=>{checks++;},now:()=>100000};
 assert.equal(await authorizePolymarketHistory(options),true);assert.equal(checks,1);assert.equal(await authorizePolymarketHistory({...options,demand:{...options.demand,tabProof:'wrong'}}),false);socket.data.polyMarketId='2';assert.equal(await authorizePolymarketHistory(options),false);holding=true;assert.equal(await authorizePolymarketHistory(options),true);assert.equal(await authorizePolymarketHistory({...options,marketId:'bad'}),false);
});
test('all chart routes use server demand bridge, no global history sweep, browser uses same-origin data',()=>{
 const data=readFileSync(new URL('../lib/polymarket-data.ts',import.meta.url),'utf8'),server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8'),ui=readFileSync(new URL('../app/polymarket-client.tsx',import.meta.url),'utf8');
 assert.doesNotMatch(data,/prices-history/);assert.equal((server.match(/polyHistory\.read\(/g)||[]).length,1);assert.match(server,/if\(history\)/);assert.match(server,/if\(polyOwners.has\(id\)\)/);assert.doesNotMatch(ui,/https?:\/\/[^"' ]*polymarket\./);
 for(const route of ['../app/api/polymarket/chart/route.ts','../app/api/polymarket/markets/[id]/history/route.ts']){const source=readFileSync(new URL(route,import.meta.url),'utf8');assert.match(source,/userId:who.id/);assert.match(source,/x-tab-proof/);assert.doesNotMatch(source,/tokenId/);}
});

test('viewer backfill is durable but viewer-only realtime performs zero writes, even initialized or reconnected',async()=>{
 const s=setup();s.mode('viewed');let service=s.create();const b={source:'stream',bids:[{price:'.4'}],asks:[{price:'.6'}]};
 await service.append('1','11',b);assert.equal(s.store.writes,0);await service.read('1','all',{userId:'u'});assert.equal(s.store.writes,1,'historical REST backfill remains independently allowed');
 const writes=s.store.writes;for(let i=0;i<3;i++){s.time(61000);service=s.create();await service.append('1','11',b);}assert.equal(s.store.writes,writes);assert.equal(s.calls(),1);
});
test('position/order demand starts realtime writes, final close stops them with viewers remaining, including reconnect',async()=>{
 for(const pin of ['held','order']){const s=setup();s.mode('viewed');let service=s.create();await service.read('1','all',{userId:'u'});const b={source:'stream',bids:[{price:'.4'}],asks:[{price:'.6'}]};s.mode(pin);await service.append('1','11',b);assert.equal(s.store.writes,2);
 s.mode('viewed');s.time(61000);await service.append('1','11',b);service=s.create();await service.append('1','11',b);assert.equal(s.store.writes,2,'close prevents writes while viewer still subscribed');
 s.mode(pin);await service.append('1','11',b);assert.equal(s.store.writes,3,'financial demand survives service reconnect');}
});
test('financial pin removal during asynchronous Mongo read cancels pending tick write',async()=>{
 const s=setup();s.mode('held');const service=s.create();await service.read('1','all',{userId:'u'});const original=s.store.findOne.bind(s.store);s.store.findOne=async q=>{const doc=await original(q);s.mode('viewed');return doc;};
 await service.append('1','11',{source:'stream',bids:[{price:'.4'}],asks:[{price:'.6'}]});assert.equal(s.store.writes,1);
});
test('only positive durable positions and explicit active remaining orders create financial pins',()=>{
 const base={marketId:'1',tokenId:'11'};
 const pins=polymarketFinancialPins({positions:[{...base,shareMicros:1},{...base,shareMicros:0}],orders:['open','partially_filled','filled','cancelled','expired','pending'].map(status=>({...base,status,remainingShareMicros:2})).concat([{...base,status:'open',remainingShareMicros:0}])});assert.equal(pins.length,3);assert.deepEqual(pins.map((p:any)=>p.shareMicros),[1,2,2]);assert.deepEqual(polymarketFinancialPins({}),[]);
});
// @ts-expect-error server stream runtime tested without a browser
import {createPolymarketStream} from '../runtime/polymarket-stream.mjs';
test('actual shared socket reconnect keeps viewers live without persisting, financial pins alone toggle writes',async()=>{
 class Wire extends EventTarget{readyState=0;send(_:string){}close(){this.readyState=3;this.dispatchEvent(new Event('close'));}open(){this.readyState=1;this.dispatchEvent(new Event('open'));}tick(){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({event_type:'book',asset_id:'11',market:'c',bids:[{price:'.4',size:'1'}],asks:[{price:'.6',size:'1'}]})}));}}
 const s=setup();s.mode('viewed');const history=s.create();await history.read('1','all',{userId:'u'});let now=100000;const wires:Wire[]=[];const stream=createPolymarketStream({now:()=>now,connect:()=>{const w=new Wire();wires.push(w);return w;}});
 const persist=async()=>{const book=stream.read('11');assert(book,'viewers receive fresh live book');await history.append('1','11',book);};
 stream.setViewer('v','1',['11']);wires[0].open();wires[0].tick();await persist();assert.equal(s.store.writes,1);
 s.mode('held');stream.syncPositions([{marketId:'1',tokenId:'11',shareMicros:1}]);await persist();assert.equal(s.store.writes,2);
 wires[0].close();now+=501;stream.sweep();wires[1].open();wires[1].tick();s.time(61000);await persist();assert.equal(s.store.writes,3,'held reconnect resumes persistence');
 s.mode('viewed');stream.syncPositions([]);wires[1].close();now+=501;stream.sweep();wires[2].open();wires[2].tick();s.time(61000);await persist();assert.equal(s.store.writes,3);assert.equal(stream.diagnostics().markets[0].viewers,1);stream.stop();
});
