import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
import {createIdentity} from '../../lib/chat-crypto';
// @ts-expect-error runtime module
import {createIdentityStore} from '../../runtime/chat-identity.mjs';
if(!process.env.MONGODB_DB?.startsWith('fakebucks_test_'))throw Error('Isolated database required');
const client=new MongoClient(process.env.MONGODB_URI!),db=client.db(process.env.MONGODB_DB+'_immutable');
after(async()=>{await db.dropDatabase();await client.close();});
function fixture(){
 const profiles:Record<string,any>={},writes:any[]=[];
 const clerk={users:{getUser:async(u:string)=>structuredClone(profiles[u]||{publicMetadata:{},privateMetadata:{}}),updateUserMetadata:async(u:string,p:any)=>{
  writes.push(structuredClone(p));
  const account=profiles[u]||{publicMetadata:{other:'keep'},privateMetadata:{admin:true}};
  for(const field of ['publicMetadata','privateMetadata'])account[field]={...account[field],tabletalk:{...account[field].tabletalk,...p[field].tabletalk}};
  profiles[u]=account;
 }}};
 return {profiles,writes,clerk,store:createIdentityStore(db,clerk)};
}
test('different concurrent first setups across stores elect one immutable identity; exact replay is read-only',async()=>{
 const {store,clerk,writes,profiles}=fixture(),user='race';
 const requests=await Promise.all(Array.from({length:12},()=>createIdentity(user,0)));
 const stores=requests.map(()=>createIdentityStore(db,clerk));
 const results=await Promise.allSettled(requests.map((r,i)=>stores[i].put(user,r.body)));
 const winners=results.flatMap((r,i)=>r.status==='fulfilled'?[i]:[]);assert.equal(winners.length,1);assert.equal(writes.length,1);
 const original=structuredClone(profiles[user]),winner=requests[winners[0]];
 await Promise.all(Array.from({length:12},()=>store.put(user,winner.body)));
 assert.equal(writes.length,1);assert.deepEqual(profiles[user],original);
 await assert.rejects(store.put(user,(await createIdentity(user,1)).body),/identity_exists/);
 assert.deepEqual(profiles[user],original);
});
for(const pointer of [false,true])for(const kind of ['public','backup','both','null-public','null-backup'])test(`existing ${kind} metadata blocks setup with pointer=${pointer}`,async()=>{
 const {store,profiles,writes}=fixture(),user=`partial-${pointer}-${kind}`,first=await createIdentity(user,0);
 const pub={publicMetadata:{tabletalk:{legacy:{deviceId:'preserve-public'}}},privateMetadata:{}};
 const priv={publicMetadata:{},privateMetadata:{tabletalk:{legacy:{ciphertext:'preserve-backup'}}}};
 profiles[user]=kind==='public'?pub:kind==='backup'?priv:kind==='both'?{...pub,privateMetadata:priv.privateMetadata}:kind==='null-public'?{publicMetadata:{tabletalk:null},privateMetadata:{}}:{publicMetadata:{},privateMetadata:{tabletalk:{legacy:null}}};
 if(pointer)await db.collection('chat_identity_versions').insertOne({_id:user as never,status:'active',version:0});
 const original=structuredClone(profiles[user]);
 await assert.rejects(store.put(user,first.body),/identity_exists/);
 await assert.rejects(store.get(user),/identity_exists/);
 assert.equal(writes.length,0);assert.deepEqual(profiles[user],original);
});
test('partial pending Clerk publication never repairs or overwrites either half',async()=>{
 const {store,profiles,writes}=fixture(),user='partial-pending',first=await createIdentity(user,0);
 const p=first.body,slot='k1_pending';
 const pub={v:1,keyVersion:1,deviceId:p.deviceId,dhPublic:p.dhPublic,signPublic:p.signPublic};
 profiles[user]={publicMetadata:{tabletalk:{[slot]:pub}},privateMetadata:{other:'untouched'}};
 await db.collection('chat_identity_versions').insertOne({_id:user as never,status:'pending',version:0,slot,pendingVersion:1,pendingHash:'same',pendingPublic:pub,pendingBackup:p.backup});
 const before=structuredClone(profiles[user]);
 await assert.rejects(store.get(user),/identity_exists/);assert.equal(writes.length,0);assert.deepEqual(profiles[user],before);
});
test('simultaneous first publication and recovery cannot both write Clerk',async()=>{
 const {clerk,store,writes}=fixture(),user='publication',first=await createIdentity(user,0);
 let release!:()=>void,entered!:()=>void;const reached=new Promise<void>(r=>entered=r),hold=new Promise<void>(r=>release=r);
 const original=clerk.users.updateUserMetadata;
 clerk.users.updateUserMetadata=async(u,p)=>{entered();await hold;return original(u,p);};
 const publishing=store.put(user,first.body);await reached;
 const other=createIdentityStore(db,clerk);
 await assert.rejects(other.get(user),/identity_unavailable/);
 await assert.rejects(other.put(user,first.body),/identity_unavailable/);
 release();const result=await publishing;
 assert.equal(result.identity.deviceId,first.identity.deviceId);assert.equal(writes.length,1);
 assert.deepEqual(await other.get(user),result);assert.equal(writes.length,1);
});
test('crashed empty publisher fails closed without releasing its immutable reservation',async()=>{
 const {store,writes}=fixture(),user='crashed-publisher',first=await createIdentity(user,0),p=first.body;
 const reservation={_id:user as never,status:'publishing',version:0,slot:'k1_crashed',pendingVersion:1,pendingHash:'crashed',pendingPublic:{v:1,keyVersion:1,deviceId:p.deviceId,dhPublic:p.dhPublic,signPublic:p.signPublic},pendingBackup:p.backup};
 await db.collection('chat_identity_versions').insertOne(reservation);
 await assert.rejects(store.get(user),/identity_unavailable/);
 await assert.rejects(store.put(user,(await createIdentity(user,0)).body),/identity_exists/);
 assert.equal(writes.length,0);
 assert.deepEqual(await db.collection('chat_identity_versions').findOne({_id:user as never}),reservation);
});
for(const name of ['chat_devices','chat_public_keys'])test(`orphaned ${name} public key cannot be replaced by a fresh setup`,async()=>{
 const {store,profiles,writes}=fixture(),user='orphan-'+name,first=await createIdentity(user,0);
 const record={userId:user,deviceId:'preserve-device',dhPublic:'preserve-dh',signPublic:'preserve-sign'};
 await db.collection(name).insertOne({...record});
 const before=await db.collection(name).findOne({userId:user});
 await assert.rejects(store.get(user),/identity_exists/);
 await assert.rejects(store.put(user,first.body),/identity_exists/);
 assert.deepEqual(await db.collection(name).findOne({userId:user}),before);
 assert.equal(writes.length,0);assert.equal(profiles[user],undefined);
});
