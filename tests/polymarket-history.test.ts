import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
// @ts-expect-error directly tested server runtime
import {createPolymarketHistory,authorizePolymarketHistory} from '../runtime/polymarket-history.mjs';
class Store{
 docs=new Map<string,any>();writes=0;
 async findOne(query:any){return structuredClone(this.docs.get(query._id)??null);}
 async updateOne(query:any,update:any){this.writes++;let doc=this.docs.get(query._id);if(update.$setOnInsert&&!doc){doc=structuredClone(update.$setOnInsert);this.docs.set(query._id,doc);}if(doc&&update.$push){doc.points.push(...structuredClone(update.$push.points.$each));doc.points=doc.points.slice(update.$push.points.$slice);Object.assign(doc,update.$set);}return{matchedCount:doc?1:0};}
}
function setup(){let mode='none',calls=0,time=1700000000000;const store=new Store();const options={collection:store,authorize:async(id:string,demand:any)=>!!demand&&['viewed','held'].includes(mode),resolveToken:async()=> '11',fetchHistory:async()=>{calls++;return[{t:1699999999,p:.5},{t:1699999998,p:.4},{t:1699999998,p:.45}];},now:()=>time,maxPoints:3};return{store,options,create:()=>createPolymarketHistory(options),calls:()=>calls,mode:(m:string)=>mode=m,time:(n:number)=>time+=n};}
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
