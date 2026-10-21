import {test} from "node:test";
import assert from "node:assert/strict";
import {createIdentity,b64,unb64} from "../lib/chat-crypto";
import {sealDm,openDm,pinState,pinOf,dmFingerprint,DM_MAX_CIPHERTEXT,type DmHistoryMessage,type DmPeer} from "../lib/dm-crypto";

async function party(user:string){const made=await createIdentity(user,0);return {user,id:made.identity};}
const peerOf=(p:Awaited<ReturnType<typeof party>>):DmPeer=>({userId:p.user,deviceId:p.id.deviceId,keyVersion:p.id.keyVersion,dhPublic:p.id.dhPublic,signPublic:p.id.signPublic});
function history(a:Awaited<ReturnType<typeof party>>,b:Awaited<ReturnType<typeof party>>,w:Awaited<ReturnType<typeof sealDm>>):DmHistoryMessage{
 return {...w,senderUserId:a.user,senderDhPublic:a.id.dhPublic,senderSignPublic:a.id.signPublic,recipientDhPublic:b.id.dhPublic,recipientSignPublic:b.id.signPublic,serverTs:1,cursor:"1"};
}
async function setup(){
 const a=await party("user_a"),b=await party("user_b");
 const wire=await sealDm(a.id,a.user,peerOf(b),"hello \u{1F431} there");
 return {a,b,wire,msg:history(a,b,wire)};
}
test("recipient and sender both decrypt",async()=>{
 const {a,b,msg}=await setup();
 const r=await openDm(b.id,b.user,msg),s=await openDm(a.id,a.user,msg);
 assert.deepEqual(r,{ok:true,text:"hello \u{1F431} there",mine:false});
 assert.deepEqual(s,{ok:true,text:"hello \u{1F431} there",mine:true});
});
test("wire has no plaintext and fixed field sizes",async()=>{
 const {wire}=await setup();
 assert.ok(!JSON.stringify(wire).includes("hello"));
 assert.equal(unb64(wire.salt).length,32);assert.equal(unb64(wire.iv).length,12);assert.equal(unb64(wire.signature).length,64);
 const big=await party("user_a"),other=await party("user_b");
 const max=await sealDm(big.id,big.user,peerOf(other),"x".repeat(4096));
 assert.equal(unb64(max.ciphertext).length,DM_MAX_CIPHERTEXT);
 await assert.rejects(sealDm(big.id,big.user,peerOf(other),"x".repeat(4097)),/bad_text/);
 await assert.rejects(sealDm(big.id,big.user,peerOf(other),"   "),/bad_text/);
});
test("each message gets fresh salt, iv and key",async()=>{
 const a=await party("user_a"),b=await party("user_b");
 const m1=await sealDm(a.id,a.user,peerOf(b),"same"),m2=await sealDm(a.id,a.user,peerOf(b),"same");
 assert.notEqual(m1.salt,m2.salt);assert.notEqual(m1.iv,m2.iv);assert.notEqual(m1.ciphertext,m2.ciphertext);
});
test("tampering with any signed field is rejected before decrypt",async()=>{
 const {a,b,msg}=await setup();
 const flip=(s:string)=>b64(Uint8Array.from(unb64(s),(x,i)=>i===0?x^1:x));
 for(const patch of [{ciphertext:flip(msg.ciphertext)},{iv:flip(msg.iv)},{salt:flip(msg.salt)},{id:"00000000-0000-4000-8000-000000000000"},{toUserId:"user_c"},{senderDeviceId:"other"},{recipientKeyVersion:9},{senderKeyVersion:9},{signature:flip(msg.signature)}]){
  const r=await openDm(b.id,b.user,{...msg,...patch});
  assert.equal(r.ok,false,JSON.stringify(Object.keys(patch)));
 }
 assert.equal((await openDm(b.id,b.user,{...msg,ciphertext:flip(msg.ciphertext)})).ok,false);
 assert.deepEqual(await openDm(b.id,b.user,{...msg,v:2 as 1}),{ok:false,reason:"malformed"});
});
test("snapshot swap by the server fails",async()=>{
 const {b,msg}=await setup();
 const mallory=await party("user_a");
 // Attacker substitutes own sign key snapshot: signature will not verify.
 assert.deepEqual(await openDm(b.id,b.user,{...msg,senderSignPublic:mallory.id.signPublic}),{ok:false,reason:"signature"});
 // Forged dh snapshot changes the derived key, so decrypt fails.
 assert.equal((await openDm(b.id,b.user,{...msg,senderDhPublic:mallory.id.dhPublic})).ok,false);
});
test("wrong recipient, key version or device is refused",async()=>{
 const {a,b,msg}=await setup();
 const c=await party("user_c");
 assert.deepEqual(await openDm(c.id,c.user,msg),{ok:false,reason:"wrong_recipient"});
 assert.deepEqual(await openDm({...b.id,keyVersion:2},b.user,msg),{ok:false,reason:"wrong_recipient"});
 assert.deepEqual(await openDm({...b.id,deviceId:"zzz"},b.user,msg),{ok:false,reason:"wrong_recipient"});
 assert.deepEqual(await openDm({...a.id,keyVersion:5},a.user,msg),{ok:false,reason:"wrong_recipient"});
 // right user id but a different identity cannot decrypt
 const imposter=await party("user_b");
 assert.equal((await openDm(imposter.id,"user_b",msg)).ok,false);
});
test("replayed message to another recipient is refused",async()=>{
 const {a,b,msg}=await setup();const c=await party("user_c");
 assert.equal((await openDm(c.id,c.user,{...msg,toUserId:c.user,recipientDeviceId:c.id.deviceId,recipientKeyVersion:c.id.keyVersion,recipientDhPublic:c.id.dhPublic,recipientSignPublic:c.id.signPublic})).ok,false);
});
test("TOFU pins detect key changes and fingerprints are stable",async()=>{
 const a=await party("user_a"),a2=await party("user_a");
 const pin=pinOf({...peerOf(a)});
 assert.equal(pinState(undefined,a.id),"new");assert.equal(pinState(pin,a.id),"same");assert.equal(pinState(pin,a2.id),"changed");
 assert.equal(await dmFingerprint("user_a",a.id),await dmFingerprint("user_a",a.id));
 assert.notEqual(await dmFingerprint("user_a",a.id),await dmFingerprint("user_a",a2.id));
});
test("invalid peer bundle, identifiers and noncanonical encoding fail closed",async()=>{
 const {a,b,msg}=await setup();
 assert.equal(pinState(pinOf(b.id),{...b.id,keyVersion:2}),"changed");
 assert.equal(pinState(pinOf(b.id),{...b.id,deviceId:crypto.randomUUID()}),"changed");
 for(const patch of [
  {userId:a.user},{userId:"bad user"},{deviceId:"not-a-uuid"},{keyVersion:0},
  {keyVersion:1.5},{dhPublic:b.id.dhPublic+"="},{signPublic:b.id.dhPublic}
 ]){
  await assert.rejects(sealDm(a.id,a.user,{...peerOf(b),...patch},"hello"));
 }
 await assert.rejects(sealDm(a.id,a.user,peerOf(b),"hello","not-a-uuid"));
 for(const patch of [
  {salt:msg.salt+"="},{iv:msg.iv+"="},{signature:msg.signature+"="},
  {senderKeyVersion:0},{recipientKeyVersion:NaN},{senderUserId:"bad user"},
  {recipientDhPublic:"abc"},{recipientDeviceId:"invalid"},
 ]){
  assert.deepEqual(await openDm(b.id,b.user,{...msg,...patch}),{ok:false,reason:"malformed"});
 }
});
test("identity recovery in a second device retains DM access without new keys",async()=>{
 const a=await createIdentity("user_a",0),b=await createIdentity("user_b",0);
 const wire=await sealDm(a.identity,"user_a",{userId:"user_b",...b.identity},"recovered");
 const msg: DmHistoryMessage={...wire,senderUserId:"user_a",senderDhPublic:a.identity.dhPublic,senderSignPublic:a.identity.signPublic,recipientDhPublic:b.identity.dhPublic,recipientSignPublic:b.identity.signPublic,serverTs:1,cursor:"1"};
 const {restoreIdentity}=await import("../lib/chat-crypto");
 const restored=await restoreIdentity("user_b",{...b.body,v:1},b.words.join(" "));
 assert.deepEqual(await openDm(restored,"user_b",msg),{ok:true,text:"recovered",mine:false});
});
