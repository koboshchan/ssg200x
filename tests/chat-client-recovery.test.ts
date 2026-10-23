import {createRequestBudget} from "../lib/chat-request-budget";
import {openMessage} from "../lib/chat-crypto";
import {test} from "node:test";
import assert from "node:assert/strict";
import {ChatClient,type BootstrapPayload,type ChatStore,type Pin,type Setup} from "../lib/chat-client";
import {createIdentity,makeWrap,newEpochKey,sealMessage,type Identity,type WireMessage,type WireWrap,type ServerIdentity} from "../lib/chat-crypto";

class MemoryStore implements ChatStore{
 budget=createRequestBudget(()=>Date.now());
 pending=new Map<string,any>();
 getPending=async(u:string)=>[...this.pending.entries()].filter(([k])=>k.startsWith(u+":")).map(([,v])=>structuredClone(v));
 putPending=async(u:string,p:any)=>{this.pending.set(u+":"+p.id,structuredClone(p));};
 deletePending=async(u:string,id:string)=>{this.pending.delete(u+":"+id);};

 identities=new Map<string,Identity>();epochs=new Map<string,CryptoKey>();pins=new Map<string,Pin>();setups=new Map<string,Setup>();bootstraps=new Map<string,BootstrapPayload>();
 getIdentity=async(u:string)=>this.identities.get(u);
 putIdentity=async(u:string,i:Identity)=>{this.identities.set(u,i);};
 clearIdentity=async(u:string)=>{this.identities.delete(u);this.epochs.clear();this.bootstraps.clear();};
 getEpoch=async(u:string,e:string)=>this.epochs.get(u+e);
 putEpoch=async(u:string,e:string,k:CryptoKey)=>{this.epochs.set(u+e,k);};
 getPin=async(u:string,o:string)=>this.pins.get(u+o);
 putPin=async(u:string,o:string,p:Pin)=>{this.pins.set(u+o,p);};
 getSetup=async(u:string)=>this.setups.get(u);
 putSetup=async(u:string,s:Setup)=>{this.setups.set(u,s);};
 clearSetup=async(u:string)=>{this.setups.delete(u);};
 getBootstrap=async(u:string,e:string)=>this.bootstraps.get(u+e);
 putBootstrap=async(u:string,e:string,k:CryptoKey,w:BootstrapPayload)=>{this.epochs.set(u+e,k);this.bootstraps.set(u+e,w);};
 clearBootstrap=async(u:string,e:string)=>{this.bootstraps.delete(u+e);};
}
const server=(i:Awaited<ReturnType<typeof createIdentity>>):ServerIdentity=>({...i.body,v:1});
const device=(i:Identity)=>({deviceId:i.deviceId,dhPublic:i.dhPublic,signPublic:i.signPublic,fingerprint:"current"});
const view=(i:Identity,epoch:string)=>({revision:1,epoch,status:"active",leaseUntil:Date.now()+30000,owner:{userId:"a",deviceId:i.deviceId},members:[{userId:"a",devices:[device(i)]}],wraps:[] as WireWrap[],nextWrapCursor:null as string|null});
const makeMessage=async(i:Identity,user:string,epoch:string,key:CryptoKey,text="history"):Promise<WireMessage>=>({...await sealMessage(i,user,{revision:1,epoch,id:crypto.randomUUID(),ts:Date.now()},text,key),senderUserId:user,senderSignPublic:i.signPublic,serverTs:1,cursor:1});
const wire=async(from:Identity,user:string,to:Identity,epoch:string,key:CryptoKey):Promise<WireWrap>=>({...await makeWrap(from,user,{revision:1,epoch,toUserId:"a",toDeviceId:to.deviceId},to.dhPublic,key),senderUserId:user,senderDhPublic:from.dhPublic,senderSignPublic:from.signPublic});
async function seeded(){
 const a=await createIdentity("a",0),store=new MemoryStore();await store.putIdentity("a",a.identity);
 return {a,store};
}

test("setup stages keys and shows words before publication; lost keys ACK retries exact bytes across reload",async()=>{
 const store=new MemoryStore(),requests:unknown[]=[];let active:ServerIdentity|null=null;
 const transport=async(event:string,p:any)=>{
  if(event==="keys:get")return {identity:active};
  if(event==="keys:put"){requests.push(structuredClone(p));active={...p,v:1};if(requests.length===1)throw new Error("timeout");return {identity:active};}
  if(event==="register")return {};
  if(event==="state")return {...view((await store.getIdentity("a"))!,crypto.randomUUID()),status:"active"};
  throw new Error("unexpected "+event);
 };
 const c=new ChatClient("a",transport,store,Date.now,openMessage,store.budget);
 await c.start();await c.createIdentity();
 assert.equal(c.getSnapshot().phase,"words");assert.equal(requests.length,0);
 assert.equal((await store.getSetup("a"))!.identity.signPrivate.extractable,false);
 assert.equal(JSON.stringify(await store.getSetup("a")).includes(c.getSnapshot().words!.join(" ")),false);
 await c.confirmWords();c.close();
 assert.equal(requests.length,1);assert.equal((await store.getSetup("a"))!.confirmed,true);
 const resumed=new ChatClient("a",transport,store,Date.now,openMessage,store.budget);
 try{await resumed.start();assert.equal(requests.length,2);assert.deepEqual(requests[0],requests[1]);assert.equal(await store.getSetup("a"),undefined);assert.equal((await store.getIdentity("a"))!.deviceId,active!.deviceId);}
 finally{resumed.close();}
});

