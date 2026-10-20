// TableTalk client state machine. Pure logic with injected transport and key store so the same code
// runs in the browser (socket.io + IndexedDB) and in Node tests against the real chat service.
import {createIdentity,newEpochKey,makeWrap,openMessage,openWrap,registerData,restoreIdentity,sealMessage,sha256Hex,signText,MAX_TEXT_BYTES,bundleFingerprint,type Identity,type ServerIdentity,type WireMessage,type WireWrap} from "./chat-crypto";

type Binding={deviceId:string;signPublic:string;dhPublic:string};
export type Pin=Binding&{known:string[];bindings?:Binding[]};
export type Setup={identity:Identity;body:Awaited<ReturnType<typeof createIdentity>>["body"];confirmed:boolean};
export type SendPayload=Awaited<ReturnType<typeof sealMessage>>;
export type BootstrapPayload=Awaited<ReturnType<typeof makeWrap>>;
export interface ChatStore{
 getIdentity(user:string):Promise<Identity|undefined>;putIdentity(user:string,identity:Identity):Promise<void>;clearIdentity(user:string):Promise<void>;
 getEpoch(user:string,epoch:string):Promise<CryptoKey|undefined>;putEpoch(user:string,epoch:string,key:CryptoKey):Promise<void>;
 getSetup(user:string):Promise<Setup|undefined>;putSetup(user:string,setup:Setup):Promise<void>;clearSetup(user:string):Promise<void>;
 getBootstrap(user:string,epoch:string):Promise<BootstrapPayload|undefined>;putBootstrap(user:string,epoch:string,key:CryptoKey,wrap:BootstrapPayload):Promise<void>;clearBootstrap(user:string,epoch:string):Promise<void>;
 getPin(user:string,other:string):Promise<Pin|undefined>;putPin(user:string,other:string,pin:Pin):Promise<void>;
}
export type Transport=(event:string,payload:unknown)=>Promise<any>;
export type Phase="loading"|"setup"|"words"|"recover"|"waiting"|"ready"|"error";
export type MessageStatus="ok"|"pending"|"failed"|"unverified"|"keychanged"|"undecryptable";
export type ChatMessage={key:string;id:string;senderUserId:string;publicId:string;mine:boolean;ts:number;serverTs:number;cursor:number;epoch:string;text:string|null;status:MessageStatus};
export type ChatMember={userId:string;publicId:string;mine:boolean;fingerprint:string;changed:boolean;historical?:boolean};
export type Snapshot={phase:Phase;error:string|null;words:string[]|null;messages:ChatMessage[];members:ChatMember[];hasMore:boolean;busy:boolean;historyIncomplete:boolean};
type Device={deviceId:string;dhPublic:string;signPublic:string;fingerprint:string};
type View={revision:number;epoch:string;status:"unclaimed"|"claimed"|"active";owner:{userId:string;deviceId:string}|null;leaseUntil:number;members:{userId:string;devices:Device[]}[];wraps?:WireWrap[];nextWrapCursor?:string|null};
const codeOf=(e:unknown)=>e instanceof Error?e.message:"unavailable";
const PAGE=50,BACKOFF_MS=500,BUDGET_MS=30000,RESYNC_MS=15000;
/** Server-mandated wait in ms (retryAfter is seconds when small, else ms); absent means unspecified. */
const serverWait=(e:unknown)=>{const r=(e as {retryAfter?:number})?.retryAfter;return typeof r==="number"&&r>=0?(r<=120?r*1000:r):undefined;};
const sleep=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
export const RENDER_CAP=500,RENDER_TRIM=400,OPEN_CACHE_MAX=600;

