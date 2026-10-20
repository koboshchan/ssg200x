import test from "node:test";
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {createIdentity,makeWrap,newEpochKey,openMessage,openWrap,sealMessage,signText,signedMessage,signedWrap} from "../lib/chat-crypto";

const publicId=(id:string)=>createHash("sha256").update(id).digest("hex").slice(0,16);

test("legacy account bindings cannot be DTO-remapped to public IDs without breaking signatures and encryption",async()=>{
 const senderId="user_private_sender",recipientId="user_private_recipient";
 const sender=await createIdentity(senderId,0),recipient=await createIdentity(recipientId,0);
 const key=await newEpochKey(),epoch=randomUUID();
 const fields={revision:1,epoch,id:randomUUID(),ts:Date.now()};
 const sealed=await sealMessage(sender.identity,senderId,fields,"retained history",key);
 const message={...sealed,senderUserId:senderId,senderSignPublic:sender.identity.signPublic,serverTs:fields.ts,cursor:1};
 assert.deepEqual(await openMessage(message,key),{ok:true,text:"retained history"});
 const remapped={...message,senderUserId:publicId(senderId)};
 assert.deepEqual(await openMessage(remapped,key),{ok:false,reason:"signature"});
 // Even a legitimate sender's new signature cannot change the old ciphertext's AES-GCM AAD.
 remapped.signature=await signText(sender.identity.signPrivate,signedMessage(remapped.senderUserId,remapped));
 assert.deepEqual(await openMessage(remapped,key),{ok:false,reason:"decrypt"});
 const wrap=await makeWrap(sender.identity,senderId,{revision:1,epoch,toUserId:recipientId,toDeviceId:recipient.identity.deviceId},recipient.identity.dhPublic,key);
 const legacy={...wrap,senderUserId:senderId};
 await openWrap(recipient.identity,recipientId,legacy,sender.identity);
 const renamed={...legacy,senderUserId:publicId(senderId),toUserId:publicId(recipientId)};
 await assert.rejects(openWrap(recipient.identity,publicId(recipientId),renamed,sender.identity),/bad_wrap_signature/);
 // Re-signing does not repair the HKDF info or AES-GCM AAD either.
 renamed.signature=await signText(sender.identity.signPrivate,signedWrap(renamed.senderUserId,renamed));
 await assert.rejects(openWrap(recipient.identity,publicId(recipientId),renamed,sender.identity));
});

test("existing account private keys can encrypt new public-ID-bound messages without changing key ownership",async()=>{
 const senderId="user_private_sender",recipientId="user_private_recipient";
 const sender=await createIdentity(senderId,0),recipient=await createIdentity(recipientId,0);
 const from=publicId(senderId),to=publicId(recipientId),key=await newEpochKey(),epoch=randomUUID();
 const wrap=await makeWrap(sender.identity,from,{revision:1,epoch,toUserId:to,toDeviceId:recipient.identity.deviceId},recipient.identity.dhPublic,key);
 const opened=await openWrap(recipient.identity,to,{...wrap,senderUserId:from},sender.identity);
 const sealed=await sealMessage(sender.identity,from,{revision:1,epoch,id:randomUUID(),ts:Date.now()},"public identity",key);
 const message={...sealed,senderUserId:from,senderSignPublic:sender.identity.signPublic,serverTs:1,cursor:1};
 assert.deepEqual(await openMessage(message,opened),{ok:true,text:"public identity"});
 const wire=JSON.stringify([wrap,message]);
 assert.equal(wire.includes(senderId),false);assert.equal(wire.includes(recipientId),false);
});
