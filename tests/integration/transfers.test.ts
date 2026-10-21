import {test,before,after,beforeEach} from "node:test";
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {db,closeDatabase,readRoom} from "../../lib/db";
import {visit,mutate,move} from "../../lib/store";
import {assertRoom} from "../../lib/poker";
import {openPosition} from "../../lib/finance";
import {createReceiveCode,sendTransfer,resolveReceiveCode,transferHistory,transferIndexes,CODE_TTL_MS,activeReceiveCodes,cancelReceiveCode} from "../../lib/transfers";
import type {Identity} from "../../lib/types";
if(!process.env.MONGODB_DB?.startsWith("fakebucks_test_transfer_"))throw new Error("Refusing non-test database");
const alice:Identity={id:"a",name:"Alice",email:"a@example.test",admin:false},bob={...alice,id:"b",name:"Bob"},carol={...alice,id:"c",name:"Carol"};
before(async()=>{assert.ok((await(await db()).admin().command({hello:1})).setName,"Replica set required");});
beforeEach(async()=>{const d=await db();await Promise.all([d.collection("rooms").deleteMany({}),d.collection("transfers").deleteMany({}),d.collection("transfer_codes").deleteMany({}),d.collection("transfer_code_issuers").deleteMany({})]);await visit(alice);await visit(bob);await visit(carol);});
after(async()=>{await(await db()).dropDatabase();await closeDatabase();});
async function input(to= bob,amount="100.00"){const {code}=await createReceiveCode(to,{amount,note:"thanks"});return {code,requestId:randomUUID(),recipient:(await resolveReceiveCode(alice,code)).publicId};}
test("atomic transfer updates both balances and one private immutable history",async()=>{const i=await input();await sendTransfer(alice,i);const r=await readRoom();assert.equal(r.members[0].wallet,90000);assert.equal(r.members[1].wallet,110000);assertRoom(r);assert.equal((await transferHistory(alice)).length,1);assert.equal((await transferHistory(bob))[0].direction,"received");assert.equal((await transferHistory(carol)).length,0);await assert.rejects(()=>transferHistory(carol,true));assert.equal((await transferHistory({...carol,admin:true},true)).length,1);assert.equal(r.members[0].adjustments,-10000);});
test("parallel same key is exactly once and altered payload conflicts",async()=>{const i=await input();const results=await Promise.all(Array.from({length:8},()=>sendTransfer(alice,i)));assert.equal(new Set(results.map(x=>x?.id)).size,1);assert.equal((await readRoom()).members[0].wallet,90000);assert.equal((await transferHistory(alice)).length,1);await assert.rejects(()=>sendTransfer(alice,{...i,recipient:"changed-recipient"}),/different transfer/);});
test("distinct keys cannot double consume single-use receiver code",async()=>{const i=await input();const results=await Promise.allSettled([sendTransfer(alice,i),sendTransfer(alice,{...i,requestId:randomUUID()})]);assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal((await transferHistory(alice)).length,1);});
test("parallel different recipients cannot overspend",async()=>{const b=await input(bob,"750"),c=await input(carol,"750");const out=await Promise.allSettled([sendTransfer(alice,b),sendTransfer(alice,c)]);assert.equal(out.filter(x=>x.status==="fulfilled").length,1);assert.equal((await readRoom()).members[0].wallet,25000);assertRoom(await readRoom());});
test("margin and poker locked funds are not available",async()=>{await mutate(r=>{r.quotes={BTC:{micro:100_000_000,at:Date.now()}};openPosition(r,alice,"BTC","long",70000,1);});await move(alice,{type:"join",seat:0,buyIn:20000},randomUUID(),0,null,Date.now());
 const i=await input(bob,"100.01");await assert.rejects(()=>sendTransfer(alice,i),/available cash/);assert.equal((await readRoom()).members[0].wallet,10000);assert.equal((await transferHistory(alice)).length,0);
});
test("transfer versus concurrent margin/poker CAS never overspends",async()=>{for(const kind of ["margin","poker"]){if(kind==="poker"){await(await db()).collection("rooms").deleteMany({});await visit(alice);await visit(bob);await visit(carol);await resetIssuer(bob);}await mutate(r=>{r.quotes={BTC:{micro:100_000_000,at:Date.now()}};});const i=await input(bob,"750");const other=kind==="margin"?mutate(r=>openPosition(r,alice,"BTC","long",75000,1)):move(alice,{type:"join",seat:0,buyIn:75000},randomUUID(),0,null,Date.now());const out=await Promise.allSettled([sendTransfer(alice,i),other]);assert.equal(out.filter(x=>x.status==="fulfilled").length,1);assert.equal((await readRoom()).members[0].wallet,25000);assertRoom(await readRoom());}});
test("injected record insert failure rolls back room debit and code consumption",async()=>{const i=await input();const d=await db();await d.command({collMod:"transfers",validator:{amount:{$lt:0}},validationLevel:"strict"});try{await assert.rejects(()=>sendTransfer(alice,i));assert.equal((await readRoom()).members[0].wallet,100000);assert.equal((await transferHistory(alice)).length,0);assert.equal((await resolveReceiveCode(alice,i.code)).name,"Bob");}finally{await d.command({collMod:"transfers",validator:{}});}});
test("new requests preserve old codes, expired codes and self transfers rejected",async()=>{
 const old=await input();await resetIssuer(bob);const fresh=await input();
 assert.equal((await resolveReceiveCode(alice,old.code)).amount,10000);
 await(await db()).collection("transfer_codes").updateOne({hash:codeHash(fresh.code)},{$set:{expiresAt:new Date(0)}});
 await assert.rejects(()=>sendTransfer(alice,fresh),/Code expired/);
 await sendTransfer(alice,old);
 const own=await createReceiveCode(alice,{amount:"100"});
 await assert.rejects(()=>resolveReceiveCode(alice,own.code),/yourself/);
 await assert.rejects(()=>sendTransfer(alice,{...old,code:own.code,requestId:randomUUID()}),/yourself/);
});
test("recipient confirmation mismatch and revoked membership fail without moving cash",async()=>{const i=await input();await assert.rejects(()=>sendTransfer(alice,{...i,recipient:"wrong-player"}),/Recipient changed/);assert.equal((await readRoom()).members[0].wallet,100000);await mutate(r=>{r.members.find(m=>m.id===bob.id)!.accessRevoked=true;});await assert.rejects(()=>sendTransfer(alice,i),/Player unavailable/);assert.equal((await transferHistory(alice)).length,0);});
test("issuing another request cannot invalidate concurrent confirmation",async()=>{
 const i=await input();await resetIssuer(bob);
 const [sent,fresh]=await Promise.all([sendTransfer(alice,i),createReceiveCode(bob,{amount:"100"})]);
 assertRoom(await readRoom());assert.equal((await readRoom()).members[0].wallet,90000);
 assert.equal((await resolveReceiveCode(alice,fresh.code)).amount,10000);
 assert.equal((await sendTransfer(alice,i))?.id,sent?.id);
 await assert.rejects(()=>sendTransfer(alice,{...i,requestId:randomUUID()}),/Code expired/);
});
test("recoverable code is owner-only; hash domain unchanged and failed funds preserve request",async()=>{
 const i=await input(bob,"1000.01"),d=await db();
 const stored=await d.collection("transfer_codes").findOne({hash:codeHash(i.code)});
 assert.ok(stored);assert.equal(stored.hash,codeHash(i.code));assert.ok(stored.generation);
 assert.equal(stored.ownerId,bob.id);assert.equal(stored.code,i.code);assert.notEqual(stored._id,bob.id);
 const owned=await activeReceiveCodes(bob),other=await activeReceiveCodes(carol);
 assert.equal(owned[0].code,i.code);assert.equal(other.length,0);
 assert.deepEqual(Object.keys(owned[0]).sort(),["amount","code","expiresAt","id","note"]);
 assert.ok(!("code" in await resolveReceiveCode(alice,i.code)));
 await assert.rejects(()=>sendTransfer(alice,i),/available cash/);
 assert.equal((await resolveReceiveCode(alice,i.code)).name,"Bob");
});

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
 const stored=await d.collection("transfer_codes").findOne({ownerId:people[0].id});
 await assert.rejects(()=>d.collection("transfer_codes").insertOne({...stored!,_id:"collision" as never}),{code:11000});
});

