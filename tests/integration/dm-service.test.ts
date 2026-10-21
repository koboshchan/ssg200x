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
 const dm=createDmService(db,{allowTestDevices:true,now:()=>clock,generateUsername:()=>++count<=2?'abandon ability able about':count===3?'above absent absorb abstract':'absurd abuse access accident'});await dm.ready;
 const a=(await createIdentity('user_a',0)).identity,b=(await createIdentity('user_b',0)).identity,c=(await createIdentity('user_c',0)).identity;
 const members=['user_a','user_b','user_c'].map(id=>({id,approved:true}));
 await db.collection('rooms').insertOne({_id:'main' as never,version:1,members});
 for(const [user,d] of [['user_a',a],['user_b',b],['user_c',c]] as const){await db.collection('chat_identity_versions').insertOne({_id:user as never,status:'active',version:1});await db.collection('chat_devices').insertOne({userId:user,deviceId:d.deviceId,keyVersion:1,dhPublic:d.dhPublic,signPublic:d.signPublic});}
 const pa=await dm.handle('user_a','profile',{v:1}),pb=await dm.handle('user_b','profile',{v:1});assert.notEqual(pa.username,pb.username);assert.equal(pa.username.split(' ').length,4);assert.equal(await db.collection('dm_usernames').countDocuments(),3);
 const restarted=createDmService(db,{allowTestDevices:true});await restarted.ready;assert.deepEqual(await restarted.handle('user_a','profile',{v:1}),pa);
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
 let clock=Date.now()+900000;const dm=createDmService(db,{allowTestDevices:true,now:()=>clock});await dm.ready;
 await db.collection('rooms').updateOne({_id:'main' as never},{$set:{members:[{id:'rate_user',approved:true}]}});
 for(let i=0;i<120;i++)await dm.handle('rate_user','profile',{v:1});await assert.rejects(dm.handle('rate_user','profile',{v:1}),/rate_limited/);
 clock+=60000;const results=await Promise.allSettled(Array.from({length:140},()=>dm.handle('rate_user','profile',{v:1})));assert.ok(results.some(r=>r.status==='rejected'&&r.reason.message==='busy'));
});

test('lookup triggers collision backfill and Mongo enforces unique handles, replay and block indexes',async()=>{
 await db.collection('dm_usernames').deleteMany({});
 await db.collection('rooms').updateOne({_id:'main' as never},{$set:{members:[{id:'lookup_a',approved:true},{id:'lookup_b',approved:true}]}});
 let calls=0;const dm=createDmService(db,{allowTestDevices:true,generateUsername:()=>++calls<=2?'abandon ability able about':'above absent absorb abstract'});await dm.ready;
 assert.deepEqual(await dm.handle('lookup_a','lookup',{v:1,username:'above absent absorb abstract'}),{peer:null});
 assert.equal(calls,3);assert.equal(await db.collection('dm_usernames').countDocuments(),2);
 await assert.rejects(db.collection('dm_usernames').insertOne({_id:'collision' as never,username:'abandon ability able about'}),{code:11000});
 for(const [collection,key,unique] of [['dm_usernames',{username:1},true],['dm_messages',{senderUserId:1,id:1},true],['dm_messages',{pair:1,cursor:-1},false],['dm_blocks',{owner:1,peer:1},true]] as const){
  const indexes=await db.collection(collection).indexes();assert.ok(indexes.some(i=>JSON.stringify(i.key)===JSON.stringify(key)&&!!i.unique===unique));
 }
});

