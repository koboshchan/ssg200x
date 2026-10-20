import {createServer} from "node:http";
import {test,before,after,beforeEach} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {MongoClient,MongoServerError} from "mongodb";
import {db,closeDatabase} from "../../lib/db";
import {freshRoom,register,assertRoom} from "../../lib/poker";
import {previewAirdrop,confirmAirdrop} from "../../lib/airdrops";
import {createReceiveCode,sendTransfer,transferHistory} from "../../lib/transfers";
import {mutate} from "../../lib/store";
import {openPosition} from "../../lib/finance";
import type {Identity,Room} from "../../lib/types";
if(!process.env.MONGODB_DB?.startsWith("fakebucks_test_airdrop_"))throw new Error("Refusing non-test database");
const notifications:string[]=[];
const notifier=createServer(async(req,res)=>{
 let body="";for await(const chunk of req)body+=chunk;
 assert.equal(req.url,"/internal-airdrop");assert.equal(req.headers["x-internal-live-secret"],"airdrop-test-secret");
 const {id}=JSON.parse(body);
 // Notification must follow majority commit, not transaction callback completion.
 const receipt=await(await db()).collection("airdrop_receipts").findOne({_id:id});
 assert.ok(receipt,"uncommitted receipt was announced");notifications.push(id);res.writeHead(204).end();
});
const host:Identity={id:"admin",name:"Admin",email:"admin@example.test",admin:true};
const alice={...host,id:"alice",name:"Alice",admin:false},bob={...alice,id:"bob",name:"Bob"};
async function room(){return (await(await db()).collection<Room>("rooms").findOne({_id:"main"}))!;}
async function preview(amount="12.34"){return (await previewAirdrop(host,{amount,note:"celebration"}))!;}
async function confirmation(){const p=await preview();return {previewId:p.previewId,requestId:randomUUID()};}
before(async()=>{await new Promise<void>(r=>notifier.listen(0,"127.0.0.1",r));process.env.PORT=String((notifier.address() as {port:number}).port);process.env.INTERNAL_LIVE_SECRET="airdrop-test-secret";assert.ok((await(await db()).admin().command({hello:1})).setName,"Replica set required");});
beforeEach(async()=>{notifications.length=0;const d=await db();for(const c of ["rooms","transfers","airdrop_previews","airdrop_receipts","transfer_codes"])await d.collection(c).deleteMany({});const r=freshRoom();for(const who of [host,alice,bob])register(r,who);await d.collection<Room>("rooms").insertOne(r);});
after(async()=>{await(await db()).dropDatabase();await closeDatabase();await new Promise<void>(r=>notifier.close(()=>r()));});
test("preview binds exact cents, count and total without crediting wallets",async()=>{const p=await preview();assert.equal(p.count,3);assert.equal(p.amount,1234);assert.equal(p.total,3702);assert.equal(p.note,"celebration");assert.equal((await room()).issuance||0,0);assert.equal(await(await db()).collection("transfers").countDocuments(),0);});
test("one atomic issuance includes admin, excludes revoked/unapproved and audits private history",async()=>{await mutate(r=>{r.members.find(m=>m.id===bob.id)!.accessRevoked=true;const excluded=register(r,{...bob,id:"pending"});excluded.approved=false;});const p=await preview();assert.equal(p.count,2);const out=await confirmAirdrop(host,{previewId:p.previewId,requestId:randomUUID()});assert.equal(out?.total,2468);const r=await room();assertRoom(r);assert.equal(r.issuance,2468);assert.deepEqual(r.members.map(m=>m.wallet),[101234,101234,100000,100000]);assert.equal(r.members[0].adjustments,1234);const records=await(await db()).collection("transfers").find().toArray();assert.equal(records.length,2);assert.ok(records.every(t=>t.kind==="airdrop"&&t.senderBefore===100000&&t.senderAfter===101234));assert.equal((await transferHistory(alice)).length,1);assert.equal((await transferHistory(alice))[0].kind,"airdrop");assert.equal((await transferHistory(bob)).length,0);assert.equal((await transferHistory(host)).find(t=>t.to===host.name)?.direction,"received");assert.equal((await transferHistory(host,true)).length,2);});
test("parallel same-key confirms are exactly once, even after preview expiry",async()=>{const i=await confirmation();const out=await Promise.all(Array.from({length:8},()=>confirmAirdrop(host,i)));assert.equal(new Set(out.map(x=>x?.id)).size,1);assert.deepEqual(notifications,[out[0]?.id]);assert.equal((await room()).issuance,3702);assert.equal(await(await db()).collection("transfers").countDocuments(),3);await(await db()).collection("airdrop_previews").deleteMany({});assert.equal((await confirmAirdrop(host,i))?.id,out[0]?.id);assert.equal(notifications.length,1);});
test("different request keys cannot reuse the same preview",async()=>{const i=await confirmation();const out=await Promise.allSettled([confirmAirdrop(host,i),confirmAirdrop(host,{...i,requestId:randomUUID()})]);assert.equal(out.filter(x=>x.status==="fulfilled").length,1);assert.equal((await room()).issuance,3702);});
test("request fingerprint and administrator bind replay globally",async()=>{const i=await confirmation();await confirmAirdrop(host,i);const p=await preview();await assert.rejects(()=>confirmAirdrop(host,{...i,previewId:p.previewId}),/different airdrop/);await assert.rejects(()=>confirmAirdrop({...alice,admin:true},i),/different airdrop/);assert.equal((await room()).issuance,3702);});
test("ordinary finance ticks keep preview valid and credit current balances",async()=>{const i=await confirmation();await mutate(r=>{r.quotes={BTC:{micro:100_000_000,at:Date.now()}};openPosition(r,alice,"BTC","long",1000,1);});const before=await room();await confirmAirdrop(host,i);const after=await room();assert.equal(after.issuance,3702);for(const m of before.members)assert.equal(after.members.find(x=>x.id===m.id)!.wallet,m.wallet+1234);assertRoom(after);});
test("changed membership, revocation and expiry fail closed",async()=>{for(const kind of ["add","revoke","expiry"]){const i=await confirmation();if(kind==="expiry")await(await db()).collection("airdrop_previews").updateOne({_id:i.previewId as never},{$set:{expiresAt:new Date(0)}});else await mutate(r=>{if(kind==="add")register(r,{...alice,id:randomUUID()});else r.members.find(m=>m.id===alice.id)!.approved=false;});await assert.rejects(()=>confirmAirdrop(host,i),kind==="expiry"?/expired/:/room changed/);}assert.equal((await room()).issuance||0,0);});
test("preview belongs to its admin, no membership is implicitly created",async()=>{const i=await confirmation();await assert.rejects(()=>confirmAirdrop({...alice,admin:true},i),/Preview unavailable/);await assert.rejects(()=>previewAirdrop(alice,{amount:"1"}),/Administrator/);await assert.rejects(()=>confirmAirdrop(alice,i),/Administrator/);const external={...host,id:"external"};const p=(await previewAirdrop(external,{amount:"1"}))!;assert.equal(p.count,3);await confirmAirdrop(external,{previewId:p.previewId,requestId:randomUUID()});const r=await room();assert.equal(r.members.length,3);assertRoom(r);});
test("partial history insert failure rolls back all credits, issuance, preview and receipt",async()=>{const i=await confirmation(),d=await db();await d.command({collMod:"transfers",validator:{recipient:{$ne:alice.id}},validationLevel:"strict"});try{await assert.rejects(()=>confirmAirdrop(host,i));assert.equal(notifications.length,0);assert.equal((await room()).issuance||0,0);assert.ok((await room()).members.every(m=>m.wallet===100000));assert.equal(await d.collection("transfers").countDocuments(),0);assert.equal(await d.collection("airdrop_receipts").countDocuments(),0);assert.equal((await d.collection("airdrop_previews").findOne({_id:i.previewId as never}))?.consumedBy,undefined);}finally{await d.command({collMod:"transfers",validator:{}});}await confirmAirdrop(host,i);assert.equal((await room()).issuance,3702);assert.equal(notifications.length,1);});
test("concurrent transfer versus airdrop serializes, with no lost balances",async()=>{const {code}=await createReceiveCode(bob,{amount:"100"});const p=await preview();const outcomes=await Promise.allSettled([confirmAirdrop(host,{previewId:p.previewId,requestId:randomUUID()}),sendTransfer(alice,{code,requestId:randomUUID(),recipient:(await room()).members.find(m=>m.id===bob.id)!.publicId})]);assert.equal(outcomes[1].status,"fulfilled");assert.equal(outcomes[0].status,"fulfilled");const r=await room(),drop=1234;assert.equal(r.members.find(m=>m.id===alice.id)!.wallet,90000+drop);assert.equal(r.members.find(m=>m.id===bob.id)!.wallet,110000+drop);assert.equal(r.issuance||0,drop*3);assertRoom(r);});
test("strict money, note, zero eligibility, and integer overflow rejected",async()=>{for(const amount of [0,"0","-1","1e3","01","1.001","1000000.01"])await assert.rejects(()=>previewAirdrop(host,{amount}));await assert.rejects(()=>previewAirdrop(host,{amount:"1",note:"<script>"}));await mutate(r=>{for(const m of r.members)m.approved=false;});await assert.rejects(()=>preview(),/No eligible/);const d=await db();await d.collection("rooms").updateOne({_id:"main" as never},{$set:{"members.0.approved":true,"members.0.wallet":Number.MAX_SAFE_INTEGER}});await assert.rejects(()=>preview(),/limit/);});

