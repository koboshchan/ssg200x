import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
import {createIdentity,newEpochKey,makeWrap,sealMessage,signText,registerData} from '../../lib/chat-crypto';
// @ts-expect-error runtime service
import {createPokerChatService} from '../../runtime/poker-chat-service.mjs';
if(!process.env.MONGODB_DB?.startsWith('fakebucks_test_'))throw Error('Isolated database required');
const client=new MongoClient(process.env.MONGODB_URI!),db=client.db(process.env.MONGODB_DB+'_poker_chat_scope');
after(async()=>{await db.dropDatabase();await client.close();});
test('three table ciphertext namespaces retain main history and globally revoke identity grants',async()=>{
 const accounts=new Map<string,any>();
 const clerk={users:{getUser:async(u:string)=>accounts.get(u)||{privateMetadata:{}},updateUserMetadata:async(u:string,patch:any)=>{const old=accounts.get(u)||{};for(const f of ['publicMetadata','privateMetadata']){old[f]={...old[f],...patch[f]};}accounts.set(u,old);return old;}}};
 // Exercise normal scoping without Clerk publication, then reset through the real identity reset path.
 const service=createPokerChatService(db);await service.ready;
 await db.collection('rooms').insertOne({_id:'main' as never,version:1,members:[{id:'a',publicId:'aaaaaaaaaaaaaaaa',approved:true},{id:'b',publicId:'bbbbbbbbbbbbbbbb',approved:true}]});
 const a=(await createIdentity('a',0)).identity,b=(await createIdentity('b',0)).identity;
 for(const [user,id] of [['a',a],['b',b]] as const){await service.handle(user,'register',{v:1,deviceId:id.deviceId,dhPublic:id.dhPublic,signPublic:id.signPublic,signature:await signText(id.signPrivate,registerData(user,id))});}
 const histories=new Map<string,any>();
 for(const room of ['main','poker-02','poker-03']){
  const call=(event:string,p:any)=>service.handle('a',event,{...p,chatRoom:room});
  let state=await call('state',{v:1});state=await call('claim',{v:1,revision:state.revision,epoch:state.epoch,deviceId:a.deviceId});
  const key=await newEpochKey();
  const wrap=await makeWrap(a,'a',{room,revision:state.revision,epoch:state.epoch,toUserId:'a',toDeviceId:a.deviceId},a.dhPublic,key);
  await call('wrap',wrap);
  const grant=await makeWrap(a,'a',{room,revision:state.revision,epoch:state.epoch,toUserId:'b',toDeviceId:b.deviceId},b.dhPublic,key);
  await call('wrap',grant);
  const message=await sealMessage(a,'a',{room,revision:state.revision,epoch:state.epoch,id:crypto.randomUUID(),ts:Date.now()},room+' secret',key);
  await call('send',message);histories.set(room,{state,message,wrap,grant});
 }
 for(const room of histories.keys()){
  const state=await service.handle('a','state',{v:1,chatRoom:room});assert.equal(state.room,room);
  assert.equal(state.wraps.length,1);assert.equal(state.wraps[0].room,room);
  const own=histories.get(room);
  const history=await service.handle('a','history',{v:1,chatRoom:room,epoch:own.state.epoch,deviceId:a.deviceId});assert.equal(history.messages.length,1);assert.equal(history.messages[0].room,room);
  for(const [other,record] of histories){if(other===room)continue;
   await assert.rejects(service.handle('a','history',{v:1,chatRoom:room,epoch:record.state.epoch,deviceId:a.deviceId}),/waiting/);
   await assert.rejects(service.handle('a','send',{...record.message,chatRoom:room}),/malformed/);
   await assert.rejects(service.handle('a','wrap',{...record.wrap,chatRoom:room}),/malformed/);
   // Routing metadata can agree while authenticated room is forged. Even with
   // the target epoch/revision patched in, the old signature cannot authorize it.
   await assert.rejects(service.handle('a','send',{...record.message,room,epoch:own.state.epoch,revision:own.state.revision,chatRoom:room}),/invalid_signature/);
   await assert.rejects(service.handle('a','wrap',{...record.wrap,room,epoch:own.state.epoch,revision:own.state.revision,chatRoom:room}),/invalid_signature/);
  }
 }
 assert.equal(await db.collection('chat_devices').countDocuments(),2);
 assert.equal(await db.collection('chat_states').countDocuments(),3);
 // Main history is not recreated or renamed, including legacy room-less rows.
 const main=histories.get('main');await db.collection('chat_messages').updateOne({epoch:main.state.epoch},{$unset:{room:''}});
 assert.equal((await service.handle('a','history',{v:1,epoch:main.state.epoch,deviceId:a.deviceId})).messages.length,1);
 // Membership removal rotates all three on their next read and denies access globally.
 await db.collection('rooms').updateOne({_id:'main' as never},{$set:{members:[{id:'a',approved:true}]},$inc:{version:1}});
 for(const room of histories.keys()){
  await assert.rejects(service.handle('b','state',{v:1,chatRoom:room}),/forbidden/);
  const next=await service.handle('a','state',{v:1,chatRoom:room});assert.notEqual(next.epoch,histories.get(room).state.epoch);assert.ok(next.wraps.every((w:any)=>w.room===room));
 }
 // Actual global reset removes every table's persisted grants, not unrelated users.
 // @ts-expect-error runtime identity module
 const {createIdentityStore}=await import('../../runtime/chat-identity.mjs');
 accounts.set('admin',{privateMetadata:{admin:true}});accounts.set('b',{publicMetadata:{},privateMetadata:{}});
 await createIdentityStore(db,clerk).reset('b',crypto.randomUUID(),'admin');
 assert.equal(await db.collection('chat_devices').countDocuments({userId:'b'}),0);
 assert.equal(await db.collection('chat_wraps').countDocuments({toUserId:'b'}),0);
 assert.equal(await db.collection('chat_devices').countDocuments({userId:'a'}),1);
 for(const room of histories.keys())assert.equal(await db.collection('chat_messages').countDocuments({epoch:histories.get(room).state.epoch}),1);
 await assert.rejects(service.handle('a','state',{v:1,chatRoom:'poker-04'}),/malformed/);
});

