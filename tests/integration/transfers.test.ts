import {test,before,after,beforeEach} from "node:test";
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {db,closeDatabase,readRoom} from "../../lib/db";
import {visit,mutate,move} from "../../lib/store";
import {assertRoom} from "../../lib/poker";
import {openPosition} from "../../lib/finance";
import {createReceiveCode,sendTransfer,resolveReceiveCode,transferHistory,transferIndexes,CODE_TTL_MS} from "../../lib/transfers";
import type {Identity} from "../../lib/types";
if(!process.env.MONGODB_DB?.startsWith("fakebucks_test_transfer_"))throw new Error("Refusing non-test database");
const alice:Identity={id:"a",name:"Alice",email:"a@example.test",admin:false},bob={...alice,id:"b",name:"Bob"},carol={...alice,id:"c",name:"Carol"};
before(async()=>{assert.ok((await(await db()).admin().command({hello:1})).setName,"Replica set required");});
beforeEach(async()=>{const d=await db();await Promise.all([d.collection("rooms").deleteMany({}),d.collection("transfers").deleteMany({}),d.collection("transfer_codes").deleteMany({})]);await visit(alice);await visit(bob);await visit(carol);});
after(async()=>{await(await db()).dropDatabase();await closeDatabase();});
async function input(to= bob,amount="100.00"){const {code}=await createReceiveCode(to,{amount,note:"thanks"});return {code,requestId:randomUUID(),recipient:(await resolveReceiveCode(alice,code)).publicId};}
test("atomic transfer updates both balances and one private immutable history",async()=>{const i=await input();await sendTransfer(alice,i);const r=await readRoom();assert.equal(r.members[0].wallet,90000);assert.equal(r.members[1].wallet,110000);assertRoom(r);assert.equal((await transferHistory(alice)).length,1);assert.equal((await transferHistory(bob))[0].direction,"received");assert.equal((await transferHistory(carol)).length,0);await assert.rejects(()=>transferHistory(carol,true));assert.equal((await transferHistory({...carol,admin:true},true)).length,1);assert.equal(r.members[0].adjustments,-10000);});
test("parallel same key is exactly once and altered payload conflicts",async()=>{const i=await input();const results=await Promise.all(Array.from({length:8},()=>sendTransfer(alice,i)));assert.equal(new Set(results.map(x=>x?.id)).size,1);assert.equal((await readRoom()).members[0].wallet,90000);assert.equal((await transferHistory(alice)).length,1);await assert.rejects(()=>sendTransfer(alice,{...i,recipient:"changed-recipient"}),/different transfer/);});
test("distinct keys cannot double consume single-use receiver code",async()=>{const i=await input();const results=await Promise.allSettled([sendTransfer(alice,i),sendTransfer(alice,{...i,requestId:randomUUID()})]);assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal((await transferHistory(alice)).length,1);});
test("parallel different recipients cannot overspend",async()=>{const b=await input(bob,"750"),c=await input(carol,"750");const out=await Promise.allSettled([sendTransfer(alice,b),sendTransfer(alice,c)]);assert.equal(out.filter(x=>x.status==="fulfilled").length,1);assert.equal((await readRoom()).members[0].wallet,25000);assertRoom(await readRoom());});
test("margin and poker locked funds are not available",async()=>{await mutate(r=>{r.quotes={BTC:{micro:100_000_000,at:Date.now()}};openPosition(r,alice,"BTC","long",70000,1);});await move(alice,{type:"join",seat:0,buyIn:20000},randomUUID(),0,null,Date.now());
 const i=await input(bob,"100.01");await assert.rejects(()=>sendTransfer(alice,i),/available cash/);assert.equal((await readRoom()).members[0].wallet,10000);assert.equal((await transferHistory(alice)).length,0);
});
test("transfer versus concurrent margin/poker CAS never overspends",async()=>{for(const kind of ["margin","poker"]){if(kind==="poker"){await(await db()).collection("rooms").deleteMany({});await visit(alice);await visit(bob);await visit(carol);}await mutate(r=>{r.quotes={BTC:{micro:100_000_000,at:Date.now()}};});const i=await input(bob,"750");const other=kind==="margin"?mutate(r=>openPosition(r,alice,"BTC","long",75000,1)):move(alice,{type:"join",seat:0,buyIn:75000},randomUUID(),0,null,Date.now());const out=await Promise.allSettled([sendTransfer(alice,i),other]);assert.equal(out.filter(x=>x.status==="fulfilled").length,1);assert.equal((await readRoom()).members[0].wallet,25000);assertRoom(await readRoom());}});
test("injected record insert failure rolls back room debit and code consumption",async()=>{const i=await input();const d=await db();await d.command({collMod:"transfers",validator:{amount:{$lt:0}},validationLevel:"strict"});try{await assert.rejects(()=>sendTransfer(alice,i));assert.equal((await readRoom()).members[0].wallet,100000);assert.equal((await transferHistory(alice)).length,0);assert.equal((await resolveReceiveCode(alice,i.code)).name,"Bob");}finally{await d.command({collMod:"transfers",validator:{}});}});
test("regenerate invalidates old code, expired codes and self transfers rejected",async()=>{const old=await input();await createReceiveCode(bob,{amount:"100"});await assert.rejects(()=>sendTransfer(alice,old),/Code expired/);const fresh=await input();await(await db()).collection("transfer_codes").updateOne({_id:bob.id as never},{$set:{expiresAt:new Date(0)}});await assert.rejects(()=>sendTransfer(alice,fresh),/Code expired/);const own=await createReceiveCode(alice,{amount:"100"});await assert.rejects(()=>resolveReceiveCode(alice,own.code),/yourself/);await assert.rejects(()=>sendTransfer(alice,{...old,code:own.code}),/yourself/);});
test("recipient confirmation mismatch and revoked membership fail without moving cash",async()=>{const i=await input();await assert.rejects(()=>sendTransfer(alice,{...i,recipient:"wrong-player"}),/Recipient changed/);assert.equal((await readRoom()).members[0].wallet,100000);await mutate(r=>{r.members.find(m=>m.id===bob.id)!.accessRevoked=true;});await assert.rejects(()=>sendTransfer(alice,i),/Player unavailable/);assert.equal((await transferHistory(alice)).length,0);});
test("regeneration and confirmation serialize on the same generation document",async()=>{const i=await input();const out=await Promise.allSettled([sendTransfer(alice,i),createReceiveCode(bob,{amount:"100"})]);assert.equal(out[1].status,"fulfilled");const r=await readRoom();assertRoom(r);assert.ok(r.members[0].wallet===90000||r.members[0].wallet===100000);assert.equal((await transferHistory(alice)).length,out[0].status==="fulfilled"?1:0);await assert.rejects(()=>sendTransfer(alice,{...i,requestId:randomUUID()}),/Code expired/);if(out[0].status==="fulfilled")assert.equal((await sendTransfer(alice,i))?.id,out[0].value?.id);});
test("code storage is domain-separated hash only, failed funds preserve code",async()=>{const i=await input(bob,"1000.01"),d=await db();const stored=await d.collection("transfer_codes").findOne({_id:bob.id as never});assert.ok(stored);assert.ok(!JSON.stringify(stored).includes(i.code));const {createHash}=await import("node:crypto");assert.equal(stored.hash,createHash("sha256").update("ssg200x.payment-request.v2\0"+i.code).digest("hex"));assert.ok(stored.generation);await assert.rejects(()=>sendTransfer(alice,i),/available cash/);assert.equal((await resolveReceiveCode(alice,i.code)).name,"Bob");});