test("standalone Mongo refuses both operations without issuing any money",{skip:!process.env.AIRDROP_STANDALONE_URI},async()=>{const client=await new MongoClient(process.env.AIRDROP_STANDALONE_URI!).connect(),d=client.db("fakebucks_test_airdrop_standalone_f9c22");try{await d.dropDatabase();const r=freshRoom();register(r,host);await d.collection<Room>("rooms").insertOne(r);for(const operation of [()=>previewAirdrop(host,{amount:"1"},d),()=>confirmAirdrop(host,{previewId:randomUUID(),requestId:randomUUID()},d)])await assert.rejects(operation,(error:unknown)=>Boolean(error&&typeof error==="object"&&"status" in error&&error.status===503&&"message" in error&&String(error.message).includes("replica set")));const unchanged=await d.collection<Room>("rooms").findOne({_id:"main"});assert.equal(unchanged?.members[0].wallet,100000);assert.equal(unchanged?.issuance||0,0);assert.equal(await d.collection("transfers").countDocuments(),0);assert.equal(await d.collection("airdrop_receipts").countDocuments(),0);}finally{await d.dropDatabase();await client.close();}});

test("member reordering, names and ineligible additions do not invalidate preview",async()=>{
 const i=await confirmation();
 await mutate(r=>{r.members.reverse();r.members[0].name="Renamed";register(r,{...alice,id:"pending"}).approved=false;});
 await confirmAirdrop(host,i);assert.equal((await room()).issuance,3702);assert.equal((await room()).members.find(m=>m.id==="pending")!.wallet,100000);
});
test("access revocation after preview rejects without issuance",async()=>{
 const i=await confirmation();await mutate(r=>{r.members.find(m=>m.id===alice.id)!.accessRevoked=true;});
 await assert.rejects(()=>confirmAirdrop(host,i),/room changed/);assert.equal((await room()).issuance||0,0);
});
test("concurrent membership write forces transaction retry and eligibility recheck",async()=>{
 const i=await confirmation(),d=await db();let raced=false;
 // Interleave a committed revocation after the transaction read but before its CAS.
 const wrapped=new Proxy(d,{get(target,key){if(key==="collection")return (name:string)=>{
  const collection=target.collection(name);
  if(name!=="rooms")return collection;
  return new Proxy(collection,{get(c,k){if(k==="updateOne")return async(...args:Parameters<typeof c.updateOne>)=>{
   if(!raced){raced=true;await mutate(r=>{r.members.find(m=>m.id===alice.id)!.accessRevoked=true;});}
   return c.updateOne(...args);
  };const value=Reflect.get(c,k);return typeof value==="function"?value.bind(c):value;}});
 };const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;}});
 await assert.rejects(()=>confirmAirdrop(host,i,wrapped),/room changed/);assert.ok(raced);
 const r=await room();assert.equal(r.issuance||0,0);assert.ok(r.members.every(m=>m.wallet===100000));
 assert.equal(await d.collection("airdrop_receipts").countDocuments(),0);
 assert.equal(await d.collection("transfers").countDocuments(),0);
 assert.equal((await d.collection("airdrop_previews").findOne({_id:i.previewId as never}))?.consumedBy,undefined);
});

