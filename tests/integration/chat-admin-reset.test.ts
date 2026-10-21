import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
import {createIdentity,makeWrap,newEpochKey,registerData,signText,sealMessage} from '../../lib/chat-crypto';
// @ts-expect-error runtime module
import {createChatService} from '../../runtime/chat-service.mjs';
if(!process.env.MONGODB_DB?.startsWith('fakebucks_test_'))throw Error('Isolated database required');
const client=new MongoClient(process.env.MONGODB_URI!),db=client.db(process.env.MONGODB_DB+'_adminreset');
after(async()=>{await db.dropDatabase();await client.close();});
// Clerk's PATCH recursively merges objects and deletes null-valued properties.
function merge(a:any,p:any){for(const [k,v]of Object.entries(p)){if(v===null)delete a[k];else if(v&&typeof v==='object'&&!Array.isArray(v)){a[k]??={};merge(a[k],v);}else a[k]=v;}return a;}
async function fixture(name:string){
 const admin=name+'-admin',user=name+'-user',publicId='a'.repeat(16),profiles:Record<string,any>={};
 profiles[admin]={privateMetadata:{admin:true},publicMetadata:{}};
 profiles[user]={privateMetadata:{admin:false,keep:'private'},publicMetadata:{keep:'public'}};
 const clerk={users:{getUser:async(u:string)=>structuredClone(profiles[u]||{}),updateUserMetadata:async(u:string,p:any)=>merge(profiles[u],structuredClone(p))}};
 await db.collection('rooms').replaceOne({_id:'main' as never},{_id:'main' as never,version:1,members:[{id:admin,publicId:'b'.repeat(16),approved:true},{id:user,publicId,approved:true}]},{upsert:true});
 const chat=createChatService(db,{clerk});await chat.ready;
 const first=await createIdentity(user,0);await chat.handle(user,'keys:put',first.body);
 const reset=(requestId=crypto.randomUUID())=>({v:1,publicId,requestId,requestAt:Date.now(),confirm:true});
 return {admin,user,publicId,profiles,clerk,chat,first,reset};
}
test('admin reset revokes live keys and backup, preserves unrelated metadata/epoch/history, new generation is immutable',async()=>{
 const {admin,user,profiles,chat,first,reset}=await fixture('complete');
 let view=await chat.handle(user,'state',{v:1});const epoch=view.epoch;
 view=await chat.handle(user,'claim',{v:1,revision:view.revision,epoch,deviceId:first.identity.deviceId});
 const key=await newEpochKey(),wrap=await makeWrap(first.identity,user,{revision:view.revision,epoch,toUserId:user,toDeviceId:first.identity.deviceId},first.identity.dhPublic,key);
 await chat.handle(user,'wrap',wrap);
 const msg=await sealMessage(first.identity,user,{revision:view.revision,epoch,id:crypto.randomUUID(),ts:Date.now()},'private history',key);
 await chat.handle(user,'send',msg);
 const payload=reset(),result=await chat.adminReset(admin,payload);
 assert.deepEqual(result,{reset:true});assert.equal(JSON.stringify(result).includes('backup'),false);
 assert.deepEqual(profiles[user],{privateMetadata:{admin:false,keep:'private',tabletalk:{}},publicMetadata:{keep:'public',tabletalk:{}}});
 assert.equal(await db.collection('chat_devices').countDocuments({userId:user}),0);
 assert.equal(await db.collection('chat_wraps').countDocuments({toUserId:user}),0);
 assert.equal((await db.collection('chat_states').findOne({_id:'main' as never}))!.epoch,epoch);
 assert.equal(await db.collection('chat_messages').countDocuments({senderUserId:user}),1);
 await assert.rejects(chat.handle(user,'history',{v:1,epoch,deviceId:first.identity.deviceId}),/device_required/);
 await assert.rejects(chat.handle(user,'register',{v:1,deviceId:first.identity.deviceId,dhPublic:first.identity.dhPublic,signPublic:first.identity.signPublic,signature:await signText(first.identity.signPrivate,registerData(user,first.identity))}),/identity_conflict/);
 const missing=await chat.handle(user,'keys:get',{v:1});assert.equal(missing.identity,null);assert.equal(missing.resetRequired,true);assert.equal(missing.expectedVersion,2);
 await assert.rejects(chat.handle(user,'keys:put',first.body),/identity_exists/);
 const second=await createIdentity(user,missing.expectedVersion);await chat.handle(user,'keys:put',second.body);
 assert.equal((await chat.handle(user,'keys:get',{v:1})).identity.deviceId,second.identity.deviceId);
 await assert.rejects(chat.handle(user,'keys:put',(await createIdentity(user,second.identity.keyVersion)).body),/identity_exists/);
 await chat.adminReset(admin,payload);assert.equal((await chat.handle(user,'keys:get',{v:1})).identity.deviceId,second.identity.deviceId,'old request replay cannot reset a newly created identity');
 const audits=await db.collection('audit').find({_id:payload.requestId as never}).toArray();assert.equal(audits.length,1);assert.equal(audits[0].what,'chat-words-reset');assert.ok(!JSON.stringify(audits).includes(first.body.backup.ciphertext));
});
test('server fresh admin auth, schema/confirm/time checks and target rate limit fail closed',async()=>{
 const {admin,user,profiles,chat,reset}=await fixture('auth');
 for(const actor of [user,'unknown'])await assert.rejects(chat.adminReset(actor,reset()),/forbidden/);
 profiles[admin].privateMetadata.admin=false;await assert.rejects(chat.adminReset(admin,reset()),/forbidden/);profiles[admin].privateMetadata.admin=true;
 for(const p of [{...reset(),confirm:false},{...reset(),requestAt:0},{...reset(),backup:'forbidden'},{...reset(),publicId:'x'}])await assert.rejects(chat.adminReset(admin,p));
 await chat.adminReset(admin,reset());await assert.rejects(chat.adminReset(admin,reset()),/rate_limited/);
});
test('ambiguous Clerk deletion fails closed and same audited request resumes cleanup',async()=>{
 const {admin,user,profiles,clerk,chat,first,reset}=await fixture('retry');
 const original=clerk.users.updateUserMetadata;let fail=true;
 clerk.users.updateUserMetadata=async(u,p)=>{if(fail){fail=false;throw Error('Clerk unavailable');}return original(u,p);};
 const p=reset();await assert.rejects(chat.adminReset(admin,p));
 await assert.rejects(chat.handle(user,'keys:get',{v:1}),/identity_unavailable/);
 await assert.rejects(chat.handle(user,'keys:put',first.body),/identity_exists/);
 assert.deepEqual(await chat.adminReset(admin,p),{reset:true});
 assert.equal(Object.keys(profiles[user].privateMetadata.tabletalk).length,0);
 assert.equal((await chat.handle(user,'keys:get',{v:1})).resetRequired,true);
});
test('admin can clear an interrupted immutable setup without publishing its pending secret',async()=>{
 const {admin,user,chat,reset}=await fixture('pending');
 await db.collection('chat_identity_versions').updateOne({_id:user as never},{$set:{status:'publishing',pendingVersion:2,pendingBackup:{ciphertext:'never expose'}}});
 await chat.adminReset(admin,reset());
 const pointer=await db.collection('chat_identity_versions').findOne({_id:user as never});
 assert.equal(pointer!.status,'setup_required');assert.equal(pointer!.version,3);assert.equal(pointer!.pendingBackup,undefined);
 const second=await createIdentity(user,3);await chat.handle(user,'keys:put',second.body);assert.equal((await chat.handle(user,'keys:get',{v:1})).identity.keyVersion,4);
});