test("receiver fixes amount and note, sender cannot override",async()=>{const i=await input(bob,"12.34");assert.equal(i.code.split(" ").length,2);const preview=await resolveReceiveCode(alice,i.code);assert.equal(preview.amount,1234);assert.equal(preview.note,"thanks");await assert.rejects(()=>sendTransfer(alice,{...i,amount:"1"} as never),/receiver fixes/);await sendTransfer(alice,i);assert.equal((await readRoom()).members[1].wallet,101234);});

test("new two-word requests retain the ten-minute lifetime and unique TTL indexes",async()=>{
 const start=Date.now(),request=await createReceiveCode(bob,{amount:"1"});
 assert.equal(request.code.split(" ").length,2);
 assert.ok(request.expiresAt>=start+CODE_TTL_MS&&request.expiresAt<=Date.now()+CODE_TTL_MS);
 const indexes=await(await db()).collection("transfer_codes").indexes();
 assert.ok(indexes.some(i=>i.key.hash===1&&i.unique));
 assert.ok(indexes.some(i=>i.key.expiresAt===1&&i.expireAfterSeconds===0));
});

test("legacy four-word active codes survive index setup, resolve, send and replay",async()=>{
 const d=await db(),code="cat dog fish bird";
 const hash=createHash("sha256").update("ssg200x.payment-request.v2\0"+code).digest("hex");
 await d.collection("transfer_codes").insertOne({_id:bob.id as never,hash,generation:randomUUID(),expiresAt:new Date(Date.now()+CODE_TTL_MS),amount:1234,note:"legacy"});
 await transferIndexes(d);
 const preview=await resolveReceiveCode(alice," CAT  dog Fish bird ");
 assert.equal(preview.amount,1234);assert.equal(preview.note,"legacy");
 const i={code,recipient:preview.publicId!,requestId:randomUUID()};
 const sent=await sendTransfer(alice,i);assert.equal((await sendTransfer(alice,i))?.id,sent?.id);
 assert.equal((await readRoom()).members[1].wallet,101234);
 await assert.rejects(()=>resolveReceiveCode(alice,code),/Code expired/);
});

