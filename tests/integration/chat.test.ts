import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
import {webcrypto,randomUUID} from 'node:crypto';
// @ts-expect-error runtime module
import {createChatService} from '../../runtime/chat-service.mjs';
// @ts-expect-error runtime module
import {registerData,signedWrap,wrapHeader,signedMessage,messageHeader} from '../../runtime/chat-protocol.mjs';
if(!process.env.MONGODB_DB?.startsWith('fakebucks_test_'))throw Error('Isolated database required');
const client=new MongoClient(process.env.MONGODB_URI!),db=client.db(process.env.MONGODB_DB+'_chat');
after(async()=>{await db.dropDatabase();await client.close();});
const b64=(b:ArrayBuffer|Uint8Array)=>Buffer.from(b as Uint8Array).toString('base64url');
const bytes=(s:string)=>new TextEncoder().encode(s);
const rand=(n:number)=>b64(webcrypto.getRandomValues(new Uint8Array(n)));
async function identity(user:string){
 const sign=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
 const dh=await webcrypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},false,['deriveBits']);
 const deviceId=randomUUID(),signPublic=b64(await webcrypto.subtle.exportKey('raw',sign.publicKey)),dhPublic=b64(await webcrypto.subtle.exportKey('raw',dh.publicKey));
 const signature=async(data:string)=>b64(await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},sign.privateKey,bytes(data)));
 const registration={v:1,deviceId,signPublic,dhPublic,signature:''};registration.signature=await signature(registerData(user,registration));
 return {user,sign,dh,deviceId,signature,registration};
}
test('real Mongo stores ciphertext only, bootstrap leases, wrapping, replay, strict auth and membership removal',async()=>{
 let clock=Date.now();const chat=createChatService(db,{now:()=>clock});await chat.ready;
 await db.collection('rooms').insertOne({_id:'main' as never,version:1,members:[{id:'user_a',approved:true},{id:'user_b',approved:true}]});
 const a=await identity('user_a'),b=await identity('user_b');
 await chat.handle(a.user,'register',a.registration);await chat.handle(b.user,'register',b.registration);
 await assert.rejects(chat.handle('intruder','state',{v:1}),/forbidden/);
 await assert.rejects(chat.handle(b.user,'register',a.registration));
 let state=await chat.handle(a.user,'state',{v:1});
 const claim=()=>({v:1,revision:state.revision,epoch:state.epoch,deviceId:a.deviceId});
 state=await chat.handle(a.user,'claim',claim());assert.equal(state.owner.userId,a.user);
 await assert.rejects(chat.handle(b.user,'claim',{...claim(),deviceId:b.deviceId}),/waiting/);
 clock+=31000;const oldEpoch=state.epoch;
 state=await chat.handle(b.user,'claim',{...claim(),deviceId:b.deviceId});assert.notEqual(state.epoch,oldEpoch);
 await assert.rejects(chat.handle(a.user,'claim',{...claim(),epoch:oldEpoch}),/stale_revision/);
 const raw=webcrypto.getRandomValues(new Uint8Array(32));
 const roomkey=await webcrypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
 async function wrap(from:typeof a,to:typeof a){
  const p={v:1,room:'main',revision:state.revision,epoch:state.epoch,deviceId:from.deviceId,toUserId:to.user,toDeviceId:to.deviceId,salt:rand(32),iv:rand(12),ciphertext:'',signature:''};
  const shared=await webcrypto.subtle.deriveBits({name:'ECDH',public:to.dh.publicKey},from.dh.privateKey,256);
  const material=await webcrypto.subtle.importKey('raw',shared,'HKDF',false,['deriveKey']);
  const key=await webcrypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:Buffer.from(p.salt,'base64url'),info:bytes(JSON.stringify(wrapHeader(from.user,p)))},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const additionalData=bytes(JSON.stringify([...wrapHeader(from.user,p),p.salt]));
  p.ciphertext=b64(await webcrypto.subtle.encrypt({name:'AES-GCM',iv:Buffer.from(p.iv,'base64url'),additionalData},key,raw));p.signature=await from.signature(signedWrap(from.user,p));return p;
 }
 const self=await wrap(b,b);await chat.handle(b.user,'wrap',self);await chat.handle(b.user,'wrap',self);
 // Simulate crash after durable self-wrap insert but before epoch activation.
 await db.collection('chat_states').updateOne({_id:'main' as never},{$set:{status:'claimed',leaseUntil:clock-1}});
 await chat.handle(b.user,'wrap',self);
 state=await chat.handle(b.user,'state',{v:1});assert.equal(state.status,'active');
 const control=await db.collection('chat_states').findOne({_id:'main' as never});assert.equal(control!.bootstrap.ciphertext,self.ciphertext);
 assert.equal(await db.collection('chat_wraps').countDocuments({epoch:state.epoch,toUserId:b.user}),0);
 await db.collection('rooms').updateOne({_id:'main' as never},{$set:{chatMutationLock:{token:'crashed-owner'}}});
 await chat.handle(a.user,'state',{v:1}); // Orphaned legacy chat locks cannot gate operations.
 await db.collection('rooms').updateOne({_id:'main' as never},{$unset:{chatMutationLock:''}});
 clock+=31000;await assert.rejects(chat.handle(a.user,'claim',claim()),/waiting/);
 const ba=await wrap(b,a);await chat.handle(b.user,'wrap',ba);
 // Actual recipient ECDH/HKDF/AES-GCM roundtrip, not a mocked ciphertext fixture.
 const bits=await webcrypto.subtle.deriveBits({name:'ECDH',public:b.dh.publicKey},a.dh.privateKey,256);
 const material=await webcrypto.subtle.importKey('raw',bits,'HKDF',false,['deriveKey']);
 const unwrap=await webcrypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:Buffer.from(ba.salt,'base64url'),info:bytes(JSON.stringify(wrapHeader(b.user,ba)))},material,{name:'AES-GCM',length:256},false,['decrypt']);
 assert.deepEqual(new Uint8Array(await webcrypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(ba.iv,'base64url'),additionalData:bytes(JSON.stringify([...wrapHeader(b.user,ba),ba.salt]))},unwrap,Buffer.from(ba.ciphertext,'base64url'))),raw);
 const secret='PLAINTEXT_CANARY_TABLETALK_68398';
 const p={v:1,room:'main',revision:state.revision,epoch:state.epoch,deviceId:a.deviceId,id:randomUUID(),ts:clock,iv:rand(12),ciphertext:'',signature:''};
 p.ciphertext=b64(await webcrypto.subtle.encrypt({name:'AES-GCM',iv:Buffer.from(p.iv,'base64url'),additionalData:bytes(JSON.stringify(messageHeader(a.user,p)))},roomkey,bytes(secret)));p.signature=await a.signature(signedMessage(a.user,p));
 let resumeInsert!:()=>void, reachedInsert!:()=>void;
 const reached=new Promise<void>(r=>{reachedInsert=r;}), resume=new Promise<void>(r=>{resumeInsert=r;});
 const intercepted={collection:(name:string)=>{const c=db.collection(name);return new Proxy(c,{get(target,key){if(name==='chat_messages'&&key==='insertOne')return async(...args:any[])=>{reachedInsert();await resume;return (target.insertOne as any)(...args);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});}};
 const concurrent=createChatService(intercepted,{now:()=>clock});
 const pendingSend=concurrent.handle(a.user,'send',p);await reached;
 const roomAtCutover=await db.collection('rooms').findOne({_id:'main' as never});
 // Removal after the authorization CAS is ordered after this in-flight send.
 const blockedRemoval=await db.collection('rooms').updateOne({_id:'main' as never,version:roomAtCutover!.version},{$set:{members:[{id:a.user,approved:true}]},$inc:{version:1}});
 assert.equal(blockedRemoval.matchedCount,1);
 await db.collection('rooms').updateOne({_id:'main' as never},{$set:{members:[{id:a.user,approved:true},{id:b.user,approved:true}]},$inc:{version:1}});
 resumeInsert();const result=await pendingSend;
 assert.equal((await db.collection('rooms').findOne({_id:'main' as never}))!.chatMutationLock,undefined);
 assert.equal(result.duplicate,false);assert.equal((await chat.handle(a.user,'send',p)).duplicate,true);
 await assert.rejects(chat.handle(a.user,'send',{...p,plaintext:secret}),/malformed/);
 await assert.rejects(chat.handle(b.user,'send',p));
 await assert.rejects(chat.handle(a.user,'send',{...p,revision:0}),/stale_revision/);
 const changed={...p,iv:rand(12)};changed.signature=await a.signature(signedMessage(a.user,changed));await assert.rejects(chat.handle(a.user,'send',changed),/conflict/);
 const page=await chat.handle(a.user,'history',{v:1,epoch:state.epoch,deviceId:a.deviceId,limit:1});assert.equal(page.messages.length,1);
 await assert.rejects(chat.handle(a.user,'history',{v:1,epoch:state.epoch,deviceId:a.deviceId,limit:999}),/malformed/);
 for(const name of ['chat_states','chat_devices','chat_wraps','chat_messages','chat_rates']){
  const docs=await db.collection(name).find().toArray();const dump=JSON.stringify(docs);assert.equal(dump.includes(secret),false);assert.equal(dump.includes(b64(raw)),false);
 }
 assert.equal(await db.collection('chat_messages').countDocuments(),1);
 await db.collection('rooms').updateOne({_id:'main' as never},{$set:{members:[{id:a.user,approved:true},{id:b.user,approved:true},{id:'user_c',approved:true}]},$inc:{version:1}});
 const added=await chat.handle(a.user,'state',{v:1});assert.equal(added.epoch,state.epoch);assert.ok(added.revision>state.revision);
 assert.equal((await chat.handle(a.user,'history',{v:1,epoch:state.epoch,deviceId:a.deviceId})).messages.length,1);

 await db.collection('rooms').updateOne({_id:'main' as never},{$set:{members:[{id:a.user,approved:true}]},$inc:{version:1}});
 await assert.rejects(chat.handle(b.user,'state',{v:1}),/forbidden/);
 await assert.rejects(chat.handle(b.user,'wrap',ba),/forbidden/);
 await assert.rejects(chat.handle(a.user,'send',p),/stale_revision/);
 const fresh=await chat.handle(a.user,'state',{v:1});assert.notEqual(fresh.epoch,state.epoch);assert.ok(fresh.revision>state.revision);assert.ok(fresh.wraps.some((w:any)=>w.epoch===state.epoch));
 const retainedSender=fresh.wraps.find((w:any)=>w.epoch===state.epoch);assert.equal(retainedSender.senderDhPublic,b.registration.dhPublic);assert.equal(retainedSender.senderSignPublic,b.registration.signPublic);
 // Restored browser carries same account key ID and reads retained older epoch.
 const restored=createChatService(db,{now:()=>clock});
 assert.equal((await restored.handle(a.user,'history',{v:1,epoch:state.epoch,deviceId:a.deviceId})).messages.length,1);
 assert.ok(await db.collection('chat_wraps').findOne({epoch:state.epoch,toUserId:b.user}));
 // Account key reset must not rotate the shared room key.
 const replacement=await identity(a.user);await db.collection('chat_devices').deleteMany({userId:a.user});
 await restored.handle(a.user,'register',replacement.registration);
 const resetState=await restored.handle(a.user,'state',{v:1});assert.equal(resetState.epoch,fresh.epoch);
 await assert.rejects(restored.handle(a.user,'history',{v:1,epoch:state.epoch,deviceId:replacement.deviceId}),/waiting/);
 await assert.rejects(chat.handle(a.user,'send',{...p,revision:resetState.revision,epoch:fresh.epoch,deviceId:replacement.deviceId}),/waiting/);
 for(let i=0;i<120;i++){try{await chat.handle(a.user,'state',{v:1});}catch{}}
 await assert.rejects(chat.handle(a.user,'state',{v:1}),/rate_limited/);
});

