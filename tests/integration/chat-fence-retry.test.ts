import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
import {createHash} from 'node:crypto';
// @ts-expect-error runtime module
import {createChatService} from '../../runtime/chat-service.mjs';
if(!process.env.MONGODB_DB?.startsWith('fakebucks_test_'))throw Error('Isolated database required');
const client=new MongoClient(process.env.MONGODB_URI!),db=client.db(process.env.MONGODB_DB+'_fence');
after(async()=>{await db.dropDatabase();await client.close();});
export async function scenario(mode:string,event="keys:get"){
 await db.dropDatabase();
 await db.collection('rooms').insertOne({_id:'main' as never,version:1,members:[{id:'alice',approved:true}]});
 const epoch='00000000-0000-4000-8000-000000000002',deviceId='00000000-0000-4000-8000-000000000003';
 if(event==='history'){
  await db.collection('chat_devices').insertOne({_id:deviceId as never,userId:'alice',deviceId,keyVersion:1,dhPublic:'fixture-dh',signPublic:'fixture-sign'});
  await db.collection('chat_identity_versions').insertOne({_id:'alice' as never,status:'active',version:1});
  await db.collection('chat_wraps').insertOne({_id:createHash('sha256').update(JSON.stringify([epoch,'alice',deviceId])).digest('base64url') as never,room:'main',epoch,toUserId:'alice',toDeviceId:deviceId});
  await db.collection('chat_messages').insertOne({room:'main',epoch,cursor:1,ciphertext:'private-fixture-ciphertext'});
 }
 let attempts=0,clerkReads=0;
 const clerk={users:{getUser:async()=>{clerkReads++;return {publicMetadata:{},privateMetadata:{}};}}};
 const intercepted={collection:(name:string)=>{const c=db.collection(name);return new Proxy(c,{get(target,key){
  if(name==='rooms'&&key==='updateOne')return async(q:any,u:any,...args:any[])=>{
   if(u.$inc?.version===1){
    attempts++;
    if(mode==='revoke'&&attempts===1)await c.updateOne({_id:'main' as never},{$set:{'members.0.accessRevoked':true},$inc:{version:1}});
    else if(mode==='revision'&&attempts===1){await db.collection('chat_states').updateOne({_id:'main' as never},{$inc:{revision:1}});await c.updateOne({_id:'main' as never},{$inc:{version:1}});}
    else if(mode==='epoch'&&attempts===1){await db.collection('chat_states').updateOne({_id:'main' as never},{$set:{epoch:'00000000-0000-4000-8000-000000000001'},$inc:{revision:1}});await c.updateOne({_id:'main' as never},{$inc:{version:1}});}
    else if(mode==='forever'||mode==='recover'&&attempts<=3)await c.updateOne({_id:'main' as never},{$inc:{version:1}});
   }
   return (target.updateOne as any)(q,u,...args);
  };
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});}};
 const chat=createChatService(intercepted,{clerk});await chat.ready;
 const start=Date.now();let error:string|null=null,result:any=null;
 try{result=await chat.handle('alice',event,{v:1,...(event==='history'?{epoch,deviceId}:{})});}catch(e){error=(e as Error).message;}
 const elapsedMs=Date.now()-start;
 return {mode,attempts,clerkReads,error,result,elapsedMs};
}
test('identity read recovers from three unrelated economic writes',async()=>{
 const r=await scenario('recover');assert.equal(r.error,null);assert.equal(r.attempts,4);assert.equal(r.clerkReads,1);assert.deepEqual(r.result,{identity:null});
});
test('identity read has a finite retry budget under continuous contention',async()=>{
 const r=await scenario('forever');assert.equal(r.error,'stale_revision');assert.equal(r.attempts,8);assert.equal(r.clerkReads,0);assert.ok(r.elapsedMs<3000);
});
test('revocation during retry fails closed before fetching identity',async()=>{
 const r=await scenario('revoke');assert.equal(r.error,'forbidden');assert.equal(r.attempts,1);assert.equal(r.clerkReads,0);
});
test('epoch change during retry fails closed before fetching identity',async()=>{
 const r=await scenario('epoch');assert.equal(r.error,'stale_revision');assert.equal(r.attempts,1);assert.equal(r.clerkReads,0);
});
test('uncontended identity read needs one fence only',async()=>{
 const r=await scenario('none');assert.equal(r.error,null);assert.equal(r.attempts,1);
});

for(const mode of ['recover','forever','revoke','epoch','revision','none']){
 test('state read uses bounded authorization-preserving contention retry '+mode,async()=>{
  const r=await scenario(mode,'state');
  assert.equal(r.clerkReads,0);
  if(mode==='recover'){
   assert.equal(r.error,null);assert.equal(r.attempts,4);
   assert.equal(r.result.room,'main');assert.equal(r.result.members[0].userId,'alice');
  }else if(mode==='forever'){
   assert.equal(r.error,'stale_revision');assert.equal(r.attempts,8);assert.ok(r.elapsedMs<3000);
  }else if(mode==='revoke'){
   assert.equal(r.error,'forbidden');assert.equal(r.attempts,1);
  }else if(mode==='epoch'||mode==='revision'){
   assert.equal(r.error,'stale_revision');assert.equal(r.attempts,1);
  }else{assert.equal(r.error,null);assert.equal(r.attempts,1);}
 });
}

for(const mode of ['recover','forever','revoke','epoch','revision','none']){
 test('history read retries safely without exposing ciphertext after authorization/generation changes '+mode,async()=>{
  const r=await scenario(mode,'history');assert.equal(r.clerkReads,0);
  if(mode==='recover'||mode==='none'){
   assert.equal(r.error,null);assert.equal(r.attempts,mode==='recover'?4:1);
   assert.equal(r.result.messages[0].ciphertext,'private-fixture-ciphertext');
  }else{
   assert.equal(r.error,mode==='revoke'?'forbidden':'stale_revision');
   assert.equal(r.attempts,mode==='forever'?8:1);
   assert.equal(r.result,null,'no ciphertext response escapes a failed fence');
  }
 });
}
