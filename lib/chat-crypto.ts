// TableTalk client crypto. Runs in browsers and Node (WebCrypto only), no DOM, no storage.
// Wire formats mirror runtime/chat-protocol.mjs; the server never sees plaintext or private keys.
import {argon2id} from "hash-wasm";
import {wordlist} from "@scure/bip39/wordlists/english.js";

export const ROOM="main";
export const canonical=(value:unknown)=>JSON.stringify(value);
const enc=new TextEncoder(),dec=new TextDecoder("utf-8",{fatal:true});
const subtle=()=>globalThis.crypto.subtle;
export const b64=(bytes:ArrayBuffer|Uint8Array)=>{
 const u=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);let s="";
 for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode(...u.subarray(i,i+0x8000));
 return btoa(s).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");
};
export const unb64=(text:string)=>{
 if(typeof text!=="string"||!/^[A-Za-z0-9_-]*$/.test(text))throw new Error("bad_base64");
 const s=text.replaceAll("-","+").replaceAll("_","/"),bin=atob(s+"=".repeat((4-s.length%4)%4));
 return Uint8Array.from(bin,c=>c.charCodeAt(0));
};
export const randomBytes=(n:number)=>globalThis.crypto.getRandomValues(new Uint8Array(n));
export const sha256Hex=async(text:string)=>[...new Uint8Array(await subtle().digest("SHA-256",enc.encode(text)))].map(b=>b.toString(16).padStart(2,"0")).join("");
export const sha256Url=async(text:string)=>b64(await subtle().digest("SHA-256",enc.encode(text)));

// Header and signed-data shapes. These must stay byte-identical to runtime/chat-protocol.mjs.
export type Device={deviceId:string;dhPublic:string;signPublic:string};
export const registerData=(user:string,p:Device)=>canonical(["tabletalk",1,"register",user,p.deviceId,p.dhPublic,p.signPublic]);
export const bundleFingerprint=(user:string,p:Device)=>sha256Url(canonical(["tabletalk",1,"device",user,p.deviceId,p.dhPublic,p.signPublic]));
export type WrapFields={room:string;revision:number;epoch:string;deviceId:string;toUserId:string;toDeviceId:string};
export const wrapHeader=(user:string,p:WrapFields)=>["tabletalk",1,"wrap",p.room,p.revision,p.epoch,user,p.deviceId,p.toUserId,p.toDeviceId];
export type MessageFields={room:string;revision:number;epoch:string;deviceId:string;id:string;ts:number};
export const messageHeader=(user:string,p:MessageFields)=>["tabletalk",1,"message",p.room,p.revision,p.epoch,user,p.deviceId,p.id,p.ts];
export const signedWrap=(user:string,p:WrapFields&{salt:string;iv:string;ciphertext:string})=>canonical([...wrapHeader(user,p),p.salt,p.iv,p.ciphertext]);
export const signedMessage=(user:string,p:MessageFields&{iv:string;ciphertext:string})=>canonical([...messageHeader(user,p),p.iv,p.ciphertext]);

// Account recovery: six independent uniformly random English words (66 bits) hardened by Argon2id.
export const RECOVERY={scheme:"bip39-english-6-v1",kdf:"argon2id",memoryKiB:65536,iterations:3,parallelism:1} as const;
export function recoveryWords(){
 // 65536 is a multiple of 2048, so taking the low 11 bits of a uniform 16-bit value is unbiased.
 const r=new Uint16Array(6);globalThis.crypto.getRandomValues(r);
 return Array.from(r,n=>wordlist[n%2048]);
}
export function normalizeWords(input:string){
 const words=input.toLowerCase().trim().split(/\s+/).filter(Boolean);
 if(words.length!==6||words.some(w=>!wordlist.includes(w)))throw new Error("bad_words");
 return words;
}
async function recoveryKey(words:string[],salt:Uint8Array){
 const raw=await argon2id({password:words.join(" "),salt,parallelism:RECOVERY.parallelism,iterations:RECOVERY.iterations,memorySize:RECOVERY.memoryKiB,hashLength:32,outputType:"binary"});
 return subtle().importKey("raw",raw as Uint8Array<ArrayBuffer>,"AES-GCM",false,["encrypt","decrypt"]);
}
const buf=(u:Uint8Array)=>u as Uint8Array<ArrayBuffer>;

