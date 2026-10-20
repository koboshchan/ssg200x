import {test} from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error runtime module
import {verify,signedWrap as serverWrap,signedMessage as serverMessage,registerData as serverRegister,validateDevice,bundleFingerprint as serverFp} from "../runtime/chat-protocol.mjs";
import {createIdentity,restoreIdentity,makeWrap,openWrap,sealMessage,openMessage,newEpochKey,signedWrap,signedMessage,registerData,signText,bundleFingerprint,normalizeWords,unb64,type ServerIdentity} from "../lib/chat-crypto";

const asServer=(user:string,body:Awaited<ReturnType<typeof createIdentity>>["body"]):ServerIdentity=>({v:1,keyVersion:body.keyVersion,deviceId:body.deviceId,dhPublic:body.dhPublic,signPublic:body.signPublic,backup:body.backup});

test("identity payload satisfies the server's validation and signature rules, words restore it",async()=>{
 const made=await createIdentity("user_a",0);
 await validateDevice(made.body);
 assert.equal(made.words.length,6);assert.equal(unb64(made.body.backup.salt).length,32);
 const restored=await restoreIdentity("user_a",asServer("user_a",made.body),made.words.join(" ").toUpperCase());
 assert.equal(restored.signPublic,made.identity.signPublic);
 const sig=await signText(restored.signPrivate,"x");assert.ok(await verify(made.body.signPublic,"x",sig));
 await assert.rejects(restoreIdentity("user_a",asServer("user_a",made.body),"abandon abandon abandon abandon abandon about"),/wrong_words/);
 await assert.rejects(restoreIdentity("user_b",asServer("user_b",made.body),made.words.join(" ")),/wrong_words/);
 assert.throws(()=>normalizeWords("one two"),/bad_words/);
 assert.equal(made.identity.signPrivate.extractable,false);assert.equal(made.identity.dhPrivate.extractable,false);
});
test("canonical strings and fingerprints match the server byte for byte",async()=>{
 const a=await createIdentity("user_a",0),b=await createIdentity("user_b",0);
 const w={room:"main",revision:3,epoch:"4b1d6a0c-1c3e-4d8a-9a3c-1f2e3d4c5b6a",deviceId:a.identity.deviceId,toUserId:"user_b",toDeviceId:b.identity.deviceId,salt:"s",iv:"i",ciphertext:"c"};
 assert.equal(signedWrap("user_a",w),serverWrap("user_a",w));
 const m={room:"main",revision:3,epoch:w.epoch,deviceId:a.identity.deviceId,id:"id",ts:5,iv:"i",ciphertext:"c"};
 assert.equal(signedMessage("user_a",m),serverMessage("user_a",m));
 assert.equal(registerData("user_a",a.identity),serverRegister("user_a",a.identity));
 assert.equal(await bundleFingerprint("user_a",a.identity),serverFp("user_a",a.identity));
});
test("wrap and message round trip with server-verifiable signatures; tampering is rejected before decrypt",async()=>{
 const a=await createIdentity("user_a",0),b=await createIdentity("user_b",0),key=await newEpochKey();
 const epoch="4b1d6a0c-1c3e-4d8a-9a3c-1f2e3d4c5b6a";
 const wrap=await makeWrap(a.identity,"user_a",{revision:2,epoch,toUserId:"user_b",toDeviceId:b.identity.deviceId},b.identity.dhPublic,key);
 assert.ok(await verify(a.identity.signPublic,serverWrap("user_a",wrap),wrap.signature));
 const wire={...wrap,senderUserId:"user_a"};
 const opened=await openWrap(b.identity,"user_b",wire,a.identity);
 const id="0b7e1c3a-5f1d-4a56-8c1e-2d3f4a5b6c7d";
 const sealed=await sealMessage(a.identity,"user_a",{revision:2,epoch,id,ts:Date.now()},"héllo 🎲",key);
 assert.ok(await verify(a.identity.signPublic,serverMessage("user_a",sealed),sealed.signature));
 const msg={...sealed,senderUserId:"user_a",senderSignPublic:a.identity.signPublic,serverTs:1,cursor:1};
 assert.deepEqual(await openMessage(msg,opened),{ok:true,text:"héllo 🎲"});
 assert.deepEqual(await openMessage({...msg,senderUserId:"user_b"},opened),{ok:false,reason:"signature"});
 assert.deepEqual(await openMessage({...msg,senderSignPublic:b.identity.signPublic},opened),{ok:false,reason:"signature"});
 const flipped=unb64(msg.ciphertext);flipped[0]^=1;
 const forged=await signText(a.identity.signPrivate,serverMessage("user_a",{...msg,ciphertext:Buffer.from(flipped).toString("base64url")}));
 assert.deepEqual(await openMessage({...msg,ciphertext:Buffer.from(flipped).toString("base64url"),signature:forged},opened),{ok:false,reason:"decrypt"});
 await assert.rejects(openWrap(b.identity,"user_b",{...wire,epoch:"5b1d6a0c-1c3e-4d8a-9a3c-1f2e3d4c5b6a"},a.identity),/bad_wrap_signature/);
 await assert.rejects(openWrap(a.identity,"user_a",wire,a.identity),/wrong_recipient/);
 await assert.rejects(openWrap(b.identity,"user_b",wire,b.identity),/bad_wrap_signature/);
 await assert.rejects(sealMessage(a.identity,"user_a",{revision:2,epoch,id,ts:1},"x".repeat(4097),key),/bad_length/);
});