export class ChatClient{
 private snap:Snapshot={phase:"loading",error:null,words:null,messages:[],members:[],hasMore:false,busy:false,historyIncomplete:false};
 private listeners=new Set<()=>void>();
 private identity:Identity|undefined;private serverIdentity:ServerIdentity|undefined;
 private registered=false;private chain:Promise<unknown>=Promise.resolve();private timer:ReturnType<typeof setTimeout>|undefined;private hintTimer:ReturnType<typeof setTimeout>|undefined;
 private keys=new Map<string,CryptoKey>();private attempted=new Set<string>();private cursors=new Map<string,number|null>();
 private raw=new Map<string,WireMessage>();private local=new Map<string,ChatMessage>();private shown=new Map<string,ChatMessage>();
 private changed=new Map<string,Device>();private publicIds=new Map<string,string>();private pins=new Map<string,Pin>();private lastView:View|undefined;
 private ambiguous=new Set<string>();private sealed=new Map<string,SendPayload>();private historical=new Map<string,Device>();
 private closed=false;
 private opened=new Map<string,{key:CryptoKey;res:Awaited<ReturnType<typeof openMessage>>}>();private inflight=new Map<string,Promise<Awaited<ReturnType<typeof openMessage>>>>();private windowStart=0;private extra=0;
 constructor(private user:string,private request:Transport,private store:ChatStore,private now:()=>number=Date.now,private open:typeof openMessage=openMessage){}
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
 getSnapshot=()=>this.snap;
 private set(patch:Partial<Snapshot>){this.snap={...this.snap,...patch};this.listeners.forEach(l=>l());}
 private run<T>(fn:()=>Promise<T>):Promise<T>{const next=this.chain.then(fn,fn);this.chain=next.catch(()=>{});return next;}
 close(){this.closed=true;clearTimeout(this.timer);clearTimeout(this.hintTimer);}
 /** Call on connect and whenever the server emits chat:changed (payload-free hint). */
 hint(){clearTimeout(this.hintTimer);this.hintTimer=setTimeout(()=>{void this.start();},150);}
 start=()=>this.run(()=>this.sync());
 private later(ms:number){clearTimeout(this.timer);if(!this.closed)this.timer=setTimeout(()=>{void this.start();},ms);}