test("reload before words confirmation offers recovery only without publishing",async()=>{
 const store=new MemoryStore();let puts=0;
 const transport=async(e:string)=>{if(e==="keys:put")puts++;return {identity:null};};
 const c=new ChatClient("a",transport,store,Date.now,openMessage,store.budget);await c.createIdentity();const words=c.getSnapshot().words!.join(" ");c.close();
 const resumed=new ChatClient("a",transport,store,Date.now,openMessage,store.budget);
 try{
  await resumed.start();assert.equal(resumed.getSnapshot().phase,"recover");assert.equal(resumed.getSnapshot().error,"setup_words_lost");assert.equal(puts,0);
  assert.ok(words.length);assert.equal((resumed as any).resetIdentity,undefined);await resumed.createIdentity();assert.equal(resumed.getSnapshot().phase,"recover");assert.ok(await store.getSetup("a"));
 }finally{resumed.close();}
});

test("all grant pages including inline bootstrap are enumerated before history",async()=>{
 const {a,store}=await seeded(),key=await newEpochKey(),epochs=Array.from({length:514},()=>crypto.randomUUID()),calls:string[]=[];
 const grants=await Promise.all(epochs.map(e=>wire(a.identity,"a",a.identity,e,key)));
 const current=epochs[513],base=view(a.identity,current),message=await makeMessage(a.identity,"a",current,key);
 const client=new ChatClient("a",async(event,p:any)=>{
  if(event==="keys:get")return {identity:server(a)};
  if(event==="register")return {};
  if(event==="state"){calls.push(p.beforeWrap||"first");return {...base,wraps:p.beforeWrap?grants.slice(512):[...grants.slice(0,512),grants[0]],nextWrapCursor:p.beforeWrap?null:"a".repeat(64)};}
  if(event==="history")return {messages:p.epoch===current?[message]:[],nextCursor:null};
  throw new Error(event);
 },store,Date.now,openMessage,store.budget);
 try{await client.start();assert.deepEqual(calls,["first","a".repeat(64)]);assert.equal(store.epochs.size,514);assert.equal(client.getSnapshot().messages[0].text,"history");}
 finally{client.close();}
});

test("grant pagination discards pages from a changed revision and restarts",async()=>{
 const {a,store}=await seeded(),key=await newEpochKey(),epoch=crypto.randomUUID(),base=view(a.identity,epoch);
 await store.putEpoch("a",epoch,key);let calls=0;
 const client=new ChatClient("a",async(e,p:any)=>{
  if(e==="keys:get")return {identity:server(a)};if(e==="register")return {};
  if(e==="state"){calls++;return {...base,revision:calls===1?1:2,nextWrapCursor:calls===1?"b".repeat(64):null};}
  if(e==="history")return {messages:[],nextCursor:null};throw new Error(e);
 },store,Date.now,openMessage,store.budget);
 try{await client.start();assert.equal(calls,3);assert.equal(client.getSnapshot().phase,"ready");}finally{client.close();}
});

test("removed sender immutable binding uses durable pin and historical messages survive reopening",async()=>{
 const {a,store}=await seeded(),b=await createIdentity("b",0),key=await newEpochKey(),epoch=crypto.randomUUID();
 await store.putPin("a","b",{...device(b.identity),known:[b.identity.signPublic]});
 const grant=await wire(b.identity,"b",a.identity,epoch,key),message=await makeMessage(b.identity,"b",epoch,key);
 const transport=async(e:string)=>{
  if(e==="keys:get")return {identity:server(a)};if(e==="register")return {};
  if(e==="state")return {...view(a.identity,epoch),wraps:[grant]};
  if(e==="history")return {messages:[message],nextCursor:null};throw new Error(e);
 };
 for(let n=0;n<2;n++){
  const c=new ChatClient("a",transport,store,Date.now,openMessage,store.budget);
  try{await c.start();assert.equal(c.getSnapshot().messages[0].status,"ok");assert.equal(c.getSnapshot().messages[0].text,"history");}finally{c.close();}
 }
});

test("untrusted historical wrap waits for deliberate fingerprint approval, not server-only TOFU",async()=>{
 const {a,store}=await seeded(),b=await createIdentity("b",0),key=await newEpochKey(),epoch=crypto.randomUUID();
 const grant=await wire(b.identity,"b",a.identity,epoch,key),message=await makeMessage(b.identity,"b",epoch,key);
 const c=new ChatClient("a",async(e:string)=>{
  if(e==="keys:get")return {identity:server(a)};if(e==="register")return {};
  if(e==="state")return {...view(a.identity,epoch),wraps:[grant]};
  if(e==="history")return {messages:[message],nextCursor:null};throw new Error(e);
 },store,Date.now,openMessage,store.budget);
 try{
  await c.start();assert.equal(c.getSnapshot().phase,"waiting");assert.equal(store.epochs.size,0);
  const candidate=c.getSnapshot().members.find(m=>m.userId==="b"&&m.historical)!;assert.ok(candidate.changed);
  await c.trust("b",candidate.fingerprint);assert.equal(c.getSnapshot().messages[0].text,"history");
 }finally{c.close();}
});

