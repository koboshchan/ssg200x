import {test} from "node:test";
import assert from "node:assert/strict";
import {createIdentity,openLocalRecord,sealLocalRecord} from "../lib/chat-crypto";

test("pending signed publication is locally sealed without persisting recovery words and restores exact bytes",async()=>{
 const made=await createIdentity("account",0);
 const key=await crypto.subtle.generateKey({name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
 const record=await sealLocalRecord(key,"account","setup-publication",made.body);
 assert.equal(key.extractable,false);
 await assert.rejects(crypto.subtle.exportKey("raw",key));
 assert.equal(JSON.stringify(record).includes(made.body.signature),false);
 assert.equal(JSON.stringify(record).includes(made.words.join(" ")),false);
 const restored=await openLocalRecord(key,"account","setup-publication",structuredClone(record));
 assert.deepEqual(restored,made.body);
 await assert.rejects(openLocalRecord(key,"other-account","setup-publication",record));
 await assert.rejects(openLocalRecord(key,"account","other-purpose",record));
 const wrong=await crypto.subtle.generateKey({name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
 await assert.rejects(openLocalRecord(wrong,"account","setup-publication",record));
 await assert.rejects(openLocalRecord(key,"account","setup-publication",{...record,ciphertext:record.ciphertext.slice(1)}));
});
