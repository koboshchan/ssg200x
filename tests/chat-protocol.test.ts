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