test("message-only historical signing key needs explicit approval without authorizing DH wraps",async()=>{
 const {a,store}=await seeded(),b=await createIdentity("b",0),key=await newEpochKey(),epoch=crypto.randomUUID();
 await store.putEpoch("a",epoch,key);const message=await makeMessage(b.identity,"b",epoch,key);
 const c=new ChatClient("a",async(e:string)=>{
  if(e==="keys:get")return {identity:server(a)};if(e==="register")return {};
  if(e==="state")return view(a.identity,epoch);
  if(e==="history")return {messages:[message],nextCursor:null};throw new Error(e);
 },store,Date.now,openMessage,store.budget);
 try{
  await c.start();assert.equal(c.getSnapshot().messages[0].status,"keychanged");
  const candidate=c.getSnapshot().members.find(m=>m.historical)!;
  await c.trust("b",candidate.fingerprint);assert.equal(c.getSnapshot().messages[0].status,"ok");
  assert.equal((await store.getPin("a","b"))!.bindings!.length,0);
 }finally{c.close();}
});

test("bootstrap persists key plus exact envelope before activation; reload retries identical bytes",async()=>{
 const {a,store}=await seeded(),epoch=crypto.randomUUID(),base={...view(a.identity,epoch),status:"unclaimed",owner:null as {userId:string;deviceId:string}|null};
 let activate=0;const envelopes:unknown[]=[];
 const transport=async(e:string,p:any)=>{
  if(e==="keys:get")return {identity:server(a)};if(e==="register")return {};
  if(e==="state")return base;
  if(e==="claim"){base.status="claimed";base.owner={userId:"a",deviceId:a.identity.deviceId};return base;}
  if(e==="wrap"){
   assert.ok(await store.getEpoch("a",epoch));assert.deepEqual(await store.getBootstrap("a",epoch),p);
   envelopes.push(structuredClone(p));activate++;if(activate===1)throw new Error("timeout");
   base.status="active";return {};
  }
  if(e==="history")return {messages:[],nextCursor:null};throw new Error(e);
 };
 const first=new ChatClient("a",transport,store,Date.now,openMessage,store.budget);await first.start();first.close();
 const next=new ChatClient("a",transport,store,Date.now,openMessage,store.budget);
 try{await next.start();assert.equal(next.getSnapshot().phase,"ready");assert.deepEqual(envelopes[0],envelopes[1]);assert.equal(await store.getBootstrap("a",epoch),undefined);}
 finally{next.close();}
});

test("committed activation with lost ACK and membership addition recovers authoritative self-envelope",async()=>{
 const {a,store}=await seeded(),epoch=crypto.randomUUID(),base={...view(a.identity,epoch),status:"unclaimed"};
 let wraps=0;
 const c=new ChatClient("a",async(e:string,p:any)=>{
  if(e==="keys:get")return {identity:server(a)};if(e==="register")return {};
  if(e==="state")return base;
  if(e==="claim"){base.status="claimed";return base;}
  if(e==="wrap"){wraps++;base.status="active";base.revision++;base.wraps=[{...p,senderUserId:"a",senderDhPublic:a.identity.dhPublic,senderSignPublic:a.identity.signPublic}];throw new Error("timeout");}
  if(e==="history")return {messages:[],nextCursor:null};throw new Error(e);
 },store,Date.now,openMessage,store.budget);
 try{await c.start();assert.equal(c.getSnapshot().phase,"ready");assert.equal(wraps,1);assert.equal(await store.getBootstrap("a",epoch),undefined);}
 finally{c.close();}
});

test("send committed with lost ACK retries identical signed payload exactly once",async()=>{
 const {a,store}=await seeded(),epoch=crypto.randomUUID(),key=await newEpochKey();await store.putEpoch("a",epoch,key);
 let committed:WireMessage|undefined;const sends:any[]=[];
 const c=new ChatClient("a",async(e:string,p:any)=>{
  if(e==="keys:get")return {identity:server(a)};if(e==="register")return {};
  if(e==="state")return view(a.identity,epoch);
  if(e==="history")return {messages:[],nextCursor:null};
  if(e==="send"){
   sends.push(structuredClone(p));
   if(!committed){committed={...p,senderUserId:"a",senderSignPublic:a.identity.signPublic,serverTs:1,cursor:1};throw new Error("timeout");}
   assert.deepEqual(p,sends[0]);return {message:committed};
  }
  throw new Error(e);
 },store,Date.now,openMessage,store.budget);
 try{
  await c.start();assert.equal(await c.send("one message"),false);const failed=c.getSnapshot().messages[0];
  assert.equal(failed.status,"failed");assert.equal(await c.retry(failed),true);
  assert.equal(sends.length,2);assert.deepEqual(sends[0],sends[1]);assert.equal(c.getSnapshot().messages.length,1);assert.equal(c.getSnapshot().messages[0].status,"ok");
 }finally{c.close();}
});