export type Backup={v:1;recoveryScheme:string;kdf:string;memoryKiB:number;iterations:number;parallelism:number;salt:string;iv:string;ciphertext:string};
export type ServerIdentity={v:1;keyVersion:number;deviceId:string;dhPublic:string;signPublic:string;backup:Backup};
export type Identity={deviceId:string;keyVersion:number;dhPublic:string;signPublic:string;dhPrivate:CryptoKey;signPrivate:CryptoKey};
type Jwks={dh:JsonWebKey;sign:JsonWebKey};

const backupAad=(user:string,keyVersion:number,p:Device)=>enc.encode(canonical(["tabletalk",1,"backup",user,keyVersion,p.deviceId,p.dhPublic,p.signPublic]));
const rawPublic=(jwk:JsonWebKey)=>b64(new Uint8Array([4,...unb64(jwk.x!),...unb64(jwk.y!)]));
const importPrivate=(jwk:JsonWebKey,alg:"ECDH"|"ECDSA")=>subtle().importKey("jwk",jwk,{name:alg,namedCurve:"P-256"},false,alg==="ECDH"?["deriveBits"]:["sign"]);

/** Build the signed keys:put payload for a brand new identity plus the one-time recovery words. */
export async function createIdentity(user:string,expectedVersion:number){
 const dh=await subtle().generateKey({name:"ECDH",namedCurve:"P-256"},true,["deriveBits"]);
 const sign=await subtle().generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]);
 const jwks:Jwks={dh:await subtle().exportKey("jwk",dh.privateKey),sign:await subtle().exportKey("jwk",sign.privateKey)};
 const device:Device={deviceId:globalThis.crypto.randomUUID(),dhPublic:b64(await subtle().exportKey("raw",dh.publicKey)),signPublic:b64(await subtle().exportKey("raw",sign.publicKey))};
 const keyVersion=expectedVersion+1,words=recoveryWords(),salt=randomBytes(32),iv=randomBytes(12);
 const sealed=await subtle().encrypt({name:"AES-GCM",iv,additionalData:backupAad(user,keyVersion,device)},await recoveryKey(words,salt),enc.encode(canonical({v:1,dh:jwks.dh,sign:jwks.sign})));
 const backup:Backup={v:1,recoveryScheme:RECOVERY.scheme,kdf:RECOVERY.kdf,memoryKiB:RECOVERY.memoryKiB,iterations:RECOVERY.iterations,parallelism:RECOVERY.parallelism,salt:b64(salt),iv:b64(iv),ciphertext:b64(sealed)};
 const body={v:1,expectedVersion,keyVersion,...device,backup,signature:""};
 const data=canonical(["tabletalk",1,"identity",user,expectedVersion,keyVersion,device.deviceId,device.dhPublic,device.signPublic,backup.recoveryScheme,backup.kdf,backup.memoryKiB,backup.iterations,backup.parallelism,backup.salt,backup.iv,backup.ciphertext]);
 body.signature=b64(await subtle().sign({name:"ECDSA",hash:"SHA-256"},sign.privateKey,enc.encode(data)));
 const identity:Identity={...device,keyVersion,dhPrivate:await importPrivate(jwks.dh,"ECDH"),signPrivate:await importPrivate(jwks.sign,"ECDSA")};
 return {body,words,identity};
}
/** Decrypt the server-held backup with the recovery words and prove it matches the published public keys. */
export async function restoreIdentity(user:string,server:ServerIdentity,input:string):Promise<Identity>{
 const words=normalizeWords(input),b=server.backup;
 if(b.recoveryScheme!==RECOVERY.scheme||b.kdf!==RECOVERY.kdf||b.memoryKiB!==RECOVERY.memoryKiB||b.iterations!==RECOVERY.iterations||b.parallelism!==RECOVERY.parallelism)throw new Error("unsupported_backup");
 let plain:Uint8Array;
 try{plain=new Uint8Array(await subtle().decrypt({name:"AES-GCM",iv:buf(unb64(b.iv)),additionalData:backupAad(user,server.keyVersion,server)},await recoveryKey(words,unb64(b.salt)),buf(unb64(b.ciphertext))));}
 catch{throw new Error("wrong_words");}
 const jwks=JSON.parse(dec.decode(plain)) as {v:number;dh:JsonWebKey;sign:JsonWebKey};
 if(jwks.v!==1||rawPublic(jwks.dh)!==server.dhPublic||rawPublic(jwks.sign)!==server.signPublic)throw new Error("wrong_words");
 return {deviceId:server.deviceId,keyVersion:server.keyVersion,dhPublic:server.dhPublic,signPublic:server.signPublic,dhPrivate:await importPrivate(jwks.dh,"ECDH"),signPrivate:await importPrivate(jwks.sign,"ECDSA")};
}
export const signText=async(key:CryptoKey,data:string)=>b64(await subtle().sign({name:"ECDSA",hash:"SHA-256"},key,enc.encode(data)));
export async function verifyText(signPublic:string,data:string,signature:string){
 try{
  const key=await subtle().importKey("raw",buf(unb64(signPublic)),{name:"ECDSA",namedCurve:"P-256"},false,["verify"]);
  return await subtle().verify({name:"ECDSA",hash:"SHA-256"},key,buf(unb64(signature)),enc.encode(data));
 }catch{return false;}
}

