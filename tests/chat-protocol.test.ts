import {test} from "node:test";
import assert from "node:assert/strict";
import {webcrypto,randomUUID} from "node:crypto";
// @ts-expect-error runtime module deliberately consumed by Node
import {signedMessage,messageHeader,verify,binary,shape,CHAT_MAX_PAYLOAD} from "../runtime/chat-protocol.mjs";
test("real WebCrypto canonical signed ciphertext rejects tampering and plaintext fields",async()=>{
 const keys=await webcrypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},false,["sign","verify"]);
 const aes=await webcrypto.subtle.generateKey({name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
 const p={v:1,room:"main",revision:1,epoch:randomUUID(),deviceId:randomUUID(),id:randomUUID(),ts:Date.now(),iv:Buffer.from(webcrypto.getRandomValues(new Uint8Array(12))).toString("base64url"),ciphertext:""};
 const aad=new TextEncoder().encode(JSON.stringify(messageHeader("user_a",p)));
 p.ciphertext=Buffer.from(await webcrypto.subtle.encrypt({name:"AES-GCM",iv:Buffer.from(p.iv,"base64url"),additionalData:aad},aes,new TextEncoder().encode("private table text"))).toString("base64url");
 const sig=Buffer.from(await webcrypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},keys.privateKey,new TextEncoder().encode(signedMessage("user_a",p)))).toString("base64url");
 const pub=Buffer.from(await webcrypto.subtle.exportKey("raw",keys.publicKey)).toString("base64url");
 assert.equal(await verify(pub,signedMessage("user_a",p),sig),true);
 for(const field of ["revision","epoch","deviceId","id","iv","ciphertext"]){assert.equal(await verify(pub,signedMessage("user_a",{...p,[field]:field==="revision"?2:"changed"}),sig),false);}
 assert.equal(await verify(pub,signedMessage("user_b",p),sig),false);
 assert.throws(()=>shape({v:1,plaintext:"secret"},["v"]));assert.throws(()=>binary("AA==",1));assert.equal(CHAT_MAX_PAYLOAD,16384);
 assert.equal(keys.privateKey.extractable,false);
});
test('established chat session is revalidated after bounded cache and rejects revocation',async()=>{
 // @ts-expect-error runtime module
 const {sessionGuard}=await import('../runtime/chat-session.mjs');
 let clock=100000,status='active',calls=0;
 const guard=sessionGuard({users:{getUser:async()=>({firstName:'Player',emailAddresses:[{id:'e',emailAddress:'a@example.test',verification:{status:'verified'}}],primaryEmailAddressId:'e',externalAccounts:[{provider:'google',emailAddress:'a@example.test'}],passwordEnabled:false,privateMetadata:{}})},sessions:{getSession:async()=>{calls++;return {status,userId:'user_a'};}}},{now:()=>clock,maxAge:10000});
 const socket={connected:true,data:{expires:200000,sessionId:'sess_a',identity:{id:'user_a'}}};
 await guard(socket);status='revoked';clock+=4999;await guard(socket);assert.equal(calls,1);
 clock+=2;await assert.rejects(guard(socket),/session/);assert.equal(calls,2);
});