 private clearSession(){
  this.keys.clear();this.attempted.clear();this.cursors.clear();this.raw.clear();this.local.clear();this.sealed.clear();this.ambiguous.clear();this.opened.clear();this.inflight.clear();this.windowStart=0;this.extra=0;
  this.lastView=undefined;this.set({messages:[],hasMore:false,historyIncomplete:false});
 }
 private async sync(){
  if(this.closed||this.snap.phase==="words")return;
  try{
   const setup=await this.store.getSetup(this.user);
   if(setup){
    if(!setup.confirmed){this.set({phase:"recover",error:"setup_words_lost"});return;}
    await this.publish(setup);
   }
   const {identity:server}=await this.request("keys:get",{v:1}) as {identity:ServerIdentity|null};
   let local=await this.store.getIdentity(this.user);
   if(!server){
    if(local){await this.store.clearIdentity(this.user);this.registered=false;}
    this.clearSession();this.identity=undefined;this.serverIdentity=undefined;this.set({phase:"setup",error:null});return;
   }
   if(!local||local.deviceId!==server.deviceId||local.keyVersion!==server.keyVersion||local.signPublic!==server.signPublic||local.dhPublic!==server.dhPublic){
    if(local){await this.store.clearIdentity(this.user);this.registered=false;}
    this.clearSession();this.identity=undefined;this.serverIdentity=server;this.set({phase:"recover",error:null});return;
   }
   this.identity=local;this.serverIdentity=server;
   if(!this.registered){
    await this.request("register",{v:1,deviceId:local.deviceId,dhPublic:local.dhPublic,signPublic:local.signPublic,signature:await signText(local.signPrivate,registerData(this.user,local))});
    this.registered=true;
   }
   await this.converge(local);
  }catch(e){this.fail(e);}
 }
 private fail(e:unknown){
  const code=codeOf(e);
  if(code==="waiting")return this.set({phase:"waiting",error:null}),this.later(4000);
  if(code==="stale_revision"||code==="busy"||code==="rate_limited")return this.later(code==="rate_limited"?15000:800);
  this.set({phase:"error",error:code});this.later(10000);
 }
 private async converge(me:Identity){
  let view=await this.readView();
  this.historical.clear();
  await this.syncPins(view);
  await this.unwrapAll(me,view);
  const have=()=>this.keys.has(view.epoch);
  if(!have()||view.status!=="active"){
   const stale=view.status==="claimed"&&view.leaseUntil<=this.now();
   const owned=view.owner?.userId===this.user&&view.owner.deviceId===me.deviceId;
   if(view.status==="unclaimed"||stale||(view.status==="claimed"&&owned))view=await this.bootstrap(me,view);
   else{this.set({phase:"waiting",error:null});this.later(view.status==="claimed"?Math.max(1500,view.leaseUntil-this.now()+500):4000);return;}
  }
  if(view.status!=="active"||!have()){this.set({phase:"waiting",error:null});this.later(3000);return;}
  this.lastView=view;
  await this.distribute(me,view);
  if(!await this.refresh(me,view))return;
  this.set({phase:"ready",error:null});
 }
 /** Enumerate retained grants, discarding mixed-revision pages rather than merging stale state. */
 private async readView():Promise<View>{
  for(let attempt=0;attempt<3;attempt++){
   const first=await this.request("state",{v:1}) as View;
   const wraps=new Map<string,WireWrap>();
   const add=(v:View)=>{for(const w of v.wraps||[])wraps.set(JSON.stringify([w.epoch,w.toUserId,w.toDeviceId]),w);};
   add(first);let cursor=first.nextWrapCursor;const seen=new Set<string>();let coherent=true;
   while(cursor){
    if(seen.has(cursor))throw new Error("bad_pagination");seen.add(cursor);
    const page=await this.request("state",{v:1,beforeWrap:cursor}) as View;
    if(page.revision!==first.revision||page.epoch!==first.epoch||page.status!==first.status){coherent=false;break;}
    add(page);cursor=page.nextWrapCursor;
   }
   if(coherent)return {...first,wraps:[...wraps.values()],nextWrapCursor:null};
  }
  throw new Error("stale_revision");
 }
 private async bootstrap(me:Identity,view:View){
  let pending=await this.store.getBootstrap(this.user,view.epoch);
  let claimed=view;
  if(!pending||view.owner?.userId!==this.user||view.owner.deviceId!==me.deviceId||view.leaseUntil<=this.now()){
   claimed=await this.request("claim",{v:1,revision:view.revision,epoch:view.epoch,deviceId:me.deviceId}) as View;
   pending=await this.store.getBootstrap(this.user,claimed.epoch);
  }
  if(!pending){
   const key=await newEpochKey();
   pending=await makeWrap(me,this.user,{revision:claimed.revision,epoch:claimed.epoch,toUserId:this.user,toDeviceId:me.deviceId},me.dhPublic,key);
   // This transaction completes BEFORE the server is allowed to activate the epoch.
   await this.store.putBootstrap(this.user,claimed.epoch,key,pending);
  }
  try{await this.request("wrap",pending);}
  catch(e){
   // An activation may have committed before its ACK was lost or membership advanced.
   const fresh=await this.readView();
   await this.syncPins(fresh);await this.unwrapAll(me,fresh);
   if(fresh.epoch===pending.epoch&&fresh.status==="active"&&this.keys.has(fresh.epoch)){
    await this.store.clearBootstrap(this.user,pending.epoch);return fresh;
   }
   // Definitive stale rejection permits a new envelope with the SAME persisted secret.
   if(codeOf(e)==="stale_revision"&&fresh.epoch===pending.epoch&&fresh.status==="claimed"&&fresh.owner?.userId===this.user&&fresh.owner.deviceId===me.deviceId){
    const key=await this.store.getEpoch(this.user,fresh.epoch);
    if(!key)throw new Error("waiting");
    const updated=await makeWrap(me,this.user,{revision:fresh.revision,epoch:fresh.epoch,toUserId:this.user,toDeviceId:me.deviceId},me.dhPublic,key);
    await this.store.putBootstrap(this.user,fresh.epoch,key,updated);
   }
   throw e;
  }
  const fresh=await this.readView();
  await this.syncPins(fresh);await this.unwrapAll(me,fresh);
  await this.store.clearBootstrap(this.user,pending.epoch);
  return fresh;
 }
 private async syncPins(view:View){
  this.changed.clear();
  for(const m of view.members){
   this.publicIds.set(m.userId,(await sha256Hex(m.userId)).slice(0,16));
   if(m.userId===this.user)continue;
   const d=m.devices[0];if(!d)continue;
   let pin=this.pins.get(m.userId)||await this.store.getPin(this.user,m.userId);
   if(!pin){pin={deviceId:d.deviceId,signPublic:d.signPublic,dhPublic:d.dhPublic,known:[d.signPublic]};await this.store.putPin(this.user,m.userId,pin);}
   this.pins.set(m.userId,pin);
   if(pin.signPublic!==d.signPublic||pin.deviceId!==d.deviceId||pin.dhPublic!==d.dhPublic)this.changed.set(m.userId,d);
  }
  this.publicIds.set(this.user,(await sha256Hex(this.user)).slice(0,16));
  this.set({members:view.members.map(m=>{
   const d=(this.changed.get(m.userId)||m.devices[0]);
   return {userId:m.userId,publicId:this.publicIds.get(m.userId)!,mine:m.userId===this.user,fingerprint:d?d.fingerprint:"",changed:this.changed.has(m.userId)};
  })});
 }
 private async candidate(user:string,d:Device){
  const key=user+":"+d.fingerprint;this.historical.set(key,d);
  this.publicIds.set(user,(await sha256Hex(user)).slice(0,16));
  const others=this.snap.members.filter(m=>!(m.userId===user&&m.historical&&m.fingerprint===d.fingerprint));
  this.set({members:[...others,{userId:user,publicId:this.publicIds.get(user)!,mine:user===this.user,fingerprint:d.fingerprint,changed:true,historical:true}]});
 }
 private async pinFor(user:string){
  let pin=this.pins.get(user);
  if(!pin){pin=await this.store.getPin(this.user,user);if(pin)this.pins.set(user,pin);}
  return pin;
 }
 private async senderOf(view:View,w:WireWrap){
  const current=view.members.find(m=>m.userId===w.senderUserId)?.devices.find(d=>d.deviceId===w.deviceId);
  const d=w.senderDhPublic&&w.senderSignPublic?{deviceId:w.deviceId,dhPublic:w.senderDhPublic,signPublic:w.senderSignPublic,fingerprint:""}:current;
  if(!d)return;
  if(w.senderUserId===this.user&&d.deviceId===this.identity?.deviceId&&d.signPublic===this.identity.signPublic&&d.dhPublic===this.identity.dhPublic)return d;
  const pin=await this.pinFor(w.senderUserId);
  if(pin&&[pin,...(pin.bindings||[])].some(p=>p.deviceId===d.deviceId&&p.signPublic===d.signPublic&&p.dhPublic===d.dhPublic))return d;
  if(current&&current.dhPublic===d.dhPublic&&current.signPublic===d.signPublic)return;
  await this.candidate(w.senderUserId,{...d,fingerprint:await bundleFingerprint(w.senderUserId,d)});
 }
 private async unwrapAll(me:Identity,view:View){
  for(const w of view.wraps||[]){
   if(this.keys.has(w.epoch))continue;
   const have=await this.store.getEpoch(this.user,w.epoch);
   if(have){this.keys.set(w.epoch,have);continue;}
   const sender=await this.senderOf(view,w);if(!sender)continue;
   try{
    const key=await openWrap(me,this.user,w,sender);
    await this.store.putEpoch(this.user,w.epoch,key);this.keys.set(w.epoch,key);
   }catch{/* a bad or foreign wrap never yields a key; keep waiting for a good one */}
  }
  const cur=await this.store.getEpoch(this.user,view.epoch);if(cur)this.keys.set(view.epoch,cur);
 }
 private async distribute(me:Identity,view:View){
  const key=this.keys.get(view.epoch)!;
  for(const m of view.members){
   if(m.userId===this.user||this.changed.has(m.userId))continue;
   for(const d of m.devices){
    const id=view.epoch+":"+m.userId+":"+d.deviceId;if(this.attempted.has(id))continue;
    try{
     await this.request("wrap",await makeWrap(me,this.user,{revision:view.revision,epoch:view.epoch,toUserId:m.userId,toDeviceId:d.deviceId},d.dhPublic,key));
     this.attempted.add(id);
    }catch(e){
     // conflict means a wrap for that device already exists; anything else is retried on the next sync.
     if(codeOf(e)==="conflict")this.attempted.add(id);else if(codeOf(e)==="stale_revision")throw e;
    }
   }
  }
 }
 private async fetchPage(me:Identity,epoch:string,before?:number){
  let res!:{messages:WireMessage[];nextCursor:number|null};let waited=0;
  for(let n=0;;n++){
   try{res=await this.request("history",{v:1,epoch,deviceId:me.deviceId,...(before===undefined?{}:{before}),limit:PAGE}) as typeof res;break;}
   catch(e){
    if(codeOf(e)!=="rate_limited"||this.closed)throw e;
    // Never retry earlier than the server asked; if that exceeds the bounded budget, exhaust instead.
    const srv=serverWait(e),wait=Math.max(srv??0,BACKOFF_MS*2**n);
    if(waited+wait>BUDGET_MS){this.retryHint=Math.max(srv??0,RESYNC_MS);throw e;}
    waited+=wait;await sleep(wait);
   }
  }
  for(const m of res.messages)this.raw.set(m.epoch+":"+m.senderUserId+":"+m.id,m);
  return res.nextCursor;
 }
 private retryHint=RESYNC_MS;
 private async refresh(me:Identity,view:View){
  let exhausted:unknown;
  for(const epoch of this.keys.keys()){
   if(this.cursors.has(epoch)&&epoch!==view.epoch)continue;
   try{
    const next=await this.fetchPage(me,epoch);
    if(!this.cursors.has(epoch))this.cursors.set(epoch,next);
   }catch(e){
    if(epoch===view.epoch)throw e;
    // Never skip silently. No cursor is stored for this epoch so a later sync refetches it. Stop the pass
    // on throttling instead of hammering the limiter.
    exhausted=e;if(codeOf(e)==="rate_limited")break;
   }
  }
  const missing=[...this.keys.keys()].some(k=>!this.cursors.has(k));
  await this.render();
  if(missing||exhausted){
   this.set({phase:"waiting",error:"history_incomplete",historyIncomplete:true});
   this.later(codeOf(exhausted)==="rate_limited"?this.retryHint:5000);
   return false;
  }
  this.set({historyIncomplete:false});return true;
 }
 async loadMore(){
  return this.run(async()=>{
   const me=this.identity;if(!me||this.snap.busy)return;
   this.set({busy:true});
   try{for(const [epoch,c] of [...this.cursors]){if(c==null||!this.keys.has(epoch))continue;this.cursors.set(epoch,await this.fetchPage(me,epoch,c));}this.extra+=PAGE;await this.render();}
   catch(e){this.fail(e);}finally{this.set({busy:false});}
  });
 }
 /** Verify+decrypt once per authenticated content and epoch key; cache never outlives the session or key object. */
 private openCached(k:string,m:WireMessage,key:CryptoKey){
  const ck=JSON.stringify([this.user,k,m.room,m.revision,m.deviceId,m.ts,m.iv,m.ciphertext,m.signature,m.senderSignPublic]);
  const hit=this.opened.get(ck);
  if(hit&&hit.key===key){this.opened.delete(ck);this.opened.set(ck,hit);return Promise.resolve(hit.res);}
  const pending=this.inflight.get(ck);if(pending)return pending;
  const p=this.open(m,key).then(res=>{
   if(this.inflight.get(ck)===p){this.opened.set(ck,{key,res});while(this.opened.size>OPEN_CACHE_MAX)this.opened.delete(this.opened.keys().next().value as string);}
   return res;
  }).finally(()=>{if(this.inflight.get(ck)===p)this.inflight.delete(ck);});
  this.inflight.set(ck,p);return p;
 }
 private async render(){
  const out=new Map<string,ChatMessage>();
  for(const [k,m] of this.raw){
   const mine=m.senderUserId===this.user,key=this.keys.get(m.epoch);
   const self=mine&&m.senderSignPublic===this.identity?.signPublic;
   const pin=self?undefined:await this.pinFor(m.senderUserId);
   let status:MessageStatus="ok",text:string|null=null;
   if(!key)status="undecryptable";
   else{
    const opened=await this.openCached(k,m,key);
    if(!opened.ok)status=opened.reason==="signature"?"unverified":"undecryptable";
    else if(!self&&(!pin||!pin.known.includes(m.senderSignPublic))){
     status="keychanged";
     if(this.changed.get(m.senderUserId)?.signPublic!==m.senderSignPublic)await this.candidate(m.senderUserId,{deviceId:m.deviceId,signPublic:m.senderSignPublic,dhPublic:"",fingerprint:await sha256Hex(m.senderSignPublic)});
    }
    if(opened.ok&&status==="ok")text=opened.text;
   }
   out.set(k,{key:k,id:m.id,senderUserId:m.senderUserId,publicId:this.publicIds.get(m.senderUserId)||"",mine,ts:m.ts,serverTs:m.serverTs,cursor:m.cursor,epoch:m.epoch,text,status});
  }
  for(const [k,m] of this.local){
   if([...this.raw.values()].some(r=>r.senderUserId===this.user&&r.id===m.id)){this.local.delete(k);this.sealed.delete(m.id);this.ambiguous.delete(m.id);}
   else out.set(k,m);
  }
  const sorted=[...out.values()].sort((a,b)=>a.serverTs-b.serverTs||a.cursor-b.cursor||a.ts-b.ts);
  // Bounded view only; raw ciphertext history stays on the server and older pages can be fetched again.
  if(sorted.length-this.windowStart-this.extra>RENDER_CAP){this.windowStart=sorted.length-RENDER_TRIM;this.extra=0;}
  const all=sorted.slice(Math.max(0,Math.min(this.windowStart,sorted.length)-this.extra));
  const more=[...this.cursors.values()].some(c=>c!=null);
  this.set({messages:all,hasMore:more});
 }
 async send(text:string,retryId?:string):Promise<boolean>{
  const body=text.trim(),me=this.identity;
  if(!body||new TextEncoder().encode(body).length>MAX_TEXT_BYTES||!this.lastView||!me||this.snap.phase!=="ready")return false;
  const id=retryId||crypto.randomUUID(),lk=this.lastView.epoch+":"+this.user+":"+id;
  this.local.set(lk,{key:lk,id,senderUserId:this.user,publicId:this.publicIds.get(this.user)||"",mine:true,ts:this.now(),serverTs:this.now(),cursor:Number.MAX_SAFE_INTEGER,epoch:this.lastView.epoch,text:body,status:"pending"});
  await this.render();
  return this.run(async()=>{
   for(let attempt=0;attempt<2;attempt++){
    try{
     const cur=this.lastView!,key=this.keys.get(cur.epoch);if(!key)throw new Error("waiting");
     let sealed=this.sealed.get(id);
     if(!sealed){sealed=await sealMessage(me,this.user,{revision:cur.revision,epoch:cur.epoch,id,ts:this.now()},body,key);this.sealed.set(id,sealed);}
     const res=await this.request("send",sealed) as {message:WireMessage};
     this.raw.set(res.message.epoch+":"+res.message.senderUserId+":"+res.message.id,res.message);
     for(const [k,m] of this.local)if(m.id===id)this.local.delete(k);this.sealed.delete(id);this.ambiguous.delete(id);await this.render();return true;
    }catch(e){
     const code=codeOf(e);
     // Revision or epoch moved under us: refresh the room view once and reseal with the same message id.
     if(attempt===0&&code==="stale_revision"){
      // Check history before resealing: the old request might already be committed.
      await this.sync();
      if([...this.raw.values()].some(m=>m.senderUserId===this.user&&m.id===id)){this.local.delete(lk);this.sealed.delete(id);this.ambiguous.delete(id);await this.render();return true;}
      // A stale response to a later retry does NOT establish that the first attempt failed.
      if(this.ambiguous.has(id))break;
      this.sealed.delete(id);continue;
     }
     if([...this.raw.values()].some(m=>m.senderUserId===this.user&&m.id===id)){this.local.delete(lk);this.sealed.delete(id);this.ambiguous.delete(id);await this.render();return true;}
     if(this.sealed.has(id))this.ambiguous.add(id);
     break;
    }
   }
   const l=this.local.get(lk);if(l)this.local.set(lk,{...l,status:"failed"});
   await this.render();return false;
  });
 }
 retry(m:ChatMessage){return m.text?this.send(m.text,m.id):false;}
 dismiss(m:ChatMessage){this.sealed.delete(m.id);this.ambiguous.delete(m.id);this.local.delete(m.key);return this.render();}
 /** Stage keys locally; never publish before the recovery words have been saved. */
 async createIdentity(){
  return this.run(async()=>{
   this.set({busy:true,error:null});
   try{
    const existing=await this.store.getSetup(this.user);
    if(existing)throw new Error("setup_words_lost");
    const made=await createIdentity(this.user,this.serverIdentity?.keyVersion??0);
    await this.store.putSetup(this.user,{identity:made.identity,body:made.body,confirmed:false});
    this.set({phase:"words",words:made.words});
   }catch(e){this.set({error:codeOf(e)});}finally{this.set({busy:false});}
  });
 }
 private async publish(setup:Setup){
  await this.request("keys:put",setup.body);
  await this.store.putIdentity(this.user,setup.identity);
  await this.store.clearSetup(this.user);this.registered=false;
 }
 async confirmWords(){
  return this.run(async()=>{
   this.set({busy:true,error:null});
   try{
    const setup=await this.store.getSetup(this.user);if(!setup)return;
    await this.store.putSetup(this.user,{...setup,confirmed:true});
    this.set({words:null,phase:"loading"});
    await this.sync();
   }catch(e){this.fail(e);}finally{this.set({busy:false});}
  });
 }
 /** Caller must obtain explicit destructive confirmation. Old authorized history is lost. */
 async resetIdentity(){
  return this.run(async()=>{
   const {identity:server}=await this.request("keys:get",{v:1}) as {identity:ServerIdentity|null};
   this.serverIdentity=server||undefined;
   await this.store.clearSetup(this.user);await this.store.clearIdentity(this.user);
   this.identity=undefined;this.registered=false;
   this.clearSession();
   this.set({phase:"setup",words:null,messages:[],error:null});
  });
 }
 async recover(input:string){
  return this.run(async()=>{
   const setup=await this.store.getSetup(this.user);
   const server=setup?{...setup.body,v:1 as const}:this.serverIdentity;if(!server)return;
   this.set({busy:true,error:null});
   try{
    const id=await restoreIdentity(this.user,server,input);
    if(setup){await this.store.putSetup(this.user,{...setup,identity:id,confirmed:true});await this.publish({...setup,identity:id,confirmed:true});}
    await this.store.putIdentity(this.user,id);this.registered=false;this.set({phase:"loading"});
    await this.sync();
   }catch(e){this.set({error:codeOf(e)==="wrong_words"||codeOf(e)==="bad_words"?codeOf(e):"unavailable"});}
   finally{this.set({busy:false});}
  });
 }
 async trust(userId:string,fingerprint?:string){
  const entry=[...this.historical].find(([k,d])=>k.startsWith(userId+":")&&(!fingerprint||d.fingerprint===fingerprint));
  const current=this.changed.get(userId);
  const d=fingerprint?(current?.fingerprint===fingerprint?current:entry?.[1]):current||entry?.[1];if(!d)return;
  const historical=d!==current;
  const old=await this.pinFor(userId);
  // A message-only approval has no DH binding and cannot authorize an epoch wrap.
  const binding={deviceId:d.deviceId,signPublic:d.signPublic,dhPublic:d.dhPublic};
  const pin:Pin={...((historical&&old)||!d.dhPublic?old||binding:binding),known:[...new Set([...(old?.known||[]),d.signPublic])],
   bindings:[...(old?.bindings||[]),...(old?[{deviceId:old.deviceId,signPublic:old.signPublic,dhPublic:old.dhPublic}]:[]),...(d.dhPublic?[binding]:[])]};
  await this.store.putPin(this.user,userId,pin);this.pins.set(userId,pin);this.opened.clear();await this.start();
 }
}
