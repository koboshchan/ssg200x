// Direct-message crypto. WebCrypto only, runs in browsers and Node, no storage, no logging.
// Reuses the TableTalk identity (P-256 ECDH + ECDSA). Per message: static ECDH, HKDF-SHA256 with a
// random salt, AES-256-GCM with a random IV. The server only sees ciphertext and routing fields.
import {b64,unb64,canonical,randomBytes,signText,verifyText,sha256Url,MAX_TEXT_BYTES,type Identity} from "./chat-crypto";

const enc=new TextEncoder(),dec=new TextDecoder("utf-8",{fatal:true});
const subtle=()=>globalThis.crypto.subtle;
const buf=(u:Uint8Array)=>u as Uint8Array<ArrayBuffer>;
export const DM_MAX_CIPHERTEXT=MAX_TEXT_BYTES+16;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const USER=/^[A-Za-z0-9_-]{1,128}$/;
const version=(v:number)=>Number.isSafeInteger(v)&&v>=1&&v<=100000;
function binary(text:string,min:number,max=min){
 const raw=unb64(text);
 if(raw.length<min||raw.length>max||b64(raw)!==text)throw new Error("bad_encoding");
 return raw;
}
function bundle(k:{deviceId:string;keyVersion:number;dhPublic:string;signPublic:string}){
 if(!UUID.test(k.deviceId)||!version(k.keyVersion)||k.dhPublic===k.signPublic)throw new Error("bad_peer");
 if(binary(k.dhPublic,65)[0]!==4||binary(k.signPublic,65)[0]!==4)throw new Error("bad_peer");
}

export type DmPeer={userId:string;deviceId:string;keyVersion:number;dhPublic:string;signPublic:string};
export type DmWire={v:1;id:string;toUserId:string;senderDeviceId:string;recipientDeviceId:string;senderKeyVersion:number;recipientKeyVersion:number;salt:string;iv:string;ciphertext:string;signature:string};
export type DmHistoryMessage=DmWire&{senderUserId:string;senderDhPublic:string;senderSignPublic:string;recipientDhPublic:string;recipientSignPublic:string;serverTs:number;cursor:string};
export type DmOpen={ok:true;text:string;mine:boolean}|{ok:false;reason:"malformed"|"signature"|"wrong_recipient"|"decrypt"};

type Header={sender:string;to:string;id:string;sdev:string;rdev:string;skv:number;rkv:number;salt:string};
const header=(h:Header)=>["ssg-dm",1,h.sender,h.to,h.id,h.sdev,h.rdev,h.skv,h.rkv,h.salt];
const signedData=(h:Header,iv:string,ciphertext:string)=>canonical([...header(h),iv,ciphertext]);
export const dmSignedData=signedData;