test("concurrent issuers receive distinct active codes enforced by Mongo",async()=>{
 const d=await db(),people=Array.from({length:32},(_,i)=>({...alice,id:"issuer"+i,name:"Issuer "+i}));
 for(const p of people)await visit(p);
 const requests=await Promise.all(people.map(p=>createReceiveCode(p,{amount:"1"},d)));
 assert.equal(new Set(requests.map(r=>r.code)).size,people.length);
 assert.equal(await d.collection("transfer_codes").countDocuments({expiresAt:{$gt:new Date()}}),people.length);
 const stored=await d.collection("transfer_codes").findOne({_id:people[0].id as never});
 await assert.rejects(()=>d.collection("transfer_codes").insertOne({...stored!,_id:"collision" as never}),{code:11000});
});

test("an actual unique-index collision retries without replacing the other active request",async()=>{
 const d=await db(),codes=d.collection("transfer_codes");
 let attempts=0;
 // Interpose a competing issuer exactly after generation, before the real Mongo write.
 // Both writes still go through the real unique index, not a mocked duplicate error.
 const wrapped=new Proxy(d,{get(target,key){
  if(key==="collection")return(name:string)=>name!=="transfer_codes"?target.collection(name):new Proxy(codes,{get(c,k){
   if(k==="updateOne")return async(filter:object,update:{$set:{hash:string}},options:object)=>{
    attempts++;if(attempts===1)await codes.insertOne({_id:carol.id as never,...update.$set});
    return c.updateOne(filter,update,options);
   };
   const value=Reflect.get(c,k);return typeof value==="function"?value.bind(c):value;
  }});
  const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;
 }});
 const request=await createReceiveCode(bob,{amount:"2"},wrapped);
 assert.equal(attempts,2);
 assert.equal((await resolveReceiveCode(alice,request.code,d)).name,"Bob");
 const competing=await codes.findOne({_id:carol.id as never}),winner=await codes.findOne({_id:bob.id as never});
 assert.notEqual(competing!.hash,winner!.hash);assert.equal(competing!.amount,200);
});

test("collision retries are bounded and leave an existing request intact",async()=>{
 const d=await db(),old=await createReceiveCode(bob,{amount:"3"},d),codes=d.collection("transfer_codes");
 const occupied=await createReceiveCode(carol,{amount:"1"},d);
 const occupiedRow=await codes.findOne({_id:carol.id as never});let attempts=0;
 const wrapped=new Proxy(d,{get(target,key){
  if(key==="collection")return(name:string)=>name!=="transfer_codes"?target.collection(name):new Proxy(codes,{get(c,k){
   if(k==="updateOne")return async(filter:object,update:{$set:{hash:string}},options:object)=>{
    attempts++;return c.updateOne(filter,{$set:{...update.$set,hash:occupiedRow!.hash}},options);
   };
   const value=Reflect.get(c,k);return typeof value==="function"?value.bind(c):value;
  }});
  const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;
 }});
 await assert.rejects(()=>createReceiveCode(bob,{amount:"99"},wrapped),/Could not create/);
 assert.equal(attempts,5);
 assert.equal((await resolveReceiveCode(alice,old.code,d)).amount,300);
 assert.equal((await resolveReceiveCode(alice,occupied.code,d)).amount,100);
});

test("payment guess limits still enforce user, source and aggregate budgets",async()=>{
 const {limitTransferGuess,transferSource}=await import("../../lib/transfer-rate-limit");
 const d=await db(),request=new Request("https://test.invalid");
 const budgets=[["transfer-guess:user:a",10],["transfer-guess:source:"+transferSource(request),30],["transfer-guess:global",120]] as const;
 for(const [id,cap] of budgets){
  await d.collection("limits").deleteMany({});
  const minute=Math.floor(Date.now()/60_000);
  await d.collection("limits").insertOne({_id:(id+":"+minute) as never,count:cap-1,expiresAt:new Date((minute+3)*60_000)});
  await limitTransferGuess(request,alice.id);
  await assert.rejects(()=>limitTransferGuess(request,alice.id),(e:unknown)=>(e as {status:number}).status===429);
 }
 await d.collection("limits").deleteMany({});
 const {rateLimit}=await import("../../lib/store");
 await Promise.all(Array.from({length:20},()=>rateLimit("transfers:a",20)));
 await assert.rejects(()=>rateLimit("transfers:a",20),(e:unknown)=>(e as {status:number}).status===429);
});
