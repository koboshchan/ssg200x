// TableTalk IndexedDB. Recovery words and plaintext messages are never persisted.
// Identity keys and the local epoch KEK are nonextractable CryptoKeys. Epoch bytes are AES-GCM
// sealed at rest; temporary extractable working keys exist only to share an authorized grant.
import type {SendPayload,BootstrapPayload,ChatStore,Pin,Setup} from "./chat-client";
import {b64,unb64,importEpochKey,randomBytes,sealLocalRecord,openLocalRecord,type LocalSealed,type Identity} from "./chat-crypto";
const DB="ssg200x-tabletalk",STORE="kv";
function open():Promise<IDBDatabase>{
 return new Promise((resolve,reject)=>{
  const req=indexedDB.open(DB,1);
  req.onupgradeneeded=()=>{req.result.createObjectStore(STORE);};
  req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
 });
}
async function tx<T>(mode:IDBTransactionMode,fn:(s:IDBObjectStore)=>IDBRequest<T>|undefined):Promise<T|undefined>{
 const db=await open();
 try{
  return await new Promise<T|undefined>((resolve,reject)=>{
   const t=db.transaction(STORE,mode),r=fn(t.objectStore(STORE));
   t.oncomplete=()=>resolve(r?.result);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error);
  });
 }finally{db.close();}
}
const get=<T,>(k:string)=>tx<T>("readonly",s=>s.get(k));
const put=(k:string,v:unknown)=>tx("readwrite",s=>s.put(v,k)).then(()=>{});
const del=(k:string)=>tx("readwrite",s=>s.delete(k)).then(()=>{});
type Sealed=LocalSealed;
type StoredSetup={identity:Identity;publication:LocalSealed;confirmed:boolean};
const enc=new TextEncoder();
const bytes=(s:string)=>unb64(s) as Uint8Array<ArrayBuffer>;
async function kek(user:string){
 const id="kek:"+user,existing=await get<CryptoKey>(id);if(existing)return existing;
 const proposed=await crypto.subtle.generateKey({name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
 // Resolve concurrent first-use tabs with one read/write transaction, never overwrite the winner.
 const db=await open();
 try{return await new Promise<CryptoKey>((resolve,reject)=>{
  const t=db.transaction(STORE,"readwrite"),s=t.objectStore(STORE),r=s.get(id);let chosen:CryptoKey;
  r.onsuccess=()=>{chosen=r.result||proposed;if(!r.result)s.put(chosen,id);};
  t.oncomplete=()=>resolve(chosen);t.onabort=()=>reject(t.error);t.onerror=()=>reject(t.error);
 });}finally{db.close();}
}
const aad=(u:string,e:string)=>enc.encode(JSON.stringify(["tabletalk",1,"local-epoch",u,e]));
async function seal(u:string,e:string,k:CryptoKey):Promise<Sealed>{
 const iv=randomBytes(12),key=await kek(u),raw=new Uint8Array(await crypto.subtle.exportKey("raw",k));
 try{return {v:1,iv:b64(iv),ciphertext:b64(await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:aad(u,e)},key,raw))};}
 finally{raw.fill(0);}
}
export function indexedDbStore():ChatStore{
 const store:ChatStore={
  async getPending(u){
   const rows:SendPayload[]=[];
   await tx("readonly",s=>{const r=s.openCursor();r.onsuccess=()=>{const c=r.result;if(!c)return;if(typeof c.key==="string"&&c.key.startsWith("pending:"+u+":"))rows.push(c.value);c.continue();};return undefined;});
   return rows;
  },
  putPending:(u,p)=>put("pending:"+u+":"+p.id,p),
  deletePending:(u,id)=>del("pending:"+u+":"+id),

  getIdentity:u=>get<Identity>("identity:"+u),
  putIdentity:(u,i)=>put("identity:"+u,i),
  async clearIdentity(u){
   // A new account key must not inherit retained epoch access from the previous identity.
   await tx("readwrite",s=>{
    s.delete("identity:"+u);s.delete("setup:"+u);s.delete("kek:"+u);
    const r=s.openCursor();
    r.onsuccess=()=>{const c=r.result;if(!c)return;
     if(typeof c.key==="string"&&(c.key.startsWith("epoch:"+u+":")||c.key.startsWith("bootstrap:"+u+":")||c.key.startsWith("pending:"+u+":")))c.delete();
     c.continue();
    };
    return undefined;
   });
  },
  async getSetup(u){
   const record=await get<StoredSetup|Setup>("setup:"+u);if(!record)return;
   if("body" in record){await store.putSetup(u,record);return record;}
   return {identity:record.identity,confirmed:record.confirmed,
    body:await openLocalRecord<Setup["body"]>(await kek(u),u,"setup-publication",record.publication)};
  },
  async putSetup(u,s){
   const publication=await sealLocalRecord(await kek(u),u,"setup-publication",s.body);
   await put("setup:"+u,{identity:s.identity,confirmed:s.confirmed,publication} satisfies StoredSetup);
  },
  clearSetup:u=>del("setup:"+u),
  async getEpoch(u,e){
   const id="epoch:"+u+":"+e,record=await get<Sealed|CryptoKey>(id);if(!record)return;
   // Upgrade old directly stored CryptoKeys in place. Do not claim physical disk erasure.
   if("algorithm" in record){await store.putEpoch(u,e,record);return record;}
   if(record.v!==1)throw new Error("bad_local_epoch");
   const raw=new Uint8Array(await crypto.subtle.decrypt({name:"AES-GCM",iv:bytes(record.iv),additionalData:aad(u,e)},await kek(u),bytes(record.ciphertext)));
   try{return await importEpochKey(raw);}finally{raw.fill(0);}
  },
  async putEpoch(u,e,k){await put("epoch:"+u+":"+e,await seal(u,e,k));},
  getBootstrap:(u,e)=>get<BootstrapPayload>("bootstrap:"+u+":"+e),
  async putBootstrap(u,e,k,w){
   const sealed=await seal(u,e,k);
   await tx("readwrite",s=>{s.put(sealed,"epoch:"+u+":"+e);return s.put(w,"bootstrap:"+u+":"+e);});
  },
  clearBootstrap:(u,e)=>del("bootstrap:"+u+":"+e),
  getPin:(u,o)=>get<Pin>("pin:"+u+":"+o),
  putPin:(u,o,p)=>put("pin:"+u+":"+o,p),
 };
 return store;
}