test('send rechecks full active bundles, pointer revocation and membership after signature verification',async()=>{
 const a=(await createIdentity('race_a',0)).identity,b=(await createIdentity('race_b',0)).identity,changed=(await createIdentity('changed',0)).identity;
 await db.collection('rooms').updateOne({_id:'main' as never},{$set:{members:[{id:'race_a',approved:true},{id:'race_b',approved:true}]}});
 for(const [user,d] of [['race_a',a],['race_b',b]] as const){await db.collection('chat_identity_versions').insertOne({_id:user as never,status:'active',version:1});await db.collection('chat_devices').insertOne({userId:user,deviceId:d.deviceId,keyVersion:1,dhPublic:d.dhPublic,signPublic:d.signPublic});}
 const peer={userId:'race_b',...b},wire=await sealDm(a,'race_a',peer,'race secret');
 // A Mongo adapter hook deterministically changes state after signature verification,
 // at the duplicate lookup, without mocking crypto or exposing a production test hook.
 let mutate:undefined|(()=>Promise<unknown>);
 const wrapped={collection:(name:string)=>{
  const col=db.collection(name);
  if(name!=='dm_messages')return col;
  return new Proxy(col,{get(target,key){
   if(key==='findOne')return async(...args:any[])=>{const result=await (target.findOne as any)(...args);if(mutate){const fn=mutate;mutate=undefined;await fn();}return result;};
   const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
 }};
 const dm=createDmService(wrapped,{allowTestDevices:true});await dm.ready;
 for(const [user,key] of [['race_a','dhPublic'],['race_a','signPublic'],['race_b','dhPublic'],['race_b','signPublic']] as const){
  const original=user==='race_a'?a:b;
  mutate=()=>db.collection('chat_devices').updateOne({userId:user},{$set:{[key]:changed[key]}});
  await assert.rejects(dm.handle('race_a','send',wire),/identity_conflict/);
  await db.collection('chat_devices').updateOne({userId:user},{$set:{[key]:original[key]}});
 }
 for(const user of ['race_a','race_b']){
  mutate=()=>db.collection('chat_identity_versions').updateOne({_id:user as never},{$set:{status:'revoked'}});
  await assert.rejects(dm.handle('race_a','send',wire),/identity_required/);
  await db.collection('chat_identity_versions').updateOne({_id:user as never},{$set:{status:'active'}});
 }
 for(const index of [0,1]){
  mutate=()=>db.collection('rooms').updateOne({_id:'main' as never},{$set:{['members.'+index+'.approved']:false}});
  await assert.rejects(dm.handle('race_a','send',wire),index===0?/forbidden/:/unavailable/);
  await db.collection('rooms').updateOne({_id:'main' as never},{$set:{['members.'+index+'.approved']:true}});
 }
 assert.equal(await db.collection('dm_messages').countDocuments({senderUserId:'race_a'}),0);
 const [block,send]=await Promise.allSettled([dm.handle('race_b','block',{v:1,userId:'race_a',blocked:true}),dm.handle('race_a','send',wire)]);
 assert.equal(block.status,'fulfilled');assert.equal(send.status,'rejected');
 await dm.handle('race_b','block',{v:1,userId:'race_a',blocked:false});
 const [sent,blocked]=await Promise.all([dm.handle('race_a','send',wire),dm.handle('race_b','block',{v:1,userId:'race_a',blocked:true})]);
 assert.equal(sent.duplicate,false);assert.equal(blocked.blocked,true);await assert.rejects(dm.handle('race_a','send',wire),/unavailable/);
 await dm.handle('race_b','block',{v:1,userId:'race_a',blocked:false});
 mutate=()=>db.collection('chat_devices').updateOne({userId:'race_b'},{$set:{dhPublic:changed.dhPublic}});
 await assert.rejects(dm.handle('race_a','send',wire),/identity_conflict/);
 assert.equal(await db.collection('dm_messages').countDocuments({senderUserId:'race_a'}),1);
});

test('Clerk committed slot supports DMs before chat registration and fences pointer changes',async()=>{
 const a=(await createIdentity('clerk_a',0)).identity,b=(await createIdentity('clerk_b',0)).identity;
 await db.collection('rooms').updateOne({_id:'main' as never},{$set:{members:[{id:'clerk_a',approved:true},{id:'clerk_b',approved:true}]}});
 const accounts=new Map<string,any>();
 for(const [user,d] of [['clerk_a',a],['clerk_b',b]] as const){
  await db.collection('chat_identity_versions').insertOne({_id:user as never,status:'active',version:1,slot:'committed',committedHash:'original'});
  accounts.set(user,{publicMetadata:{tabletalk:{committed:{v:1,keyVersion:1,deviceId:d.deviceId,dhPublic:d.dhPublic,signPublic:d.signPublic}}}});
 }
 assert.equal(await db.collection('chat_devices').countDocuments({userId:{$in:['clerk_a','clerk_b']}}),0);
 let mutate:undefined|(()=>Promise<unknown>);
 const clerk={users:{getUser:async(user:string)=>{
  const result=structuredClone(accounts.get(user));
  if(mutate){const fn=mutate;mutate=undefined;await fn();}
  return result;
 }}};
 const dm=createDmService(db,{clerk});await dm.ready;
 const profile=await dm.handle('clerk_b','profile',{v:1});
 const lookup=await dm.handle('clerk_a','lookup',{v:1,username:profile.username});
 assert.equal(lookup.peer.deviceId,b.deviceId);
 const wire=await sealDm(a,'clerk_a',lookup.peer,'no chat registration needed');
 const sent=await dm.handle('clerk_a','send',wire);
 assert.deepEqual(await openDm(b,'clerk_b',sent.message),{ok:true,text:'no chat registration needed',mine:false});
 // A cached chat registration must not override the committed Clerk slot.
 await db.collection('chat_devices').insertOne({userId:'clerk_b',deviceId:a.deviceId,keyVersion:1,dhPublic:a.dhPublic,signPublic:a.signPublic});
 assert.equal((await dm.handle('clerk_a','lookup',{v:1,username:profile.username})).peer.deviceId,b.deviceId);
 const noClerk=createDmService(db);await noClerk.ready;
 assert.equal((await noClerk.handle('clerk_a','lookup',{v:1,username:profile.username})).peer,null);
 await assert.rejects(noClerk.handle('clerk_a','send',wire),/identity_required/);
 const failing=createDmService(db,{clerk:{users:{getUser:async()=>{throw Error('offline');}}},allowTestDevices:true});await failing.ready;
 assert.equal((await failing.handle('clerk_a','lookup',{v:1,username:profile.username})).peer,null);
 const pub=accounts.get('clerk_b').publicMetadata.tabletalk.committed;
 for(const change of [{keyVersion:2},{deviceId:'bad'},{dhPublic:'bad'},{signPublic:pub.dhPublic}]){
  accounts.get('clerk_b').publicMetadata.tabletalk.committed={...pub,...change};
  assert.equal((await dm.handle('clerk_a','lookup',{v:1,username:profile.username})).peer,null);
 }
 accounts.get('clerk_b').publicMetadata.tabletalk={wrong:pub};
 assert.equal((await dm.handle('clerk_a','lookup',{v:1,username:profile.username})).peer,null);
 accounts.get('clerk_b').publicMetadata.tabletalk={committed:pub};
 for(const change of [{status:'revoked'},{slot:'wrong'},{version:2},{committedHash:'changed'}]){
  mutate=()=>db.collection('chat_identity_versions').updateOne({_id:'clerk_b' as never},{$set:change});
  assert.equal((await dm.handle('clerk_a','lookup',{v:1,username:profile.username})).peer,null);
  await db.collection('chat_identity_versions').updateOne({_id:'clerk_b' as never},{$set:{status:'active',slot:'committed',version:1,committedHash:'original'}});
 }
 assert.equal((await dm.handle('clerk_a','send',wire)).duplicate,true);
});

test('authoritative display names are presentation only, email-safe and membership scoped',async()=>{
 const a=(await createIdentity('name_a',0)).identity,b=(await createIdentity('name_b',0)).identity;
 await db.collection('rooms').updateOne({_id:'main' as never},{$set:{members:[{id:'name_a',approved:true,name:'CLIENT FORGERY'},{id:'name_b',approved:true,name:'CLIENT FORGERY'}]}});
 const accounts=new Map<string,any>();
 for(const [user,d] of [['name_a',a],['name_b',b]] as const){
  await db.collection('chat_identity_versions').insertOne({_id:user as never,status:'active',version:1,slot:'names',committedHash:'names'});
  accounts.set(user,{firstName:user==='name_a'?'Alice':'Bob',lastName:'Example',username:'public-name',
   emailAddresses:[{emailAddress:'PRIVATE_CANARY@example.com'}],primaryEmailAddress:{emailAddress:'PRIVATE_CANARY@example.com'},
   publicMetadata:{tabletalk:{names:{v:1,keyVersion:1,deviceId:d.deviceId,dhPublic:d.dhPublic,signPublic:d.signPublic}}}});
 }
 const reads:string[]=[];
 const make=()=>createDmService(db,{clerk:{users:{getUser:async(id:string)=>{reads.push(id);return structuredClone(accounts.get(id));}}}});
 const dm=make();await dm.ready;
 const pa=await dm.handle('name_a','profile',{v:1}),pb=await dm.handle('name_b','profile',{v:1});
 assert.deepEqual(Object.keys(pa),['username']);
 const lookup=await dm.handle('name_a','lookup',{v:1,username:pb.username});
 assert.equal(lookup.peer.displayName,'Bob Example');assert.equal(lookup.peer.username,pb.username);
 const wire=await sealDm(a,'name_a',lookup.peer,'presentation must not change encryption');
 assert.equal('displayName' in wire,false);
 const sent=await dm.handle('name_a','send',wire);
 assert.deepEqual(await openDm(b,'name_b',sent.message),{ok:true,text:'presentation must not change encryption',mine:false});
 assert.equal('displayName' in sent.message,false);
 const threads=await dm.handle('name_b','threads',{v:1});
 assert.equal(threads.threads[0].displayName,'Alice Example');assert.equal(threads.threads[0].username,pa.username);
 for(const dto of [lookup,threads,sent])assert.doesNotMatch(JSON.stringify(dto),/PRIVATE_CANARY|emailAddress|CLIENT FORGERY/);
 assert.ok(reads.every(id=>id==='name_a'||id==='name_b'));
 // Email-shaped fields are rejected by the shared public name resolver; no private email fallback.
 accounts.get('name_b').firstName='private@example.com';accounts.get('name_b').lastName='';accounts.get('name_b').username='private@example.com';
 const safe=make();await safe.ready;
 assert.equal((await safe.handle('name_a','lookup',{v:1,username:pb.username})).peer.displayName,pb.username);
 accounts.get('name_b').firstName='';accounts.get('name_b').username='BobPublic';
 const usernameFallback=make();await usernameFallback.ready;
 assert.equal((await usernameFallback.handle('name_a','lookup',{v:1,username:pb.username})).peer.displayName,'BobPublic');
 const before=reads.length;
 assert.equal((await dm.handle('name_a','lookup',{v:1,username:'zoo zoo zoo zoo'})).peer,null);
 await assert.rejects(dm.handle('outsider','threads',{v:1}),/forbidden/);
 assert.equal(reads.length,before);
 await db.collection('rooms').updateOne({_id:'main' as never},{$set:{'members.1.accessRevoked':true}});
 assert.deepEqual((await dm.handle('name_a','threads',{v:1})).threads,[]);
});