test("each separately committed airdrop announces its own amount/ID once, never a preview",async()=>{
 const first=await confirmation();assert.equal(notifications.length,0);
 const a=await confirmAirdrop(host,first);
 const p=await preview("0.01");
 const b=await confirmAirdrop(host,{previewId:p.previewId,requestId:randomUUID()});
 assert.notEqual(a?.id,b?.id);assert.deepEqual(notifications,[a?.id,b?.id]);
 await confirmAirdrop(host,first);assert.equal(notifications.length,2);
});

test("successful transaction callback retry publishes only after the one final commit",async()=>{
 const i=await confirmation(),d=await db();let attempts=0;
 const wrapped=new Proxy(d,{get(target,key){if(key==="collection")return (name:string)=>{
  const c=target.collection(name);if(name!=="rooms")return c;
  return new Proxy(c,{get(collection,k){if(k==="updateOne")return async(...args:Parameters<typeof c.updateOne>)=>{
   const result=await collection.updateOne(...args);
   if(++attempts===1)throw new MongoServerError({message:"fixture transient abort",errorLabels:["TransientTransactionError"]});
   return result;
  };const value=Reflect.get(collection,k);return typeof value==="function"?value.bind(collection):value;}});
 };const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;}});
 const receipt=await confirmAirdrop(host,i,wrapped);assert.equal(attempts,2);
 assert.deepEqual(notifications,[receipt?.id]);assert.equal((await room()).issuance,3702);
 assert.equal(await d.collection("airdrop_receipts").countDocuments(),1);
});