test("history echo reconciles ambiguous send without a failed duplicate overlay",async()=>{
 const {a,store}=await seeded(),epoch=crypto.randomUUID(),key=await newEpochKey();await store.putEpoch("a",epoch,key);
 let committed:WireMessage|undefined;
 const c=new ChatClient("a",async(e:string,p:any)=>{
  if(e==="keys:get")return {identity:server(a)};if(e==="register")return {};
  if(e==="state")return view(a.identity,epoch);
  if(e==="history")return {messages:committed?[committed]:[],nextCursor:null};
  if(e==="send"){committed={...p,senderUserId:"a",senderSignPublic:a.identity.signPublic,serverTs:1,cursor:1};throw new Error("timeout");}
  throw new Error(e);
 },store,Date.now,openMessage,store.budget);
 try{await c.start();await c.send("echo");await c.start();assert.equal(c.getSnapshot().messages.length,1);assert.equal(c.getSnapshot().messages[0].status,"ok");}
 finally{c.close();}
});

test("fingerprint-scoped current key approval works without conflating a historical binding",async()=>{
 const {a,store}=await seeded(),old=await createIdentity("b",0),next=await createIdentity("b",1),key=await newEpochKey(),epoch=crypto.randomUUID();
 await store.putEpoch("a",epoch,key);await store.putPin("a","b",{...device(old.identity),known:[old.identity.signPublic]});
 const message=await makeMessage(next.identity,"b",epoch,key);
 const current={...device(next.identity),fingerprint:"new-current-fingerprint"};
 const base={...view(a.identity,epoch),members:[{userId:"a",devices:[device(a.identity)]},{userId:"b",devices:[current]}]};
 const c=new ChatClient("a",async(e:string)=>{
  if(e==="keys:get")return {identity:server(a)};if(e==="register")return {};
  if(e==="state")return base;if(e==="wrap")return {};
  if(e==="history")return {messages:[message],nextCursor:null};throw new Error(e);
 },store,Date.now,openMessage,store.budget);
 try{
  await c.start();assert.equal(c.getSnapshot().messages[0].status,"keychanged");
  assert.equal(c.getSnapshot().members.filter(m=>m.historical).length,0);
  await c.trust("b",current.fingerprint);assert.equal(c.getSnapshot().messages[0].status,"ok");
  assert.equal(c.getSnapshot().members.find(m=>m.userId==="b")!.changed,false);
  assert.equal((await store.getPin("a","b"))!.deviceId,next.identity.deviceId);
  assert.ok((await store.getPin("a","b"))!.bindings!.some(b=>b.signPublic===old.identity.signPublic&&b.dhPublic===old.identity.dhPublic));
 }finally{c.close();}
});

test("an ambiguous send followed by stale retry never creates a different ciphertext for that id",async()=>{
 const {a,store}=await seeded(),epoch=crypto.randomUUID(),key=await newEpochKey();await store.putEpoch("a",epoch,key);
 const sends:any[]=[];let revision=1;
 const c=new ChatClient("a",async(e:string,p:any)=>{
  if(e==="keys:get")return {identity:server(a)};if(e==="register")return {};
  if(e==="state")return {...view(a.identity,epoch),revision};
  if(e==="history")return {messages:[],nextCursor:null};
  if(e==="send"){sends.push(structuredClone(p));if(sends.length===1){revision++;throw new Error("timeout");}throw new Error("stale_revision");}
  throw new Error(e);
 },store,Date.now,openMessage,store.budget);
 try{
  await c.start();await c.send("ambiguous");assert.equal(await c.retry(c.getSnapshot().messages[0]),false);
  assert.equal(sends.length,2);assert.deepEqual(sends[0],sends[1]);
 }finally{c.close();}
});


test("durable outbound ciphertext survives a new client and retries exact bytes",async()=>{
 const {a,store}=await seeded(),epoch=crypto.randomUUID(),key=await newEpochKey();await store.putEpoch("a",epoch,key);
 const sends:any[]=[];let delivered=false;
 const transport=async(e:string,p:any):Promise<any>=>{
  if(e==="keys:get")return {identity:server(a)};if(e==="register")return {};
  if(e==="state")return view(a.identity,epoch);
  if(e==="history")return {messages:[],nextCursor:null};
  if(e==="send"){
   assert.deepEqual((await store.getPending("a"))[0],p);
   sends.push(structuredClone(p));if(!delivered)throw Error("timeout");
   return {message:{...p,senderUserId:"a",senderSignPublic:a.identity.signPublic,serverTs:1,cursor:1}};
  }throw Error(e);
 };
 const first=new ChatClient("a",transport,store,Date.now,openMessage,store.budget);await first.start();await first.send("durable private canary");first.close();
 assert.equal(JSON.stringify(await store.getPending("a")).includes("durable private canary"),false);
 const next=new ChatClient("a",transport,store,Date.now,openMessage,store.budget);
 try{
  await next.start();assert.equal(next.getSnapshot().messages[0].text,"durable private canary");
  delivered=true;assert.equal(await next.retry(next.getSnapshot().messages[0]),true);
  assert.deepEqual(sends[0],sends[1]);assert.equal((await store.getPending("a")).length,0);
 }finally{next.close();}
});
test("concurrent starts share one synchronization",async()=>{
 const {a,store}=await seeded(),epoch=crypto.randomUUID(),key=await newEpochKey();await store.putEpoch("a",epoch,key);let gets=0;
 const c=new ChatClient("a",async(e:string)=>{
  if(e==="keys:get"){gets++;return {identity:server(a)};}if(e==="register")return {};
  if(e==="state")return view(a.identity,epoch);if(e==="history")return {messages:[],nextCursor:null};throw Error(e);
 },store,Date.now,openMessage,store.budget);
 try{await Promise.all(Array.from({length:30},()=>c.start()));assert.equal(gets,1);}finally{c.close();}
});

