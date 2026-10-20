import {test} from "node:test";
import assert from "node:assert/strict";
import {ChatClient,type BootstrapPayload,type ChatStore,type Pin,type Setup} from "../lib/chat-client";
import {createIdentity,makeWrap,newEpochKey,sealMessage,type Identity,type WireMessage,type WireWrap,type ServerIdentity} from "../lib/chat-crypto";

class MemoryStore implements ChatStore{
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
 const c=new ChatClient("a",transport,store);
 await c.start();await c.createIdentity();
 assert.equal(c.getSnapshot().phase,"words");assert.equal(requests.length,0);
 assert.equal((await store.getSetup("a"))!.identity.signPrivate.extractable,false);
 assert.equal(JSON.stringify(await store.getSetup("a")).includes(c.getSnapshot().words!.join(" ")),false);
 await c.confirmWords();c.close();
 assert.equal(requests.length,1);assert.equal((await store.getSetup("a"))!.confirmed,true);
 const resumed=new ChatClient("a",transport,store);
 try{await resumed.start();assert.equal(requests.length,2);assert.deepEqual(requests[0],requests[1]);assert.equal(await store.getSetup("a"),undefined);assert.equal((await store.getIdentity("a"))!.deviceId,active!.deviceId);}
 finally{resumed.close();}
});

test("reload before words confirmation offers recovery or explicit reset without publishing",async()=>{
 const store=new MemoryStore();let puts=0;
 const transport=async(e:string)=>{if(e==="keys:put")puts++;return {identity:null};};
 const c=new ChatClient("a",transport,store);await c.createIdentity();const words=c.getSnapshot().words!.join(" ");c.close();
 const resumed=new ChatClient("a",transport,store);
 try{
  await resumed.start();assert.equal(resumed.getSnapshot().phase,"recover");assert.equal(resumed.getSnapshot().error,"setup_words_lost");assert.equal(puts,0);
  assert.ok(words.length);await resumed.resetIdentity();assert.equal(await store.getSetup("a"),undefined);assert.equal(resumed.getSnapshot().phase,"setup");
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
 },store);
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
 },store);
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
  const c=new ChatClient("a",transport,store);
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
 },store);
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
 },store);
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
 const first=new ChatClient("a",transport,store);await first.start();first.close();
 const next=new ChatClient("a",transport,store);
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
 },store);
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
 },store);
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
 },store);
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
 },store);
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
 },store);
 try{
  await c.start();await c.send("ambiguous");assert.equal(await c.retry(c.getSnapshot().messages[0]),false);
  assert.equal(sends.length,2);assert.deepEqual(sends[0],sends[1]);
 }finally{c.close();}
});

test("throttled history retries, then exhaustion is non-ready, keeps cursors and recovers",async()=>{
 const {a,store}=await seeded(),key=await newEpochKey(),epochs=Array.from({length:40},()=>crypto.randomUUID());
 const grants=await Promise.all(epochs.map(e=>wire(a.identity,"a",a.identity,e,key)));
 const current=epochs[39],base=view(a.identity,current);
 const msgs=new Map(await Promise.all(epochs.map(async e=>[e,await makeMessage(a.identity,"a",e,key,"m-"+e)] as const)));
 const tries=new Map<string,number>();let blocked=new Set<string>(),retryAfter=0;
 const hist=new Map<string,number>();
 const client=new ChatClient("a",async(event,p:any)=>{
  if(event==="keys:get")return {identity:server(a)};
  if(event==="register")return {};
  if(event==="state")return {...base,wraps:grants,nextWrapCursor:null};
  if(event==="history"){
   hist.set(p.epoch,(hist.get(p.epoch)||0)+1);
   const n=(tries.get(p.epoch)||0)+1;tries.set(p.epoch,n);
   if(blocked.has(p.epoch)||(epochs.slice(0,4).includes(p.epoch)&&n===1))throw Object.assign(new Error("rate_limited"),{retryAfter});
   return {messages:[msgs.get(p.epoch)!],nextCursor:null};
  }
  throw new Error(event);
 },store);
 try{
  await client.start();
  let s=client.getSnapshot();assert.equal(s.phase,"ready");assert.equal(s.historyIncomplete,false);assert.equal(new Set(s.messages.map(m=>m.epoch)).size,40);
  client.close();
 }finally{client.close();}
 // exhaustion: server demands longer than the bounded budget, so no early retry and the client is NOT ready
 blocked=new Set(epochs.slice(0,5));retryAfter=120;hist.clear();
 const c2=new ChatClient("a",async(event,p:any)=>{
  if(event==="keys:get")return {identity:server(a)};
  if(event==="register")return {};
  if(event==="state")return {...base,wraps:grants,nextWrapCursor:null};
  if(event==="history"){hist.set(p.epoch,(hist.get(p.epoch)||0)+1);if(blocked.has(p.epoch))throw Object.assign(new Error("rate_limited"),{retryAfter});return {messages:[msgs.get(p.epoch)!],nextCursor:null};}
  throw new Error(event);
 },store);
 try{
  await c2.start();
  let s=c2.getSnapshot();assert.notEqual(s.phase,"ready");assert.equal(s.phase,"waiting");assert.equal(s.error,"history_incomplete");assert.equal(s.historyIncomplete,true);
  assert.equal(hist.get(epochs[0]),1,"must not retry before the server retryAfter");
  blocked=new Set();await c2.start();
  s=c2.getSnapshot();assert.equal(s.phase,"ready");assert.equal(s.historyIncomplete,false);assert.equal(new Set(s.messages.map(m=>m.epoch)).size,40);
 }finally{c2.close();}
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
 const first=new ChatClient("a",transport,store);await first.start();await first.send("durable private canary");first.close();
 assert.equal(JSON.stringify(await store.getPending("a")).includes("durable private canary"),false);
 const next=new ChatClient("a",transport,store);
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
 },store);
 try{await Promise.all(Array.from({length:30},()=>c.start()));assert.equal(gets,1);}finally{c.close();}
});

test("failed durable write never emits or displays an accepted pending message",async()=>{
 const {a,store}=await seeded(),epoch=crypto.randomUUID(),key=await newEpochKey();await store.putEpoch("a",epoch,key);let sends=0;
 store.putPending=async()=>{throw Error("quota");};
 const c=new ChatClient("a",async(e:string)=>{
  if(e==="keys:get")return {identity:server(a)};if(e==="register")return {};
  if(e==="state")return view(a.identity,epoch);if(e==="history")return {messages:[],nextCursor:null};
  if(e==="send")sends++;throw Error(e);
 },store);
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
 },store);
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
 },store);
 try{await c.start();assert.equal((await store.getPending("a")).length,0);assert.equal(c.getSnapshot().messages[0].status,"ok");}finally{c.close();}
});