test('account Clerk backup endpoints preserve metadata, validate bounds, own DTO and CAS reset version',async()=>{
 // @ts-expect-error runtime module
 const {createIdentityStore}=await import('../../runtime/chat-identity.mjs');
 const profiles:any={user_a:{publicMetadata:{other:'keep'},privateMetadata:{admin:true,other:'private'}},user_b:{publicMetadata:{},privateMetadata:{secret:'never return'}}};
 let ambiguous=false,failBefore=false;
 const clerk={users:{getUser:async(u:string)=>structuredClone(profiles[u]),updateUserMetadata:async(u:string,p:any)=>{
  if(failBefore){failBefore=false;throw Error('failed before Clerk write');}
  for(const field of ['publicMetadata','privateMetadata'])profiles[u][field]={...profiles[u][field],tabletalk:{...profiles[u][field].tabletalk,...p[field].tabletalk}};
  if(ambiguous){ambiguous=false;throw Error('ambiguous write');}return profiles[u];
 }}};
 const store=createIdentityStore(db,clerk),a=await identity('user_a');
 const p={v:1,expectedVersion:0,keyVersion:1,deviceId:a.deviceId,dhPublic:a.registration.dhPublic,signPublic:a.registration.signPublic,backup:{v:1,recoveryScheme:'bip39-english-6-v1',kdf:'argon2id',memoryKiB:65536,iterations:3,parallelism:1,salt:rand(32),iv:rand(12),ciphertext:rand(256)},signature:''};
 p.signature=await a.signature(store.signed(a.user,p));
 assert.deepEqual(await store.get('user_b'),{identity:null});
 await assert.rejects(store.put(a.user,{...p,recoveryPhrase:'never accept secret'}),/malformed/);
 await assert.rejects(store.put(a.user,{...p,backup:{...p.backup,memoryKiB:9999999}}),/invalid_kdf/);
 await assert.rejects(store.put(a.user,{...p,backup:{...p.backup,recoveryScheme:'eff-large-6-v1'}}),/invalid_kdf/);
 ambiguous=true;await assert.rejects(store.put(a.user,p),/identity_unavailable/);
 const recovered=await store.get(a.user);assert.equal(recovered.identity.keyVersion,1);
 const result=await store.put(a.user,p);assert.deepEqual(result,recovered);
 assert.equal(profiles.user_a.privateMetadata.admin,true);assert.equal(profiles.user_a.privateMetadata.other,'private');assert.equal(profiles.user_a.publicMetadata.other,'keep');
 assert.equal(JSON.stringify(result).includes('admin'),false);assert.equal(JSON.stringify(result).includes('private'),false);
 assert.deepEqual(await store.put(a.user,p),result);
 const reused={...p,expectedVersion:1,keyVersion:2};reused.signature=await a.signature(store.signed(a.user,reused));
 await assert.rejects(store.put(a.user,reused),/identity_conflict/);
 const replacement=await identity(a.user);
 const next={...p,deviceId:replacement.deviceId,dhPublic:replacement.registration.dhPublic,signPublic:replacement.registration.signPublic,expectedVersion:1,keyVersion:2};next.signature=await replacement.signature(store.signed(a.user,next));
 const results=await Promise.allSettled([store.put(a.user,next),store.put(a.user,next)]);assert.ok(results.some(x=>x.status==='fulfilled'));
 assert.equal((await store.put(a.user,next)).identity.keyVersion,2);
 assert.equal((await store.get(a.user)).identity.keyVersion,2);
 const b=await identity('user_b'),lost={...p,deviceId:b.deviceId,dhPublic:b.registration.dhPublic,signPublic:b.registration.signPublic};
 lost.signature=await b.signature(store.signed(b.user,lost));
 failBefore=true;await assert.rejects(store.put(b.user,lost),/identity_unavailable/);
 assert.equal((await store.get(b.user)).identity.deviceId,b.deviceId); // No original request needed.
 assert.equal((await store.put(b.user,lost)).identity.deviceId,b.deviceId);
});