test("failed durable write never emits or displays an accepted pending message",async()=>{
 const {a,store}=await seeded(),epoch=crypto.randomUUID(),key=await newEpochKey();await store.putEpoch("a",epoch,key);let sends=0;
 store.putPending=async()=>{throw Error("quota");};
 const c=new ChatClient("a",async(e:string)=>{
  if(e==="keys:get")return {identity:server(a)};if(e==="register")return {};
  if(e==="state")return view(a.identity,epoch);if(e==="history")return {messages:[],nextCursor:null};
  if(e==="send")sends++;throw Error(e);
 },store,Date.now,openMessage,store.budget);
 try{await c.start();assert.equal(await c.send("not stored"),false);assert.equal(sends,0);assert.equal(c.getSnapshot().messages.length,0);}finally{c.close();}
});
test("pending restoration rejects tampering and foreign device without sending",async()=>{
 const {a,store}=await seeded(),epoch=crypto.randomUUID(),key=await newEpochKey();await store.putEpoch("a",epoch,key);
 const good=await sealMessage(a.identity,"a",{revision:1,epoch,id:crypto.randomUUID(),ts:Date.now()},"verified",key);
 const foreign=await createIdentity("a",1);
 await store.putPending("a",{...good,id:crypto.randomUUID()});
 await store.putPending("a",await sealMessage(foreign.identity,"a",{revision:1,epoch,id:crypto.randomUUID(),ts:Date.now()},"foreign",key));
 await store.putPending("other",good);let sends=0;
 const c=new ChatClient("a",async(e:string)=>{
  if(e==="keys:get")return {identity:server(a)};if(e==="register")return {};
  if(e==="state")return view(a.identity,epoch);if(e==="history")return {messages:[],nextCursor:null};
  if(e==="send")sends++;throw Error(e);
 },store,Date.now,openMessage,store.budget);
 try{await c.start();assert.equal(c.getSnapshot().messages.length,0);assert.equal(sends,0);}finally{c.close();}
});
test("reload reconciles a committed history echo without retrying the outbound envelope",async()=>{
 const {a,store}=await seeded(),epoch=crypto.randomUUID(),key=await newEpochKey();await store.putEpoch("a",epoch,key);
 const payload=await sealMessage(a.identity,"a",{revision:1,epoch,id:crypto.randomUUID(),ts:Date.now()},"committed",key);
 await store.putPending("a",payload);
 const c=new ChatClient("a",async(e:string)=>{
  if(e==="keys:get")return {identity:server(a)};if(e==="register")return {};
  if(e==="state")return view(a.identity,epoch);
  if(e==="history")return {messages:[{...payload,senderUserId:"a",senderSignPublic:a.identity.signPublic,serverTs:1,cursor:1}],nextCursor:null};
  throw Error(e);
 },store,Date.now,openMessage,store.budget);
 try{await c.start();assert.equal((await store.getPending("a")).length,0);assert.equal(c.getSnapshot().messages[0].status,"ok");}finally{c.close();}
});

test("actual client remounts and state-driven starts cannot reset a rate-limit budget",async()=>{
 let clock=1,calls=0;const budget=createRequestBudget(()=>clock,()=>0),store=new MemoryStore();
 const transport=async()=>{calls++;return {ok:false,error:"rate_limited",retryAfter:2,retryAfterUnit:"seconds"};};
 const make=()=>new ChatClient("bounded-remount",transport,store,()=>clock,openMessage,budget);
 for(let n=0;n<4;n++){
  const c=make();await c.start();c.close();assert.equal(calls,n+1);
  const remounted=make();
  for(let j=0;j<30;j++)await remounted.start();
  assert.equal(calls,n+1);remounted.close();clock=budget.status("bounded-remount").until;
 }
 const stopped=make();clock+=100000;
 for(let i=0;i<50;i++)await stopped.start();
 assert.equal(calls,4);assert.equal(stopped.getSnapshot().error,"sync_incomplete");stopped.close();
});

test("rapid socket reconnects preserve account exponential attempts and terminal stop",async()=>{
 let clock=1,calls=0;const budget=createRequestBudget(()=>clock,()=>0),store=new MemoryStore();
 const transport=async()=>{calls++;return {ok:false,error:"rate_limited",retryAfterMs:0};};
 const c=new ChatClient("rapid",transport,store,()=>clock,openMessage,budget);
 for(let attempt=0;attempt<4;attempt++){
  await c.reconnect();
  for(let n=0;n<100;n++)await c.reconnect();
  assert.equal(calls,attempt+1);
  assert.equal(budget.status("rapid").failures,attempt+1);
  assert.equal(budget.status("rapid").until-clock,1000*2**attempt);
  clock=budget.status("rapid").until;
 }
 clock+=100000;
 for(let n=0;n<100;n++)await c.reconnect();
 assert.equal(calls,4);assert.equal(c.getSnapshot().error,"sync_incomplete");
 await c.retrySync();assert.equal(calls,5);c.close();
});

