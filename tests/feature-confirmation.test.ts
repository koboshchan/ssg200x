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
