import test from "node:test";
import assert from "node:assert/strict";
import {createIdentity} from "../lib/chat-crypto";
// @ts-expect-error runtime module
import {createIdentityStore} from "../runtime/chat-identity.mjs";

test("read-only identity fixtures distinguish orphan records, missing backup and valid recovery",async()=>{
 const made=await createIdentity("fixture",0),p=made.body;
 const pub={v:1,keyVersion:p.keyVersion,deviceId:p.deviceId,dhPublic:p.dhPublic,signPublic:p.signPublic};
 for(const kind of ["metadata-only","stored-keys-only","missing-backup","valid"]){
  const pointer=kind==="missing-backup"||kind==="valid"?{status:"active",version:1,slot:"current"}:null;
  const account={publicMetadata:kind==="stored-keys-only"?{}:{tabletalk:{current:pub}},privateMetadata:kind==="valid"?{tabletalk:{current:p.backup}}:{}};
  const storedKey=kind==="stored-keys-only"?{userId:"fixture",...pub}:null;
  const bytes=()=>Buffer.from(JSON.stringify({pointer,account,storedKey}));
  const original=bytes();let writes=0;
  const db={collection:(name:string)=>({
   findOne:async()=>name==="chat_identity_versions"?pointer:name==="chat_devices"?storedKey:null,
   updateOne:async()=>{writes++;throw Error("unexpected write");}
  })};
  const clerk={users:{getUser:async()=>structuredClone(account),updateUserMetadata:async()=>{writes++;throw Error("unexpected write");}}};
  const store=createIdentityStore(db,clerk);
  if(kind==="valid"){
   const result=await store.get("fixture");
   assert.equal(result.identity.deviceId,p.deviceId);assert.deepEqual(result.identity.backup,p.backup);
  }else await assert.rejects(store.get("fixture"),kind==="missing-backup"?/identity_unavailable/:/identity_exists/);
  assert.equal(writes,0);assert.deepEqual(bytes(),original,"pointer, metadata and stored key bytes must remain identical");
 }
});
