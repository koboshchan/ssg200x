import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
import {createIdentity} from '../../lib/chat-crypto';
import {sealDm} from '../../lib/dm-crypto';
// @ts-expect-error runtime JS
import {createChatService} from '../../runtime/chat-service.mjs';
// @ts-expect-error runtime JS
import {createDmService} from '../../runtime/dm-service.mjs';
// @ts-expect-error runtime JS
import {createChatDmGate} from '../../runtime/chat-dm-gate.mjs';
if(!process.env.MONGODB_DB?.startsWith('fakebucks_test_'))throw Error('Isolated database required');
const client=new MongoClient(process.env.MONGODB_URI!),db=client.db(process.env.MONGODB_DB+'_dm_reset_race');
after(async()=>{await db.dropDatabase();await client.close();});
function merge(a:any,p:any){for(const [k,v]of Object.entries(p)){if(v===null)delete a[k];else if(v&&typeof v==='object'&&!Array.isArray(v)){a[k]??={};merge(a[k],v);}else a[k]=v;}return a;}
function barrier(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};}
test('shared runtime gate linearizes reset against the final DM insert and releases after errors',async()=>{
 const profiles:Record<string,any>={admin:{privateMetadata:{admin:true}},alice:{},bob:{}};
 const clerk={users:{getUser:async(u:string)=>structuredClone(profiles[u]),updateUserMetadata:async(u:string,p:any)=>merge(profiles[u],structuredClone(p))}};
 await db.collection('rooms').insertOne({_id:'main' as never,version:1,members:[{id:'alice',approved:true,publicId:'a'.repeat(16)},{id:'bob',approved:true,publicId:'b'.repeat(16)}]});
 const chat=createChatService(db,{clerk});await chat.ready;
 const alice=await createIdentity('alice',0),bob=await createIdentity('bob',0);
 await chat.handle('alice','keys:put',alice.body);await chat.handle('bob','keys:put',bob.body);
 const reached=barrier(),release=barrier();let checks=0;
 const wrapped={collection:(name:string)=>{
  const col=db.collection(name);if(name!=='dm_blocks')return col;
  return new Proxy(col,{get(t,key){
   if(key==='findOne')return async(...args:any[])=>{const result=await (t.findOne as any)(...args);if(++checks===3){reached.resolve();await release.promise;}return result;};
   const value=Reflect.get(t,key);return typeof value==='function'?value.bind(t):value;
  }});
 }};
 const dm=createDmService(wrapped,{clerk});await dm.ready;
 const gate=createChatDmGate(chat,dm);
 const wire=await sealDm(alice.identity,'alice',{userId:'bob',...bob.identity},'only ciphertext persists');
 const sending=gate.handle('alice','send',wire);
 await reached.promise;
 const payload={v:1,publicId:'b'.repeat(16),requestId:crypto.randomUUID(),requestAt:Date.now(),confirm:true};
 // Reset is requested in the exact formerly vulnerable post-fence await window.
 const resetting=gate.adminReset('admin',payload);
 await Promise.resolve();
 assert.equal((await db.collection('chat_identity_versions').findOne({_id:'bob' as never}))!.status,'active');
 release.resolve();
 assert.equal((await sending).duplicate,false);assert.deepEqual(await resetting,{reset:true});
 assert.equal((await db.collection('chat_identity_versions').findOne({_id:'bob' as never}))!.status,'setup_required');
 assert.equal(await db.collection('dm_messages').countDocuments(),1);
 // Reset-first ordering rejects old keys and idempotent old-message retries.
 await assert.rejects(gate.handle('alice','send',wire),/identity_required/);
 const fresh=await sealDm(alice.identity,'alice',{userId:'bob',...bob.identity},'must not insert');
 await assert.rejects(gate.handle('alice','send',fresh),/identity_required/);
 assert.equal(await db.collection('dm_messages').countDocuments(),1);
 assert.equal(typeof (await gate.handle('alice','profile',{v:1})).username,'string');
 await assert.rejects(gate.adminReset('alice',payload),/forbidden/);
 assert.deepEqual(await gate.adminReset('admin',payload),{reset:true});
 assert.equal(JSON.stringify(await db.collection('dm_messages').findOne({})).includes('only ciphertext persists'),false);
});
test('shared gate bounds queued work without poisoning its queue',async()=>{
 const release=barrier();let calls=0;
 const gate=createChatDmGate({adminReset:async()=>{calls++;await release.promise;return {reset:true};}},{handle:async()=>({ok:true})});
 const pending=Array.from({length:128},()=>gate.adminReset('admin',{}));
 await assert.rejects(gate.handle('alice','profile',{}),/busy/);
 release.resolve();await Promise.all(pending);assert.equal(calls,128);
 assert.deepEqual(await gate.handle('alice','profile',{}),{ok:true});
});