test("pre-ACK start storm and already queued sync jobs cannot ACK-pace a rate-limit cascade, including remount",async()=>{
 let clock=60001,calls=0,inflight=0,peak=0;
 let acknowledge!:(value:any)=>void,entered!:()=>void;
 const began=new Promise<void>(resolve=>{entered=resolve;});
 const ack=new Promise<any>(resolve=>{acknowledge=resolve;});
 const budget=createRequestBudget(()=>clock,()=>0),store=new MemoryStore();
 const transport=async()=>{
  calls++;inflight++;peak=Math.max(peak,inflight);entered();
  try{return calls===1?await ack:{ok:false,error:"rate_limited"};}
  finally{inflight--;}
 };
 const make=()=>new ChatClient("queued-storm",transport,store,()=>clock,openMessage,budget);
 const original=make(),remounted=make();
 try{
  const first=original.start();await began;
  const storm=Array.from({length:100},()=>original.start());
  assert.ok(storm.every(p=>p===first),"pre-ACK starts share the same queued job");
  // Seed legacy-style work already on the serial chain. Each execution must recheck
  // cooldown, even though these jobs were admitted before the negative ACK arrived.
  const queued=Array.from({length:100},()=>(original as any).run(()=>(original as any).sync()));
  await Promise.all(Array.from({length:100},()=>remounted.start()));
  assert.equal(calls,1);assert.equal(peak,1);
  acknowledge({ok:false,error:"rate_limited"});
  await Promise.all([first,...storm,...queued]);
  assert.equal(calls,1,"draining already queued jobs emits no follow-up keys:get");
  assert.equal(budget.status("queued-storm").until,120250);
  original.close();
  for(const time of [60002,119999,120249]){
   clock=time;
   await Promise.all(Array.from({length:100},()=>remounted.start()));
   assert.equal(calls,1,"remount cannot bypass any part of cooldown");
  }
  clock=120250;
  await Promise.all(Array.from({length:100},()=>remounted.start()));
  assert.equal(calls,2);assert.equal(peak,1);
  assert.equal(budget.status("queued-storm").failures,2);
 }finally{original.close();remounted.close();}
});

test("createIdentity rejects when a server or local identity exists; dock has no reset UI",async()=>{
 const {readFileSync}=await import("node:fs");
 const {a,store}=await seeded();
 const c=new ChatClient("a",async()=>({identity:null}),store,Date.now,openMessage,store.budget);
 try{await c.createIdentity();assert.equal(c.getSnapshot().error,"identity_exists");assert.notEqual(c.getSnapshot().phase,"words");}finally{c.close();}
 const src=readFileSync(new URL("../app/chat-dock.tsx",import.meta.url),"utf8");
 assert.doesNotMatch(src,/resetIdentity|Reset my chat keys|lost my recovery/i);
});

