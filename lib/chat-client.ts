// TableTalk client state machine. Pure logic with injected transport and key store so the same code
// runs in the browser (socket.io + IndexedDB) and in Node tests against the real chat service.
import {createIdentity,importEpochKey,newEpochKey,makeWrap,openMessage,openWrap,registerData,restoreIdentity,sealMessage,sha256Hex,signText,MAX_TEXT_BYTES,type Identity,type ServerIdentity,type WireMessage,type WireWrap} from "./chat-crypto";

export type Pin={deviceId:string;signPublic:string;dhPublic:string;known:string[]};
export interface ChatStore{
 getIdentity(user:string):Promise<Identity|undefined>;putIdentity(user:string,identity:Identity):Promise<void>;clearIdentity(user:string):Promise<void>;
 getEpoch(user:string,epoch:string):Promise<CryptoKey|undefined>;putEpoch(user:string,epoch:string,key:CryptoKey):Promise<void>;
 getPin(user:string,other:string):Promise<Pin|undefined>;putPin(user:string,other:string,pin:Pin):Promise<void>;
}
export type Transport=(event:string,payload:unknown)=>Promise<any>;
export type Phase="loading"|"setup"|"words"|"recover"|"waiting"|"ready"|"error";
export type MessageStatus="ok"|"pending"|"failed"|"unverified"|"keychanged"|"undecryptable";
export type ChatMessage={key:string;id:string;senderUserId:string;publicId:string;mine:boolean;ts:number;serverTs:number;cursor:number;epoch:string;text:string|null;status:MessageStatus};
export type ChatMember={userId:string;publicId:string;mine:boolean;fingerprint:string;changed:boolean};
export type Snapshot={phase:Phase;error:string|null;words:string[]|null;messages:ChatMessage[];members:ChatMember[];hasMore:boolean;busy:boolean};
type Device={deviceId:string;dhPublic:string;signPublic:string;fingerprint:string};
type View={revision:number;epoch:string;status:"unclaimed"|"claimed"|"active";owner:{userId:string;deviceId:string}|null;leaseUntil:number;members:{userId:string;devices:Device[]}[];wraps?:WireWrap[]};
const codeOf=(e:unknown)=>e instanceof Error?e.message:"unavailable";
const PAGE=50;

export class ChatClient{
 private snap:Snapshot={phase:"loading",error:null,words:null,messages:[],members:[],hasMore:false,busy:false};
 private listeners=new Set<()=>void>();
 private identity:Identity|undefined;private serverIdentity:ServerIdentity|undefined;private pendingIdentity:Identity|undefined;
 private registered=false;private chain:Promise<unknown>=Promise.resolve();private timer:ReturnType<typeof setTimeout>|undefined;private hintTimer:ReturnType<typeof setTimeout>|undefined;
 private keys=new Map<string,CryptoKey>();private attempted=new Set<string>();private cursors=new Map<string,number|null>();
 private raw=new Map<string,WireMessage>();private local=new Map<string,ChatMessage>();private shown=new Map<string,ChatMessage>();
 private changed=new Map<string,Device>();private publicIds=new Map<string,string>();private pins=new Map<string,Pin>();private lastView:View|undefined;
 private closed=false;
 constructor(private user:string,private request:Transport,private store:ChatStore,private now:()=>number=Date.now){}
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
 getSnapshot=()=>this.snap;
 private set(patch:Partial<Snapshot>){this.snap={...this.snap,...patch};this.listeners.forEach(l=>l());}
 private run<T>(fn:()=>Promise<T>):Promise<T>{const next=this.chain.then(fn,fn);this.chain=next.catch(()=>{});return next;}
 close(){this.closed=true;clearTimeout(this.timer);clearTimeout(this.hintTimer);}
 /** Call on connect and whenever the server emits chat:changed (payload-free hint). */
 hint(){clearTimeout(this.hintTimer);this.hintTimer=setTimeout(()=>{void this.start();},150);}
 start=()=>this.run(()=>this.sync());
 private later(ms:number){clearTimeout(this.timer);if(!this.closed)this.timer=setTimeout(()=>{void this.start();},ms);}