test("an actual unique-index collision retries without replacing the other active request",async()=>{
 const d=await db(),codes=d.collection("transfer_codes");
 let attempts=0;
 // Interpose a competing issuer exactly after generation, before the real Mongo write.
 // Both writes still go through the real unique index, not a mocked duplicate error.
 const wrapped=new Proxy(d,{get(target,key){
  if(key==="collection")return(name:string)=>name!=="transfer_codes"?target.collection(name):new Proxy(codes,{get(c,k){
   if(k==="insertOne")return async(row:Record<string,unknown>)=>{
    attempts++;if(attempts===1)await codes.insertOne({...row,_id:randomUUID() as never,ownerId:carol.id});
    return c.insertOne(row);
   };
   const value=Reflect.get(c,k);return typeof value==="function"?value.bind(c):value;
  }});
  const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;
 }});
 const request=await createReceiveCode(bob,{amount:"2"},wrapped);
 assert.equal(attempts,2);
 assert.equal((await resolveReceiveCode(alice,request.code,d)).name,"Bob");
 const competing=await codes.findOne({ownerId:carol.id}),winner=await codes.findOne({ownerId:bob.id});
 assert.notEqual(competing!.hash,winner!.hash);assert.equal(competing!.amount,200);
});

test("collision retries are bounded and leave an existing request intact",async()=>{
 const d=await db(),old=await createReceiveCode(bob,{amount:"3"},d),codes=d.collection("transfer_codes");
 const occupied=await createReceiveCode(carol,{amount:"1"},d);
 const occupiedRow=await codes.findOne({ownerId:carol.id});let attempts=0;
 const wrapped=new Proxy(d,{get(target,key){
  if(key==="collection")return(name:string)=>name!=="transfer_codes"?target.collection(name):new Proxy(codes,{get(c,k){
   if(k==="insertOne")return async(row:Record<string,unknown>)=>{
    attempts++;return c.insertOne({...row,hash:occupiedRow!.hash});
   };
   const value=Reflect.get(c,k);return typeof value==="function"?value.bind(c):value;
  }});
  const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;
 }});
 await resetIssuer(bob);
 await assert.rejects(()=>createReceiveCode(bob,{amount:"99"},wrapped),/Could not create/);
 assert.equal(attempts,5);
 assert.equal((await resolveReceiveCode(alice,old.code,d)).amount,300);
 assert.equal((await resolveReceiveCode(alice,occupied.code,d)).amount,100);
});