// Local removal must not become a second send route, even with stale UI/reconnect snapshots.
async function removalFixture(){
 const {a,store}=await seeded(),epoch=crypto.randomUUID(),key=await newEpochKey();
 await store.putEpoch("a",epoch,key);
 const events:string[]=[],posted:WireMessage[]=[];
 let fail=true,hold:(()=>Promise<void>)|undefined;
 const client=new ChatClient("a",async(e:string,p:any)=>{
  events.push(e);
  if(e==="keys:get")return {identity:server(a)};if(e==="register")return {};
  if(e==="state")return view(a.identity,epoch);
  if(e==="history")return {messages:posted,nextCursor:null};
  if(e==="send"){
   if(hold)await hold();
   if(fail)throw Error("timeout");
   const message={...p,senderUserId:"a",senderSignPublic:a.identity.signPublic,serverTs:Date.now(),cursor:posted.length+1};
   posted.push(message);return {message};
  }throw Error(e);
 },store,Date.now,openMessage,store.budget);
 await client.start();
 return {client,store,events,posted,setFail:(v:boolean)=>{fail=v;},setHold:(v:typeof hold)=>{hold=v;}};
}
test("remove deletes only targeted failed local envelope, never emits, survives reload and stale retries",async()=>{
 const f=await removalFixture(),{client,store,events}=f;
 try{
  await client.send("remove me");await client.send("keep me");
  const [remove,keep]=client.getSnapshot().messages;
  const other=(await store.getPending("a"))[0];await store.putPending("other",other);
  const before=events.length;
  assert.equal(await client.dismiss(remove),true);
  assert.equal(events.length,before,"removal has no network requests");
  assert.equal(await client.retry(remove),false);
  assert.equal(await client.send(remove.text!,remove.id),false);
  assert.equal(events.length,before,"stale retry cannot emit or recreate");
  assert.deepEqual((await store.getPending("a")).map(p=>p.id),[keep.id]);
  assert.equal((await store.getPending("other")).length,1);
  await client.start();
  assert.deepEqual(client.getSnapshot().messages.map(m=>m.id),[keep.id]);
  f.setFail(false);assert.equal(await client.retry(keep),true);
  const posted=client.getSnapshot().messages[0],n=events.length;
  assert.equal(await client.dismiss(posted),false);
  assert.equal(events.length,n);assert.equal(f.posted.length,1);
 }finally{client.close();}
});
test("remove claims before durable delete, blocks racing retry and duplicate removal; delete failure retains retry",async()=>{
 const f=await removalFixture(),{client,store,events}=f;
 try{
  await client.send("keep until committed");const m=client.getSnapshot().messages[0];
  const original=store.deletePending;let release!:()=>void;
  store.deletePending=async()=>{await new Promise<void>(r=>{release=r;});throw Error("quota");};
  const removed=client.dismiss(m),n=events.length;
  assert.equal(await client.retry(m),false);assert.equal(await client.dismiss(m),false);
  // A serialized chain barrier confirms the storage transaction has started.
  await new Promise(r=>setImmediate(r));release();
  assert.equal(await removed,false);assert.equal(events.length,n);
  assert.equal((await store.getPending("a")).length,1);
  assert.equal(client.getSnapshot().messages[0].status,"failed");
  store.deletePending=original;f.setFail(false);
  assert.equal(await client.retry(m),true);
 }finally{client.close();}
});
test("active retry cannot be removed or duplicated and an already acknowledged message stays posted",async()=>{
 const f=await removalFixture(),{client}=f;
 try{
  await client.send("in flight");const m=client.getSnapshot().messages[0];
  let entered!:()=>void,release!:()=>void;
  const began=new Promise<void>(r=>{entered=r;});
  f.setFail(false);f.setHold(async()=>{entered();await new Promise<void>(r=>{release=r;});});
  const retried=client.retry(m);await began;
  assert.equal(await client.dismiss(m),false);
  assert.equal(await client.retry(m),false);
  release();assert.equal(await retried,true);
  assert.equal(await client.dismiss(m),false);
  assert.equal(client.getSnapshot().messages[0].status,"ok");
  assert.equal(f.posted.length,1);
 }finally{client.close();}
});
test("reconnect queued before removal cannot resurrect a failed envelope",async()=>{
 const f=await removalFixture(),{client,events,store}=f;
 try{
  await client.send("queued reconnect");const m=client.getSnapshot().messages[0];
  const before=events.filter(e=>e==="send").length;
  const reconnect=client.reconnect(),remove=client.dismiss(m);
  await Promise.all([reconnect,remove]);
  assert.equal(events.filter(e=>e==="send").length,before);
  assert.equal((await store.getPending("a")).length,0);
  assert.equal(client.getSnapshot().messages.length,0);
 }finally{client.close();}
});
test("removal during pending-row decryption cannot restore or retry the captured row",async()=>{
 const f=await removalFixture(),{client,store,events}=f;
 try{
  await client.send("restoration race");const m=client.getSnapshot().messages[0];
  const original=(client as any).open;let entered!:()=>void,release!:()=>void;
  const began=new Promise<void>(r=>{entered=r;});
  (client as any).open=async(...args:any[])=>{entered();await new Promise<void>(r=>{release=r;});return original(...args);};
  const sync=client.start();await began;
  const remove=client.dismiss(m),before=events.filter(e=>e==="send").length;
  release();await Promise.all([sync,remove]);
  assert.equal(client.getSnapshot().messages.length,0);
  assert.equal((await store.getPending("a")).length,0);
  assert.equal(await client.retry(m),false);
  assert.equal(events.filter(e=>e==="send").length,before);
 }finally{client.close();}
});

test('admin reset clears cached identity and old outbox, requires fresh words and correct version',async()=>{
 const {a,store}=await seeded();let reset=false,puts=0;
 const originalClear=store.clearIdentity;store.clearIdentity=async u=>{await originalClear(u);store.pending.clear();store.setups.delete(u);};
 const transport=async(e:string,p:any)=>{
  if(e==='keys:get')return reset?{identity:null,expectedVersion:2,resetRequired:true}:{identity:server(a)};
  if(e==='register')return {};
  if(e==='state')return {...view(a.identity,crypto.randomUUID()),status:'active'};
  if(e==='keys:put'){puts++;throw Error('unexpected old publication');}
  return {messages:[],nextCursor:null};
 };
 const c=new ChatClient('a',transport,store,Date.now,openMessage,store.budget);
 try{
  await c.start();await store.putPending('a',{id:'old-envelope'} as any);reset=true;await c.start();
  assert.equal(c.getSnapshot().phase,'setup');assert.equal(c.getSnapshot().error,'admin_reset');
  assert.equal(await store.getIdentity('a'),undefined);assert.equal((await store.getPending('a')).length,0);assert.deepEqual(c.getSnapshot().messages,[]);
  await c.createIdentity();assert.equal(c.getSnapshot().phase,'words');
  const next=(await store.getSetup('a'))!;assert.equal(next.body.expectedVersion,2);assert.equal(next.body.keyVersion,3);assert.notEqual(next.identity.deviceId,a.identity.deviceId);assert.equal(puts,0);
 }finally{c.close();}
});

