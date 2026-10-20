// Ciphertext/signature/TOFU pattern adapted from koboshchan/mango
// 679239b22dc3c6d1f074762ba03e5edcb1426f68 server/src/messages.ts and sig.ts.
import {webcrypto,createHash} from 'node:crypto';
export const CHAT_MAX_PAYLOAD=16384;
export const canonical=a=>JSON.stringify(a);
export const digest=s=>createHash('sha256').update(s).digest('base64url');
export function fail(code='malformed'){throw Object.assign(new Error(code),{chatCode:code});}
export function shape(o,required,optional=[]){
 if(!o||typeof o!=='object'||Array.isArray(o)||Object.getPrototypeOf(o)!==Object.prototype)fail();
 if(Object.keys(o).some(k=>![...required,...optional].includes(k))||required.some(k=>!Object.hasOwn(o,k))||o.v!==1)fail();
}
export function uuid(s){if(typeof s!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s))fail();return s;}
export function binary(s,min,max=min){if(typeof s!=='string'||s.length>Math.ceil(max*4/3)||! /^[A-Za-z0-9_-]+$/.test(s))fail();const b=Buffer.from(s,'base64url');if(b.length<min||b.length>max||b.toString('base64url')!==s)fail();return b;}
export function text(s){if(typeof s!=='string'||s.length<1||s.length>128||! /^[a-zA-Z0-9_-]+$/.test(s))fail();return s;}
export const registerData=(u,p)=>canonical(['tabletalk',1,'register',u,p.deviceId,p.dhPublic,p.signPublic]);
export const bundleFingerprint=(u,p)=>digest(canonical(['tabletalk',1,'device',u,p.deviceId,p.dhPublic,p.signPublic]));
export const wrapHeader=(u,p)=>['tabletalk',1,'wrap',p.room,p.revision,p.epoch,u,p.deviceId,p.toUserId,p.toDeviceId];
export const messageHeader=(u,p)=>['tabletalk',1,'message',p.room,p.revision,p.epoch,u,p.deviceId,p.id,p.ts];
export const signedWrap=(u,p)=>canonical([...wrapHeader(u,p),p.salt,p.iv,p.ciphertext]);
export const signedMessage=(u,p)=>canonical([...messageHeader(u,p),p.iv,p.ciphertext]);
export async function verify(pub,data,sig){try{const key=await webcrypto.subtle.importKey('raw',binary(pub,65),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);return await webcrypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,binary(sig,64),new TextEncoder().encode(data));}catch{return false;}}
export async function validateDevice(p){binary(p.signPublic,65);const raw=binary(p.dhPublic,65);if(raw[0]!==4||p.signPublic===p.dhPublic)fail();try{await webcrypto.subtle.importKey('raw',raw,{name:'ECDH',namedCurve:'P-256'},false,[]);}catch{fail();}}
