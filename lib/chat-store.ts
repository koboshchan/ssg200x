// IndexedDB key store for TableTalk. Stores CryptoKey objects directly (structured clone); identity private
// keys are non-extractable. No plaintext messages or recovery words are ever written here.
import type {ChatStore,Pin} from "./chat-client";
import type {Identity} from "./chat-crypto";
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
export function indexedDbStore():ChatStore{
 return {
  getIdentity:u=>get<Identity>("identity:"+u),
  putIdentity:(u,i)=>put("identity:"+u,i),
  clearIdentity:u=>del("identity:"+u),
  getEpoch:(u,e)=>get<CryptoKey>("epoch:"+u+":"+e),
  putEpoch:(u,e,k)=>put("epoch:"+u+":"+e,k),
  getPin:(u,o)=>get<Pin>("pin:"+u+":"+o),
  putPin:(u,o,p)=>put("pin:"+u+":"+o,p),
 };
}