test('committed bootstrap response loss survives addition; real account reset excludes old self grant without rotating',async()=>{
 const isolated=client.db(process.env.MONGODB_DB+'_identity_flow');
 try{
 const profiles:any={};
 const clerk={users:{getUser:async(u:string)=>structuredClone(profiles[u]||{publicMetadata:{},privateMetadata:{}}),updateUserMetadata:async(u:string,p:any)=>{
  const old=profiles[u]||{publicMetadata:{},privateMetadata:{}};
  for(const field of ['publicMetadata','privateMetadata'])old[field]={...old[field],tabletalk:{...old[field].tabletalk,...p[field].tabletalk}};
  profiles[u]=old;return structuredClone(old);
 }}};
 // @ts-expect-error runtime module
 const {createIdentityStore}=await import('../../runtime/chat-identity.mjs');
 const identities=createIdentityStore(isolated,clerk),chat=createChatService(isolated,{clerk});await chat.ready;
 await isolated.collection('rooms').insertOne({_id:'main' as never,version:0,members:[{id:'owner',approved:true}]});
 async function publish(who:Awaited<ReturnType<typeof identity>>,version:number){
  const p={v:1,expectedVersion:version,keyVersion:version+1,deviceId:who.deviceId,dhPublic:who.registration.dhPublic,signPublic:who.registration.signPublic,backup:{v:1,recoveryScheme:'bip39-english-6-v1',kdf:'argon2id',memoryKiB:65536,iterations:3,parallelism:1,salt:rand(32),iv:rand(12),ciphertext:rand(256)},signature:''};
  p.signature=await who.signature(identities.signed(who.user,p));
  const result=await chat.handle(who.user,'keys:put',p);
  assert.deepEqual(await chat.handle(who.user,'keys:put',p),result);
  assert.equal(await isolated.collection('chat_devices').countDocuments({userId:who.user}),1);
  return result;
 }
 const owner=await identity('owner');await publish(owner,0);
 const published=await isolated.collection('chat_states').findOne({_id:'main' as never});
 const unchanged=await chat.handle(owner.user,'keys:get',{v:1});
 assert.equal(unchanged.directoryChanged,undefined);
 assert.equal((await isolated.collection('chat_states').findOne({_id:'main' as never}))!.revision,published!.revision);
 // Simulate lost directory publication after the account pointer committed.
 await isolated.collection('chat_devices').deleteMany({userId:owner.user});
 await chat.handle(owner.user,'state',{v:1});
 const missing=await isolated.collection('chat_states').findOne({_id:'main' as never});
 assert.equal((await chat.handle(owner.user,'keys:get',{v:1})).directoryChanged,true);
 const repaired=await isolated.collection('chat_states').findOne({_id:'main' as never});
 assert.equal(repaired!.revision,missing!.revision+1);
 assert.equal((await chat.handle(owner.user,'keys:get',{v:1})).directoryChanged,undefined);
 assert.equal((await isolated.collection('chat_states').findOne({_id:'main' as never}))!.revision,repaired!.revision);

 let state=await chat.handle(owner.user,'state',{v:1});
 state=await chat.handle(owner.user,'claim',{v:1,revision:state.revision,epoch:state.epoch,deviceId:owner.deviceId});
 const self={v:1,room:'main',revision:state.revision,epoch:state.epoch,deviceId:owner.deviceId,toUserId:owner.user,toDeviceId:owner.deviceId,salt:rand(32),iv:rand(12),ciphertext:rand(48),signature:''};
 self.signature=await owner.signature(signedWrap(owner.user,self));
 await chat.handle(owner.user,'wrap',self); // Response deliberately discarded after commit.
 await isolated.collection('rooms').updateOne({_id:'main' as never},{$push:{members:{id:'added',approved:true}} as never,$inc:{version:1}});
 const added=await identity('added');await publish(added,0);
 await assert.rejects(chat.handle(owner.user,'wrap',self),/stale_revision/);
 const restored=await chat.handle(owner.user,'state',{v:1});
 assert.equal(restored.status,'active');assert.equal(restored.epoch,state.epoch);
 assert.ok(restored.wraps.some((w:any)=>w.ciphertext===self.ciphertext));
 const replacement=await identity(owner.user);await publish(replacement,1);
 const reset=await chat.handle(owner.user,'state',{v:1});
 assert.equal(reset.epoch,state.epoch);assert.ok(reset.revision>restored.revision);
 assert.equal(reset.wraps.length,0);
 await assert.rejects(chat.handle(owner.user,'history',{v:1,epoch:state.epoch,deviceId:replacement.deviceId}),/waiting/);
 // Removal and explicit re-admission before the next snapshot still fences the epoch.
 await isolated.collection('rooms').updateOne({_id:'main' as never},{$inc:{version:1,chatRemovalVersion:1}});
 assert.notEqual((await chat.handle(owner.user,'state',{v:1})).epoch,state.epoch);
 // Retrieval pagination, not cryptographic validity of synthetic historical rows.
 await isolated.collection('chat_wraps').insertMany(Array.from({length:513},(_,i)=>({...self,_id:i.toString(16).padStart(64,'0') as never,senderUserId:owner.user,toDeviceId:replacement.deviceId,epoch:randomUUID(),senderDhPublic:owner.registration.dhPublic,senderSignPublic:owner.registration.signPublic})));
 const first=await chat.handle(owner.user,'state',{v:1});assert.equal(first.wraps.length,512);assert.ok(first.nextWrapCursor);
 const second=await chat.handle(owner.user,'state',{v:1,beforeWrap:first.nextWrapCursor});assert.equal(second.wraps.length,1);assert.equal(second.nextWrapCursor,null);
 }finally{await isolated.dropDatabase();}
});