 private async sync(){
  if(this.closed||this.snap.phase==="words")return;
  try{
   const {identity:server}=await this.request("keys:get",{v:1}) as {identity:ServerIdentity|null};
   let local=await this.store.getIdentity(this.user);
   if(!server){
    if(local){await this.store.clearIdentity(this.user);this.registered=false;}
    this.identity=undefined;this.serverIdentity=undefined;this.set({phase:"setup",error:null});return;
   }
   if(!local||local.deviceId!==server.deviceId||local.keyVersion!==server.keyVersion||local.signPublic!==server.signPublic){
    if(local){await this.store.clearIdentity(this.user);this.registered=false;}
    this.identity=undefined;this.serverIdentity=server;this.set({phase:"recover",error:null});return;
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
  let view=await this.request("state",{v:1}) as View;
  await this.syncPins(view);
  await this.unwrapAll(me,view);
  const have=()=>this.keys.has(view.epoch);
  if(!have()){
   const stale=view.status==="claimed"&&view.leaseUntil<=this.now();
   if(view.status==="unclaimed"||stale)view=await this.bootstrap(me,view);
   else{this.set({phase:"waiting",error:null});this.later(view.status==="claimed"?Math.max(1500,view.leaseUntil-this.now()+500):4000);return;}
  }
  if(view.status!=="active"||!have()){this.set({phase:"waiting",error:null});this.later(3000);return;}
  this.lastView=view;
  await this.distribute(me,view);
  await this.refresh(me,view);
  this.set({phase:"ready",error:null});
 }
 private async bootstrap(me:Identity,view:View){
  const claimed=await this.request("claim",{v:1,revision:view.revision,epoch:view.epoch,deviceId:me.deviceId}) as View;
  const key=await newEpochKey();
  const wrap=await makeWrap(me,this.user,{revision:claimed.revision,epoch:claimed.epoch,toUserId:this.user,toDeviceId:me.deviceId},me.dhPublic,key);
  await this.request("wrap",wrap);
  const stored=await importEpochKey(new Uint8Array(await crypto.subtle.exportKey("raw",key)));
  await this.store.putEpoch(this.user,claimed.epoch,stored);this.keys.set(claimed.epoch,stored);
  return await this.request("state",{v:1}) as View;
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
 private senderOf(view:View,userId:string,deviceId:string){
  if(this.changed.has(userId))return undefined;
  return view.members.find(m=>m.userId===userId)?.devices.find(d=>d.deviceId===deviceId);
 }
 private async unwrapAll(me:Identity,view:View){
  for(const w of view.wraps||[]){
   if(this.keys.has(w.epoch))continue;
   const have=await this.store.getEpoch(this.user,w.epoch);
   if(have){this.keys.set(w.epoch,have);continue;}
   const sender=this.senderOf(view,w.senderUserId,w.deviceId);if(!sender)continue;
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
  const res=await this.request("history",{v:1,epoch,deviceId:me.deviceId,...(before===undefined?{}:{before}),limit:PAGE}) as {messages:WireMessage[];nextCursor:number|null};
  for(const m of res.messages)this.raw.set(m.epoch+":"+m.senderUserId+":"+m.id,m);
  return res.nextCursor;
 }
 private async refresh(me:Identity,view:View){
  for(const epoch of this.keys.keys()){
   if(this.cursors.has(epoch)&&epoch!==view.epoch)continue;
   try{
    const next=await this.fetchPage(me,epoch);
    if(!this.cursors.has(epoch))this.cursors.set(epoch,next);
   }catch(e){if(epoch===view.epoch)throw e;}
  }
  await this.render();
 }
 async loadMore(){
  return this.run(async()=>{
   const me=this.identity;if(!me||this.snap.busy)return;
   this.set({busy:true});
   try{for(const [epoch,c] of [...this.cursors]){if(c==null||!this.keys.has(epoch))continue;this.cursors.set(epoch,await this.fetchPage(me,epoch,c));}await this.render();}
   catch(e){this.fail(e);}finally{this.set({busy:false});}
  });
 }
 private async render(){
  const out=new Map<string,ChatMessage>();
  for(const [k,m] of this.raw){
   const mine=m.senderUserId===this.user,key=this.keys.get(m.epoch);
   const pin=mine?undefined:this.pins.get(m.senderUserId);
   let status:MessageStatus="ok",text:string|null=null;
   if(!key)status="undecryptable";
   else{
    const opened=await openMessage(m,key);
    if(!opened.ok)status=opened.reason==="signature"?"unverified":"undecryptable";
    else if(!mine&&(!pin||!pin.known.includes(m.senderSignPublic)))status="keychanged";
    if(opened.ok&&status==="ok")text=opened.text;
   }
   out.set(k,{key:k,id:m.id,senderUserId:m.senderUserId,publicId:this.publicIds.get(m.senderUserId)||"",mine,ts:m.ts,serverTs:m.serverTs,cursor:m.cursor,epoch:m.epoch,text,status});
  }
  for(const [k,m] of this.local){if(!out.has(k))out.set(k,m);}
  const all=[...out.values()].sort((a,b)=>a.serverTs-b.serverTs||a.cursor-b.cursor||a.ts-b.ts);
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
     const sealed=await sealMessage(me,this.user,{revision:cur.revision,epoch:cur.epoch,id,ts:this.now()},body,key);
     const res=await this.request("send",sealed) as {message:WireMessage};
     this.raw.set(res.message.epoch+":"+res.message.senderUserId+":"+res.message.id,res.message);
     this.local.delete(lk);await this.render();return true;
    }catch(e){
     const code=codeOf(e);
     // Revision or epoch moved under us: refresh the room view once and reseal with the same message id.
     if(attempt===0&&(code==="stale_revision"||code==="waiting")){try{await this.sync();}catch{}continue;}
     break;
    }
   }
   const l=this.local.get(lk);if(l)this.local.set(lk,{...l,status:"failed"});
   await this.render();return false;
  });
 }
 retry(m:ChatMessage){return m.text?this.send(m.text,m.id):false;}
 dismiss(m:ChatMessage){this.local.delete(m.key);return this.render();}
 /** Setup: create a fresh identity (also used to reset). Words are shown once, then confirmed. */
 async createIdentity(){
  return this.run(async()=>{
   this.set({busy:true,error:null});
   try{
    const expected=this.serverIdentity?.keyVersion??0;
    const made=await createIdentity(this.user,expected);
    await this.request("keys:put",made.body);
    this.pendingIdentity=made.identity;this.set({phase:"words",words:made.words});
   }catch(e){this.set({error:codeOf(e)});}finally{this.set({busy:false});}
  });
 }
 /** The person has written the words down; persist the private keys on this device and go live. */
 async confirmWords(){
  const id=this.pendingIdentity;if(!id)return;
  await this.store.putIdentity(this.user,id);this.pendingIdentity=undefined;this.registered=false;
  this.set({words:null,phase:"loading"});await this.start();
 }
 async recover(input:string){
  return this.run(async()=>{
   const server=this.serverIdentity;if(!server)return;
   this.set({busy:true,error:null});
   try{
    const id=await restoreIdentity(this.user,server,input);
    await this.store.putIdentity(this.user,id);this.registered=false;this.set({phase:"loading"});
    await this.sync();
   }catch(e){this.set({error:codeOf(e)==="wrong_words"||codeOf(e)==="bad_words"?codeOf(e):"unavailable"});}
   finally{this.set({busy:false});}
  });
 }
 async trust(userId:string){
  const d=this.changed.get(userId);if(!d)return;
  const old=this.pins.get(userId),pin={deviceId:d.deviceId,signPublic:d.signPublic,dhPublic:d.dhPublic,known:[...new Set([...(old?.known||[]),d.signPublic])]};
  await this.store.putPin(this.user,userId,pin);this.pins.set(userId,pin);await this.start();
 }
}