test("payment guess limits still enforce user, source and aggregate budgets",async()=>{
 const {limitTransferGuess,transferSource}=await import("../../lib/transfer-rate-limit");
 const d=await db(),request=new Request("https://test.invalid");
 const budgets=[["transfer-guess:source:"+transferSource(request),30],["transfer-guess:global",120]] as const;
 for(const [id,cap] of budgets){
  await d.collection("limits").deleteMany({});
  const minute=Math.floor(Date.now()/60_000);
  await d.collection("limits").insertOne({_id:(id+":"+minute) as never,count:cap-1,expiresAt:new Date((minute+3)*60_000)});
  await limitTransferGuess(request,alice.id);
  await d.collection("limits").updateOne({_id:"transfer-guess:rolling-user:a" as never},{$set:{nextAt:new Date(0)}});
  await assert.rejects(()=>limitTransferGuess(request,alice.id),(e:unknown)=>(e as {status:number}).status===429);
 }
 await d.collection("limits").deleteMany({});
 const {rateLimit}=await import("../../lib/store");
 await Promise.all(Array.from({length:20},()=>rateLimit("transfers:a",20)));
 await assert.rejects(()=>rateLimit("transfers:a",20),(e:unknown)=>(e as {status:number}).status===429);
});

function codeHash(code:string){return createHash("sha256").update("ssg200x.payment-request.v2\0"+code).digest("hex");}
// Test-only advance the issuer eligibility, never wall-clock waiting between fixtures.
async function resetIssuer(who:Identity){await(await db()).collection("transfer_code_issuers").updateOne({_id:who.id as never},{$set:{nextAt:new Date(0)}});}