test('dispatcher reset gates all table requests until global key revocation finishes',async()=>{
 const isolated=client.db(process.env.MONGODB_DB+'_poker_chat_gate');
 let release!:()=>void,entered!:()=>void;
 const held=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{entered=r;});
 const clerk={users:{getUser:async(u:string)=>({privateMetadata:{admin:u==='admin'},publicMetadata:{}}),updateUserMetadata:async()=>{entered();await held;}}};
 const service=createPokerChatService(isolated,{clerk});await service.ready;
 try{
  await isolated.collection('rooms').insertOne({_id:'main' as never,version:1,members:[{id:'a',approved:true,publicId:'aaaaaaaaaaaaaaaa'}]});
  const a=(await createIdentity('a',0)).identity;
  await isolated.collection('chat_identity_versions').insertOne({_id:'a' as never,status:'active',version:1});
  await isolated.collection('chat_devices').insertOne({_id:a.deviceId as never,userId:'a',deviceId:a.deviceId,keyVersion:1,dhPublic:a.dhPublic,signPublic:a.signPublic});
  const epochs=new Map<string,string>();
  for(const room of ['main','poker-02','poker-03']){
   const state=await service.handle('a','state',{v:1,chatRoom:room});epochs.set(room,state.epoch);
   await isolated.collection('chat_wraps').insertOne({_id:crypto.randomUUID() as never,room,epoch:state.epoch,toUserId:'a',toDeviceId:a.deviceId});
  }
  const resetting=service.adminReset('admin',{v:1,publicId:'aaaaaaaaaaaaaaaa',requestId:crypto.randomUUID(),requestAt:Date.now(),confirm:true});
  await started;
  let completed=0;
  const reads=[...epochs].map(([room,epoch])=>service.handle('a','history',{v:1,chatRoom:room,epoch,deviceId:a.deviceId}).then(()=>{completed++;throw Error('revoked key accepted');},(error:Error)=>{completed++;assert.match(error.message,/device_required|identity_conflict/);}));
  // A microtask barrier proves no queued room read runs during Clerk revocation.
  await Promise.resolve();assert.equal(completed,0);
  release();await resetting;await Promise.all(reads);assert.equal(completed,3);
  assert.equal(await isolated.collection('chat_wraps').countDocuments({toUserId:'a'}),0);
  assert.equal(await isolated.collection('chat_devices').countDocuments({userId:'a'}),0);
 }finally{release();await isolated.dropDatabase();}
});
