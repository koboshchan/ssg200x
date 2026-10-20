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
 const result=await chat.handle(a.user,'send',p);assert.equal(result.duplicate,false);assert.equal((await chat.handle(a.user,'send',p)).duplicate,true);
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
 await db.collection('rooms').updateOne({_id:'main' as never},{$set:{members:[{id:a.user,approved:true}]},$inc:{version:1}});
 await assert.rejects(chat.handle(b.user,'state',{v:1}),/forbidden/);
 await assert.rejects(chat.handle(b.user,'wrap',ba),/forbidden/);
 await assert.rejects(chat.handle(a.user,'send',p),/stale_revision/);
 const fresh=await chat.handle(a.user,'state',{v:1});assert.notEqual(fresh.epoch,state.epoch);assert.ok(fresh.revision>state.revision);assert.equal(fresh.wraps.length,0);
 await assert.rejects(chat.handle(a.user,'send',{...p,revision:fresh.revision,epoch:fresh.epoch}),/waiting/);
 for(let i=0;i<120;i++){try{await chat.handle(a.user,'state',{v:1});}catch{}}
 await assert.rejects(chat.handle(a.user,'state',{v:1}),/rate_limited/);
});

test('account Clerk backup endpoints preserve metadata, validate bounds, own DTO and CAS reset version',async()=>{
 // @ts-expect-error runtime module
 const {createIdentityStore}=await import('../../runtime/chat-identity.mjs');
 const profiles:any={user_a:{publicMetadata:{other:'keep'},privateMetadata:{admin:true,other:'private'}},user_b:{publicMetadata:{},privateMetadata:{secret:'never return'}}};
 let ambiguous=false;
 const clerk={users:{getUser:async(u:string)=>structuredClone(profiles[u]),updateUserMetadata:async(u:string,p:any)=>{
  for(const field of ['publicMetadata','privateMetadata'])profiles[u][field]={...profiles[u][field],tabletalk:{...profiles[u][field].tabletalk,...p[field].tabletalk}};
  if(ambiguous){ambiguous=false;throw Error('ambiguous write');}return profiles[u];
 }}};
 const store=createIdentityStore(db,clerk),a=await identity('user_a');
 const p={v:1,expectedVersion:0,keyVersion:1,deviceId:a.deviceId,dhPublic:a.registration.dhPublic,signPublic:a.registration.signPublic,backup:{v:1,kdf:'argon2id',memoryKiB:65536,iterations:3,parallelism:1,salt:rand(32),iv:rand(12),ciphertext:rand(256)},signature:''};
 p.signature=await a.signature(store.signed(a.user,p));
 assert.deepEqual(await store.get('user_b'),{identity:null});
 await assert.rejects(store.put(a.user,{...p,pin:'123456'}),/malformed/);
 await assert.rejects(store.put(a.user,{...p,backup:{...p.backup,memoryKiB:9999999}}),/invalid_kdf/);
 ambiguous=true;await assert.rejects(store.put(a.user,p),/identity_unavailable/);
 const result=await store.put(a.user,p);assert.equal(result.identity.keyVersion,1);
 assert.equal(profiles.user_a.privateMetadata.admin,true);assert.equal(profiles.user_a.privateMetadata.other,'private');assert.equal(profiles.user_a.publicMetadata.other,'keep');
 assert.equal(JSON.stringify(result).includes('admin'),false);assert.equal(JSON.stringify(result).includes('private'),false);
 await assert.rejects(store.put(a.user,p),/identity_conflict/);
 const next={...p,expectedVersion:1,keyVersion:2};next.signature=await a.signature(store.signed(a.user,next));
 const results=await Promise.allSettled([store.put(a.user,next),store.put(a.user,next)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 assert.equal((await store.get(a.user)).identity.keyVersion,2);
});
