import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {confirmFeatureChange} from '../runtime/feature-confirmation.mjs';
import {createFeatureSettings} from '../runtime/feature-settings.mjs';
// @ts-expect-error direct runtime fanout module
import {broadcastFeatureState} from '../runtime/feature-broadcast.mjs';
import {createFeatureRevisionObserver} from '../runtime/feature-revision.mjs';
test('atomic confirmations enforce revision CAS, preserve audit and do not mutate on stale review',async()=>{
 let row:any=null;
 const collection={
  async findOne(){return structuredClone(row);},
  async updateOne(query:any,update:any,options:any){
   const revision=row?.revision??0;
   const expected=query.revision??0;
   if(row&&revision!==expected){
    if(options.upsert)throw Object.assign(Error('duplicate'),{code:11000});
    return {matchedCount:0};
   }
   if(!row&&!options.upsert)return {matchedCount:0};
   const existed=!!row;row??={features:{},audit:[],revision:0};
   for(const [field,value]of Object.entries(update.$set))row.features[field.slice(9)]=value;
   row.revision++;row.audit.push(update.$push.audit);
   return {matchedCount:existed?1:0,upsertedCount:existed?0:1};
  }
 };
 const input={features:{stocks:true,forex:true},expectedRevision:0,actor:'admin',at:1,id:'first'};
 assert.equal(await confirmFeatureChange(collection,input),true);
 assert.deepEqual(row.features,{stocks:true,forex:true});assert.equal(row.revision,1);assert.equal(row.audit.length,1);
 assert.equal(await confirmFeatureChange(collection,{...input,features:{stocks:false},id:'stale'}),false);
 assert.equal(row.features.stocks,true);assert.equal(row.audit.length,1);
 assert.equal(await confirmFeatureChange(collection,{...input,expectedRevision:1,features:{stocks:false},id:'second'}),true);
 assert.equal(row.revision,2);assert.equal(row.features.stocks,false);assert.equal(row.features.forex,true);assert.equal(row.audit.length,2);
});
test('confirmed revisions broadcast to every connected client and raise persistent refresh signal without auto reload',async()=>{
 let row={features:{stocks:true},revision:7},adminBanner=0,userBanner=0,shutdown=0;
 const settings=createFeatureSettings({findOne:async()=>row},{pollMs:100000});
 await settings.ready;
 const events:any[]=[];
 const client=(id:string,onChange:()=>void)=>{const observe=createFeatureRevisionObserver(onChange);return {connected:true,data:{} as any,emit(event:string,payload:any){events.push({id,event,payload});observe(payload);}};};
 const admin=client('admin',()=>adminBanner++),user=client('user',()=>userBanner++),inactive=client('gone',()=>assert.fail('disconnected receives nothing'));inactive.connected=false;
 const io={sockets:{sockets:new Map([['admin',admin],['user',user],['gone',inactive]])}};
 try{
  broadcastFeatureState(io,settings);assert.equal(adminBanner,0);assert.equal(userBanner,0);
  settings.subscribe(()=>{if(!settings.enabled('stocks'))shutdown++;broadcastFeatureState(io,settings);});
  // A staged frontend value is not persisted and cannot broadcast or affect feeds.
  await settings.refresh();assert.equal(events.length,2);assert.equal(shutdown,0);
  row={features:{stocks:false},revision:8};await settings.refresh();
  assert.equal(shutdown,1);assert.equal(events.length,4);assert.equal(adminBanner,1);assert.equal(userBanner,1);
  assert.deepEqual(events.at(-1).payload,{features:settings.current(),revision:8});
  assert.equal(admin.data.forceFull,true);assert.equal(user.data.statusAt,0);
  await settings.refresh();assert.equal(events.length,4);
  // Confirmed changes also count when effective flags stay equal (e.g. force-off).
  row={features:{stocks:false},revision:9};await settings.refresh();assert.equal(events.length,6);
  assert.equal(adminBanner,1);assert.equal(userBanner,1,'signal persists, does not auto-dismiss or re-trigger');
  const source=readFileSync('server.mjs','utf8');
  assert.match(source,/featureSettings.subscribe\(\(\)=>\{polyStream.syncEnabled\(\);broadcastFeatureState\(io,featureSettings\);\}\)/);
  assert.match(source,/socket.emit\("features:state",featureSettings.snapshot\(\)\)/);
 }finally{settings.stop();}
});
test('confirmation API requires expected revision and returns real 409 with current settings',()=>{
 const source=readFileSync('app/api/admin/features/route.ts','utf8');
 assert.match(source,/expectedRevision:z.number\(\).int\(\).min\(0\)/);
 assert.match(source,/changeFeatures\(who,features,expectedRevision\)/);
 assert.match(source,/status:'error' in result\?409:200/);
 assert.match(readFileSync('lib/api.ts','utf8'),/if\(result instanceof Response\)return result/);
});

test('confirmed multi-flag batch increments once and fans out to ALL sockets; no-op and conflict never broadcast',async()=>{
 let row:any={features:{stocks:false,forex:false},revision:10,audit:[]},writes=0;
 const collection={
  async findOne(){return structuredClone(row);},
  async updateOne(filter:any,update:any){
   if(filter.revision!==row.revision)return {matchedCount:0};
   assert.deepEqual(update.$inc,{revision:1});writes++;
   for(const [key,value] of Object.entries(update.$set))row.features[key.slice(9)]=value;
   row.revision+=update.$inc.revision;row.audit.push(update.$push.audit);return {matchedCount:1};
  }
 };
 const settings=createFeatureSettings(collection,{pollMs:100000});await settings.ready;
 const events:any[]=[];
 const clients=['admin','ordinary-player','other-route'].map(id=>[id,{connected:true,data:{},emit(event:string,payload:any){events.push({id,event,payload});}}] as const);
 const io={sockets:{sockets:new Map(clients)}};
 settings.subscribe(()=>broadcastFeatureState(io,settings));
 const input={features:{stocks:true,forex:true},expectedRevision:10,actor:'admin',at:1,id:'batch'};
 try{
  assert.equal(await confirmFeatureChange(collection,input),true);await settings.refresh();
  assert.equal(row.revision,11);assert.equal(writes,1);assert.equal(row.audit.length,1);
  assert.deepEqual(events.map(e=>e.id),['admin','ordinary-player','other-route']);
  for(const event of events){assert.equal(event.event,'features:state');assert.equal(event.payload.revision,11);assert.equal(typeof event.payload.revision,'number');}
  assert.equal(await confirmFeatureChange(collection,{...input,expectedRevision:11}),true);await settings.refresh();
  assert.equal(writes,1);assert.equal(row.revision,11);assert.equal(events.length,3);assert.equal(row.audit.length,1);
  assert.equal(await confirmFeatureChange(collection,{...input,features:{stocks:false}}),false);await settings.refresh();
  assert.equal(writes,1);assert.equal(row.revision,11);assert.equal(events.length,3);
 }finally{settings.stop();}
});
test('implicit configured defaults are also no-ops without inserting a document',async()=>{
 let writes=0;const collection={findOne:async()=>null,updateOne:async()=>{writes++;return {upsertedCount:1};}};
 assert.equal(await confirmFeatureChange(collection,{features:{stocks:false,poker:true},expectedRevision:0,actor:'admin',at:1,id:'noop'}),true);
 assert.equal(writes,0);
});