async function messageKey(dhPrivate:CryptoKey,otherDhPublic:string,h:Header){
 const pub=await subtle().importKey("raw",buf(unb64(otherDhPublic)),{name:"ECDH",namedCurve:"P-256"},false,[]);
 const bits=await subtle().deriveBits({name:"ECDH",public:pub},dhPrivate,256);
 const base=await subtle().importKey("raw",bits,"HKDF",false,["deriveKey"]);
 return subtle().deriveKey({name:"HKDF",hash:"SHA-256",salt:buf(unb64(h.salt)),info:enc.encode(canonical(header(h)))},base,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
}
const aad=(h:Header)=>enc.encode(canonical(header(h)));

/** Encrypt and sign a message to one peer. Throws on empty or oversized text. */
export async function sealDm(me:Identity,myUserId:string,peer:DmPeer,text:string,id:string=globalThis.crypto.randomUUID()):Promise<DmWire>{
 if(!USER.test(myUserId)||!USER.test(peer.userId)||myUserId===peer.userId||!UUID.test(id))throw new Error("bad_peer");
 bundle(me);bundle(peer);
 const plain=enc.encode(text);
 if(!text.trim()||plain.length>MAX_TEXT_BYTES)throw new Error("bad_text");
 const h:Header={sender:myUserId,to:peer.userId,id,sdev:me.deviceId,rdev:peer.deviceId,skv:me.keyVersion,rkv:peer.keyVersion,salt:b64(randomBytes(32))};
 const iv=randomBytes(12);
 const key=await messageKey(me.dhPrivate,peer.dhPublic,h);
 const ciphertext=b64(new Uint8Array(await subtle().encrypt({name:"AES-GCM",iv:buf(iv),additionalData:buf(aad(h))},key,buf(plain))));
 const ivText=b64(iv);
 return {v:1,id,toUserId:peer.userId,senderDeviceId:h.sdev,recipientDeviceId:h.rdev,senderKeyVersion:h.skv,recipientKeyVersion:h.rkv,salt:h.salt,iv:ivText,ciphertext,signature:await signText(me.signPrivate,signedData(h,ivText,ciphertext))};
}
function wellFormed(m:DmHistoryMessage){
 try{
  if(m.v!==1||!UUID.test(m.id)||![m.senderUserId,m.toUserId,m.senderDeviceId,m.recipientDeviceId,m.senderDhPublic,m.senderSignPublic,m.recipientDhPublic,m.recipientSignPublic].every(s=>typeof s==="string"&&s.length>0))return false;
  if(!USER.test(m.senderUserId)||!USER.test(m.toUserId)||m.senderUserId===m.toUserId)return false;
  bundle({deviceId:m.senderDeviceId,keyVersion:m.senderKeyVersion,dhPublic:m.senderDhPublic,signPublic:m.senderSignPublic});
  bundle({deviceId:m.recipientDeviceId,keyVersion:m.recipientKeyVersion,dhPublic:m.recipientDhPublic,signPublic:m.recipientSignPublic});
  binary(m.salt,32);binary(m.iv,12);binary(m.signature,64);binary(m.ciphertext,17,DM_MAX_CIPHERTEXT);
  return true;
 }catch{return false;}
}
/** Verify the signature against the sender snapshot first, then check it is for this identity, then decrypt. */
export async function openDm(me:Identity,myUserId:string,m:DmHistoryMessage):Promise<DmOpen>{
 if(!wellFormed(m))return {ok:false,reason:"malformed"};
 const h:Header={sender:m.senderUserId,to:m.toUserId,id:m.id,sdev:m.senderDeviceId,rdev:m.recipientDeviceId,skv:m.senderKeyVersion,rkv:m.recipientKeyVersion,salt:m.salt};
 if(!await verifyText(m.senderSignPublic,signedData(h,m.iv,m.ciphertext),m.signature))return {ok:false,reason:"signature"};
 const mine=m.senderUserId===myUserId;
 let otherDh:string;
 if(mine){
  if(m.senderDeviceId!==me.deviceId||m.senderKeyVersion!==me.keyVersion||m.senderDhPublic!==me.dhPublic||m.senderSignPublic!==me.signPublic)return {ok:false,reason:"wrong_recipient"};
  otherDh=m.recipientDhPublic;
 }else{
  if(m.toUserId!==myUserId||m.recipientDeviceId!==me.deviceId||m.recipientKeyVersion!==me.keyVersion||m.recipientDhPublic!==me.dhPublic||m.recipientSignPublic!==me.signPublic)return {ok:false,reason:"wrong_recipient"};
  otherDh=m.senderDhPublic;
 }
 try{
  const key=await messageKey(me.dhPrivate,otherDh,h);
  const plain=new Uint8Array(await subtle().decrypt({name:"AES-GCM",iv:buf(unb64(m.iv)),additionalData:buf(aad(h))},key,buf(unb64(m.ciphertext))));
  return {ok:true,text:dec.decode(plain),mine};
 }catch{return {ok:false,reason:"decrypt"};}
}

// Trust on first use. Pins are per DM purpose, never shared with room chat pins.
export type DmPin={deviceId:string;keyVersion:number;dhPublic:string;signPublic:string};
export type PinState="new"|"same"|"changed";
export const pinOf=(k:{deviceId:string;keyVersion:number;dhPublic:string;signPublic:string}):DmPin=>({deviceId:k.deviceId,keyVersion:k.keyVersion,dhPublic:k.dhPublic,signPublic:k.signPublic});
export function pinState(pin:DmPin|undefined,k:DmPin):PinState{
 if(!pin)return "new";
 return pin.deviceId===k.deviceId&&pin.keyVersion===k.keyVersion&&pin.dhPublic===k.dhPublic&&pin.signPublic===k.signPublic?"same":"changed";
}
/** Short grouped fingerprint people can compare out of band. */
export async function dmFingerprint(userId:string,k:{dhPublic:string;signPublic:string}){
 const h=await sha256Url(canonical(["ssg-dm","key",userId,k.dhPublic,k.signPublic]));
 return (h.slice(0,30).match(/.{1,5}/g)||[]).join(" ");
}