// Epoch keys. Extractable on purpose: any member device that holds the key must be able to wrap it for
// a newly added member device. Identity private keys, by contrast, are never extractable after setup.
export const newEpochKey=()=>subtle().generateKey({name:"AES-GCM",length:256},true,["encrypt","decrypt"]);
export const importEpochKey=(raw:Uint8Array)=>subtle().importKey("raw",buf(raw),"AES-GCM",true,["encrypt","decrypt"]);
async function wrapKeyFor(shared:CryptoKey,header:unknown[],salt:Uint8Array){
 const info=enc.encode(canonical(header));
 return subtle().deriveKey({name:"HKDF",hash:"SHA-256",salt:buf(salt),info},shared,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
}
async function sharedSecret(priv:CryptoKey,peerRaw:string){
 const pub=await subtle().importKey("raw",buf(unb64(peerRaw)),{name:"ECDH",namedCurve:"P-256"},false,[]);
 return subtle().importKey("raw",await subtle().deriveBits({name:"ECDH",public:pub},priv,256),"HKDF",false,["deriveKey"]);
}
/** Wrap the epoch key for one recipient device and sign it. */
export async function makeWrap(me:Identity,user:string,fields:Omit<WrapFields,"room"|"deviceId">&{room?:string;toUserId:string;toDeviceId:string},recipientDh:string,epochKey:CryptoKey){
 const base:WrapFields={room:ROOM,deviceId:me.deviceId,...fields},header=wrapHeader(user,base),salt=randomBytes(32),iv=randomBytes(12);
 const key=await wrapKeyFor(await sharedSecret(me.dhPrivate,recipientDh),header,salt);
 const ciphertext=new Uint8Array(await subtle().encrypt({name:"AES-GCM",iv,additionalData:enc.encode(canonical(header))},key,await subtle().exportKey("raw",epochKey)));
 const p={v:1 as const,...base,salt:b64(salt),iv:b64(iv),ciphertext:b64(ciphertext),signature:""};
 p.signature=await signText(me.signPrivate,signedWrap(user,p));
 return p;
}
export type WireWrap={senderDhPublic?:string;senderSignPublic?:string;v:1;room:string;revision:number;epoch:string;senderUserId:string;deviceId:string;toUserId:string;toDeviceId:string;salt:string;iv:string;ciphertext:string;signature:string};
/** Verify the sender signature, then unwrap. Throws on any mismatch. */
export async function openWrap(me:Identity,user:string,w:WireWrap,sender:{signPublic:string;dhPublic:string},room=ROOM){
 if(w.toUserId!==user||w.toDeviceId!==me.deviceId||w.room!==room)throw new Error("wrong_recipient");
 if(!await verifyText(sender.signPublic,signedWrap(w.senderUserId,w),w.signature))throw new Error("bad_wrap_signature");
 const header=wrapHeader(w.senderUserId,w);
 const key=await wrapKeyFor(await sharedSecret(me.dhPrivate,sender.dhPublic),header,unb64(w.salt));
 const raw=new Uint8Array(await subtle().decrypt({name:"AES-GCM",iv:buf(unb64(w.iv)),additionalData:enc.encode(canonical(header))},key,buf(unb64(w.ciphertext))));
 if(raw.length!==32)throw new Error("bad_epoch_key");
 return importEpochKey(raw);
}
export const MAX_TEXT_BYTES=4096;
export async function sealMessage(me:Identity,user:string,fields:{room?:string;revision:number;epoch:string;id:string;ts:number},text:string,epochKey:CryptoKey){
 const bytes=enc.encode(text);if(bytes.length<1||bytes.length>MAX_TEXT_BYTES)throw new Error("bad_length");
 const base:MessageFields={room:ROOM,deviceId:me.deviceId,...fields},iv=randomBytes(12);
 const ciphertext=new Uint8Array(await subtle().encrypt({name:"AES-GCM",iv,additionalData:enc.encode(canonical(messageHeader(user,base)))},epochKey,bytes));
 const p={v:1 as const,...base,iv:b64(iv),ciphertext:b64(ciphertext),signature:""};
 p.signature=await signText(me.signPrivate,signedMessage(user,p));
 return p;
}
export type WireMessage={v:1;room:string;revision:number;epoch:string;senderUserId:string;deviceId:string;id:string;ts:number;iv:string;ciphertext:string;signature:string;senderSignPublic:string;serverTs:number;cursor:number};
/** Signature is verified against the stored sender key BEFORE any decryption; returns null text on failure. */
export async function openMessage(m:WireMessage,epochKey:CryptoKey):Promise<{ok:true;text:string}|{ok:false;reason:"signature"|"decrypt"}>{
 if(!await verifyText(m.senderSignPublic,signedMessage(m.senderUserId,m),m.signature))return {ok:false,reason:"signature"};
 try{
  const plain=await subtle().decrypt({name:"AES-GCM",iv:buf(unb64(m.iv)),additionalData:enc.encode(canonical(messageHeader(m.senderUserId,m)))},epochKey,buf(unb64(m.ciphertext)));
  return {ok:true,text:dec.decode(plain)};
 }catch{return {ok:false,reason:"decrypt"};}
}

// Local opaque records use a browser-generated nonextractable KEK, never recovery words.
// Context binding prevents ciphertext substitution between users and record purposes.
export type LocalSealed={v:1;iv:string;ciphertext:string};
const localAad=(user:string,purpose:string)=>enc.encode(canonical(["tabletalk",1,"local-record",user,purpose]));
export async function sealLocalRecord(key:CryptoKey,user:string,purpose:string,value:unknown):Promise<LocalSealed>{
 const raw=enc.encode(canonical(value)),iv=randomBytes(12);
 try{return {v:1,iv:b64(iv),ciphertext:b64(await subtle().encrypt({name:"AES-GCM",iv,additionalData:localAad(user,purpose)},key,raw))};}
 finally{raw.fill(0);}
}
export async function openLocalRecord<T>(key:CryptoKey,user:string,purpose:string,record:LocalSealed):Promise<T>{
 if(record.v!==1)throw new Error("bad_local_record");
 const raw=new Uint8Array(await subtle().decrypt({name:"AES-GCM",iv:buf(unb64(record.iv)),additionalData:localAad(user,purpose)},key,buf(unb64(record.ciphertext))));
 try{return JSON.parse(dec.decode(raw)) as T;}finally{raw.fill(0);}
}
