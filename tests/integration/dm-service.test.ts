import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
import {createIdentity} from '../../lib/chat-crypto';
import {sealDm,openDm,dmSignedData as clientSignedData} from '../../lib/dm-crypto';
// @ts-expect-error runtime JS
import {createDmService,dmSignedData} from '../../runtime/dm-service.mjs';
if(!process.env.MONGODB_DB?.startsWith('fakebucks_test_'))throw Error('Isolated database required');
const client=new MongoClient(process.env.MONGODB_URI!),db=client.db(process.env.MONGODB_DB+'_dm');
after(async()=>{await db.dropDatabase();await client.close();});
test('immutable collision-safe usernames, real encrypted delivery, isolation, blocks, identity and replay',async()=>{
 let clock=Date.now();let count=0;
 const dm=createDmService(db,{now:()=>clock,generateUsername:()=>++count<=2?'abandon ability able about':count===3?'above absent absorb abstract':'absurd abuse access accident'});await dm.ready;
 const a=(await createIdentity('user_a',0)).identity,b=(await createIdentity('user_b',0)).identity,c=(await createIdentity('user_c',0)).identity;
 const members=['user_a','user_b','user_c'].map(id=>({id,approved:true}));
 await db.collection('rooms').insertOne({_id:'main' as never,version:1,members});
 for(const [user,d] of [['user_a',a],['user_b',b],['user_c',c]] as const){await db.collection('chat_identity_versions').insertOne({_id:user as never,status:'active',version:1});await db.collection('chat_devices').insertOne({userId:user,deviceId:d.deviceId,keyVersion:1,dhPublic:d.dhPublic,signPublic:d.signPublic});}
 const pa=await dm.handle('user_a','profile',{v:1}),pb=await dm.handle('user_b','profile',{v:1});assert.notEqual(pa.username,pb.username);assert.equal(pa.username.split(' ').length,4);assert.equal(await db.collection('dm_usernames').countDocuments(),3);
 const restarted=createDmService(db);await restarted.ready;assert.deepEqual(await restarted.handle('user_a','profile',{v:1}),pa);
 const lookup=await dm.handle('user_a','lookup',{v:1,username:pb.username});assert.equal(lookup.peer.userId,'user_b');assert.equal(JSON.stringify(lookup).includes('email'),false);
 assert.equal((await dm.handle('user_a','lookup',{v:1,username:pa.username})).peer,null);
 const p=await sealDm(a,'user_a',lookup.peer,'DM_PLAINTEXT_CANARY');
 assert.equal(dmSignedData('user_a',p),clientSignedData({sender:'user_a',to:p.toUserId,id:p.id,sdev:p.senderDeviceId,rdev:p.recipientDeviceId,skv:1,rkv:1,salt:p.salt},p.iv,p.ciphertext));
 const sent=await dm.handle('user_a','send',p);assert.equal(sent.duplicate,false);assert.deepEqual(await openDm(b,'user_b',sent.message),{ok:true,text:'DM_PLAINTEXT_CANARY',mine:false});assert.deepEqual(await openDm(a,'user_a',sent.message),{ok:true,text:'DM_PLAINTEXT_CANARY',mine:true});
 assert.equal((await dm.handle('user_a','send',p)).duplicate,true);
 assert.equal(await db.collection('dm_messages').countDocuments(),1);assert.equal(JSON.stringify(await db.collection('dm_messages').findOne({})).includes('DM_PLAINTEXT_CANARY'),false);
 const forged={...p,ciphertext:p.ciphertext.slice(0,-1)+(p.ciphertext.endsWith('A')?'B':'A')};await assert.rejects(dm.handle('user_a','send',forged));
 const conflict=await sealDm(a,'user_a',lookup.peer,'changed content',p.id);await assert.rejects(dm.handle('user_a','send',conflict),/conflict/);
 await assert.rejects(dm.handle('user_c','send',p),/identity_required/);
 for(const bad of [{salt:p.salt+'='},{iv:'A'},{ciphertext:'A'.repeat(6000)},{signature:p.signature+'='},{senderKeyVersion:0},{recipientDeviceId:'not-uuid'}])await assert.rejects(dm.handle('user_a','send',{...p,...bad}),/malformed/);
 await assert.rejects(dm.handle('user_a','send',{...p,toUserId:'user_c'}),/identity_required|invalid_signature/);

 assert.equal((await dm.handle('user_c','history',{v:1,userId:'user_b'})).messages.length,0);assert.equal((await dm.handle('user_b','history',{v:1,userId:'user_a'})).messages.length,1);
 assert.equal((await dm.handle('user_b','threads',{v:1})).threads[0].username,pa.username);
 await dm.handle('user_b','block',{v:1,userId:'user_a',blocked:true});await assert.rejects(dm.handle('user_a','send',p),/unavailable/);assert.equal((await dm.handle('user_a','history',{v:1,userId:'user_b'})).blocked,true);
 await dm.handle('user_a','block',{v:1,userId:'user_b',blocked:true});assert.equal((await dm.handle('user_b','block',{v:1,userId:'user_a',blocked:false})).blocked,true);await dm.handle('user_a','block',{v:1,userId:'user_b',blocked:false});
 for(let i=0;i<3;i++){clock++;await dm.handle('user_a','send',await sealDm(a,'user_a',lookup.peer,'page '+i));}
 const page=await dm.handle('user_b','history',{v:1,userId:'user_a',limit:2});assert.equal(page.messages.length,2);assert.ok(page.nextCursor);const next=await dm.handle('user_b','history',{v:1,userId:'user_a',limit:2,before:page.nextCursor});assert.equal(next.messages.length,2);assert.equal(next.nextCursor,null);assert.equal(new Set([...page.messages,...next.messages].map(m=>m.id)).size,4);
 await assert.rejects(dm.handle('user_a','send',{...p,plaintext:'oops'}),/malformed/);await assert.rejects(dm.handle('user_a','history',{v:1,userId:'user_b',limit:51}),/malformed/);await assert.rejects(dm.handle('user_a','history',{v:1,userId:'user_a'}),/unavailable/);await assert.rejects(dm.handle('user_a','lookup',{v:1,username:' Abandon ability able about'}),/malformed/);await assert.rejects(dm.handle('unknown','profile',{v:1}),/forbidden/);
 // Send-specific limiter trips independently of the general request allowance.
 clock+=60000;for(let i=0;i<30;i++)await dm.handle('user_a','send',p);
 await assert.rejects(dm.handle('user_a','send',p),/rate_limited/);clock+=60000;
 await db.collection('chat_identity_versions').updateOne({_id:'user_b' as never},{$set:{status:'pending'}});await assert.rejects(dm.handle('user_a','send',p),/identity_required/);assert.equal((await dm.handle('user_a','lookup',{v:1,username:pb.username})).peer,null);
 await db.collection('rooms').updateOne({_id:'main' as never},{$set:{'members.0.accessRevoked':true}});await assert.rejects(dm.handle('user_a','history',{v:1,userId:'user_b'}),/forbidden/);await assert.rejects(dm.handle('user_b','history',{v:1,userId:'user_a'}),/unavailable/);
});
test('strict canonical base64, per-user rate limits and bounded queue',async()=>{
 let clock=Date.now()+900000;const dm=createDmService(db,{now:()=>clock});await dm.ready;
 await db.collection('rooms').updateOne({_id:'main' as never},{$set:{members:[{id:'rate_user',approved:true}]}});
 for(let i=0;i<120;i++)await dm.handle('rate_user','profile',{v:1});await assert.rejects(dm.handle('rate_user','profile',{v:1}),/rate_limited/);
 clock+=60000;const results=await Promise.allSettled(Array.from({length:140},()=>dm.handle('rate_user','profile',{v:1})));assert.ok(results.some(r=>r.status==='rejected'&&r.reason.message==='busy'));
});