test("atomic rolling throttle allows only one concurrent creation across DB clients",async()=>{
 const {MongoClient}=await import("mongodb");const client=await new MongoClient(process.env.MONGODB_URI!).connect();
 try{
  const other=client.db(process.env.MONGODB_DB);
  const results=await Promise.allSettled(Array.from({length:24},(_,i)=>createReceiveCode(bob,{amount:"1"},i%2?other:undefined)));
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
  for(const r of results)if(r.status==="rejected")assert.equal(r.reason.status,429);
  assert.equal((await activeReceiveCodes(bob)).length,1);
  await assert.rejects(()=>createReceiveCode(bob,{amount:"2"}),{status:429});
  await new Promise(r=>setTimeout(r,1050));
  await createReceiveCode(bob,{amount:"2"});
  assert.equal((await activeReceiveCodes(bob)).length,2);
 }finally{await client.close();}
});
test("no count cap or minute generation budget; independent amounts and notes persist",async()=>{
 const requests=[];
 for(let i=0;i<65;i++){await resetIssuer(bob);requests.push(await createReceiveCode(bob,{amount:String(i+1),note:"request "+i}));}
 const listed=await activeReceiveCodes(bob);assert.equal(listed.length,65);
 assert.equal(new Set(listed.map(c=>c.id)).size,65);assert.equal(new Set(listed.map(c=>c.code)).size,65);
 for(const request of requests){const preview=await resolveReceiveCode(alice,request.code);assert.equal(preview.amount,request.amount);assert.equal(preview.note,request.note);}
});
test("cancel only deletes an owned active request and cannot be used by admins for others",async()=>{
 const a=await createReceiveCode(bob,{amount:"1"});await resetIssuer(bob);const b=await createReceiveCode(bob,{amount:"2"});
 for(const who of [alice,{...carol,admin:true}])await assert.rejects(()=>cancelReceiveCode(who,a.id),{status:404});
 assert.deepEqual(await cancelReceiveCode(bob,a.id),{cancelled:true});
 await assert.rejects(()=>resolveReceiveCode(alice,a.code),{status:404});
 await assert.rejects(()=>cancelReceiveCode(bob,a.id),{status:404});
 assert.equal((await resolveReceiveCode(alice,b.code)).amount,200);
 assert.deepEqual((await activeReceiveCodes(bob)).map(c=>c.id),[b.id]);
});
test("cancel and send serialize without double spending; cancelled code cannot replay as a new transfer",async()=>{
 const request=await createReceiveCode(bob,{amount:"1"}),i={code:request.code,recipient:(await resolveReceiveCode(alice,request.code)).publicId!,requestId:randomUUID()};
 const results=await Promise.allSettled([cancelReceiveCode(bob,request.id),sendTransfer(alice,i)]);
 assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
 assert.equal((await activeReceiveCodes(bob)).length,0);
 assert.equal((await readRoom()).members[0].wallet,results[1].status==="fulfilled"?99900:100000);
 await assert.rejects(()=>sendTransfer(alice,{...i,requestId:randomUUID()}),/Code expired/);
 assertRoom(await readRoom());
});
test("expired-but-not-TTL-deleted rows are hidden, cannot cancel, resolve or send",async()=>{
 const request=await createReceiveCode(bob,{amount:"1"});
 const recipient=(await resolveReceiveCode(alice,request.code)).publicId!;
 await(await db()).collection("transfer_codes").updateOne({_id:request.id as never},{$set:{expiresAt:new Date(0)}});
 assert.equal((await activeReceiveCodes(bob)).length,0);
 await assert.rejects(()=>cancelReceiveCode(bob,request.id),{status:404});
 await assert.rejects(()=>resolveReceiveCode(alice,request.code),{status:404});
 await assert.rejects(()=>sendTransfer(alice,{code:request.code,recipient,requestId:randomUUID()}),{status:409});
});
test("legacy active requests coexist without rewriting or dropping old indexes and remain owner cancellable",async()=>{
 const d=await db(),code="cat dog fish bird",row={_id:bob.id as never,hash:codeHash(code),generation:randomUUID(),expiresAt:new Date(Date.now()+CODE_TTL_MS),amount:1234,note:"legacy"};
 await d.collection("transfer_codes").insertOne(row);
 const request=await createReceiveCode(bob,{amount:"1"});
 const listed=await activeReceiveCodes(bob);assert.equal(listed.length,2);
 assert.equal(listed.find(c=>c.id===bob.id)!.code,null);
 assert.deepEqual(await d.collection("transfer_codes").findOne({_id:bob.id as never}),row);
 assert.equal((await resolveReceiveCode(alice,code)).amount,1234);
 assert.equal((await resolveReceiveCode(alice,request.code)).amount,100);
 await assert.rejects(()=>cancelReceiveCode(alice,bob.id),{status:404});
 await cancelReceiveCode(bob,bob.id);
 assert.equal((await activeReceiveCodes(bob)).length,1);
});
test("revoked owners cannot list, issue or cancel; invalid inputs do not consume the issuer slot",async()=>{
 await assert.rejects(()=>createReceiveCode(bob,{amount:"0"}));
 const request=await createReceiveCode(bob,{amount:"1"});
 await mutate(r=>{r.members.find(m=>m.id===bob.id)!.accessRevoked=true;});
 await assert.rejects(()=>activeReceiveCodes(bob),{status:403});
 await assert.rejects(()=>cancelReceiveCode(bob,request.id),{status:403});
 await assert.rejects(()=>createReceiveCode(bob,{amount:"2"}),{status:403});
});