test('admin reset while words are displayed discards stale setup rather than publishing it',async()=>{
 const store=new MemoryStore();let version=0,puts=0;
 const c=new ChatClient('a',async e=>{if(e==='keys:get')return {identity:null,expectedVersion:version,resetRequired:version>0};if(e==='keys:put')puts++;return {};},store,Date.now,openMessage,store.budget);
 try{
  await c.start();await c.createIdentity();const first=(await store.getSetup('a'))!;
  assert.equal(c.getSnapshot().phase,'words');version=2;await c.start();
  assert.equal(c.getSnapshot().phase,'setup');assert.equal(c.getSnapshot().words,null);assert.equal(await store.getSetup('a'),undefined);assert.equal(puts,0);
  await c.createIdentity();await c.start();assert.equal(c.getSnapshot().phase,'words','a staged setup for the current reset generation must survive sync');
  assert.notEqual((await store.getSetup('a'))!.identity.deviceId,first.identity.deviceId);
 }finally{c.close();}
});

test("transient bootstrap contention is visible instead of remaining Connecting forever",async()=>{
 for(const code of ["stale_revision","busy"]){
  const store=new MemoryStore();let contended=true,calls=0;
  const client=new ChatClient("bootstrap-contention",async()=>{
   calls++;if(contended)throw Error(code);return {identity:null};
  },store,Date.now,openMessage,store.budget);
  try{
   await client.start();
   assert.equal(client.getSnapshot().phase,"waiting",code);
   assert.equal(client.getSnapshot().error,"sync_retry",code);
   // Repeated recoverable rejection must not reset to an unexplained loading state.
   await client.start();assert.equal(client.getSnapshot().phase,"waiting");
   contended=false;await client.start();
   assert.equal(calls,3);assert.equal(client.getSnapshot().phase,"setup");
   assert.equal(client.getSnapshot().error,null);
  }finally{client.close();}
 }
});

test("a remount during an account cooldown shows why chat is waiting without another request",async()=>{
 let clock=1,calls=0;const budget=createRequestBudget(()=>clock,()=>0),store=new MemoryStore();
 await assert.rejects(budget.request("cooldown-remount","keys:get",{},async()=>{
  throw Object.assign(Error("rate_limited"),{retryAfterMs:30000});
 }));
 const client=new ChatClient("cooldown-remount",async()=>{calls++;return {identity:null};},store,()=>clock,openMessage,budget);
 try{
  await client.start();assert.equal(calls,0);
  assert.equal(client.getSnapshot().phase,"waiting");
  assert.equal(client.getSnapshot().error,"rate_limited");
  clock=30001;await client.start();assert.equal(calls,1);
  assert.equal(client.getSnapshot().phase,"setup");
 }finally{client.close();}
});

test("keys:get occupied-account rejection is not a recovery prompt and preserves all local data",async()=>{
 const {a,store}=await seeded(),epoch=crypto.randomUUID(),key=await newEpochKey();
 await store.putEpoch("a",epoch,key);await store.putPending("a",{id:"preserved-envelope"} as any);
 const before=await store.getIdentity("a"),events:string[]=[];
 const c=new ChatClient("a",async e=>{events.push(e);return {ok:false,error:"identity_exists"};},store,Date.now,openMessage,store.budget);
 try{
  await c.start();assert.equal(c.getSnapshot().phase,"error");assert.equal(c.getSnapshot().error,"identity_inconsistent");
  await c.recover("not a real recovery phrase here");
  assert.deepEqual(events,["keys:get"]);assert.equal(await store.getIdentity("a"),before);
  assert.equal(await store.getEpoch("a",epoch),key);assert.equal((await store.getPending("a"))[0].id,"preserved-envelope");
 }finally{c.close();}
});

test("valid authoritative backup offers recovery and correct words unlock retained encrypted history",async()=>{
 const a=await createIdentity("a",0),store=new MemoryStore(),epoch=crypto.randomUUID(),key=await newEpochKey();
 const grant=await wire(a.identity,"a",a.identity,epoch,key),message=await makeMessage(a.identity,"a",epoch,key);
 const c=new ChatClient("a",async e=>{
  if(e==="keys:get")return {identity:server(a)};
  if(e==="register")return {};
  if(e==="state")return {...view(a.identity,epoch),wraps:[grant]};
  if(e==="history")return {messages:[message],nextCursor:null};
  throw Error("unexpected "+e);
 },store,Date.now,openMessage,store.budget);
 try{
  await c.start();assert.equal(c.getSnapshot().phase,"recover");
  await c.recover("bad");assert.equal(c.getSnapshot().phase,"recover");assert.equal(c.getSnapshot().error,"bad_words");
  await c.recover(a.words.join(" "));assert.equal(c.getSnapshot().phase,"ready");
  assert.equal(c.getSnapshot().messages[0].text,"history");assert.equal((await store.getIdentity("a"))!.deviceId,a.identity.deviceId);
 }finally{c.close();}
});

test("a failed refreshed keys:get never leaves a stale server backup available for recovery",async()=>{
 const a=await createIdentity("a",0),store=new MemoryStore();let broken=false;
 const c=new ChatClient("a",async()=>broken?{ok:false,error:"identity_exists"}:{identity:server(a)},store,Date.now,openMessage,store.budget);
 try{
  await c.start();assert.equal(c.getSnapshot().phase,"recover");
  broken=true;await c.start();await c.recover(a.words.join(" "));
  assert.equal(c.getSnapshot().phase,"error");assert.equal(await store.getIdentity("a"),undefined);
 }finally{c.close();}
});