test("guess user claim is atomic across independent database clients",async()=>{
 const {claimTransferGuess}=await import("../../lib/transfer-rate-limit"),{MongoClient}=await import("mongodb");
 const d=await db(),client=await new MongoClient(process.env.MONGODB_URI!).connect();
 await d.collection("limits").deleteMany({});
 try{
  const results=await Promise.allSettled(Array.from({length:32},(_,i)=>claimTransferGuess(alice.id,i%2?client.db(process.env.MONGODB_DB):d)));
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
  for(const r of results)if(r.status==="rejected")assert.equal(r.reason.status,429);
  await claimTransferGuess(bob.id,d);
 }finally{await client.close();}
});
test("guess attempts use a rolling two-second boundary, rejected calls do not slide it",async()=>{
 const {claimTransferGuess,TRANSFER_GUESS_INTERVAL_MS}=await import("../../lib/transfer-rate-limit"),d=await db();
 await d.collection("limits").deleteMany({});
 await claimTransferGuess(alice.id);
 const key={_id:"transfer-guess:rolling-user:a" as never};
 const first=await d.collection("limits").findOne(key);
 assert.equal(TRANSFER_GUESS_INTERVAL_MS,2000);
 await assert.rejects(()=>claimTransferGuess(alice.id),{status:429});
 assert.equal((await d.collection("limits").findOne(key))!.nextAt.getTime(),first!.nextAt.getTime());
 await new Promise(r=>setTimeout(r,2050));
 await claimTransferGuess(alice.id);
 const second=await d.collection("limits").findOne(key);
 assert.ok(second!.nextAt.getTime()>=first!.nextAt.getTime()+2000);
});
test("guess boundary compares server time inclusively and ignores the app clock",async()=>{
 const {claimTransferGuess}=await import("../../lib/transfer-rate-limit"),d=await db(),key="transfer-guess:rolling-user:a";
 await d.collection("limits").deleteMany({});
 await claimTransferGuess(alice.id);
 const limits=d.collection("limits");
 // Use the exact Mongo expression with a fixed boundary for deterministic equality tests.
 const row=await limits.findOne({_id:key as never});const boundary=row!.nextAt;
 assert.equal((await limits.updateOne({_id:key as never,$expr:{$lte:["$nextAt",new Date(boundary.getTime()-1)]}},{$set:{boundaryHit:true}})).matchedCount,0);
 assert.equal((await limits.updateOne({_id:key as never,$expr:{$lte:["$nextAt",boundary]}},{$set:{boundaryHit:true}})).matchedCount,1);
 const realNow=Date.now;Date.now=()=>realNow()+24*60*60_000;
 try{await assert.rejects(()=>claimTransferGuess(alice.id),{status:429});}finally{Date.now=realNow;}
});
