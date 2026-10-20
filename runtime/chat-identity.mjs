import {randomUUID} from 'node:crypto';
import {digest,shape,uuid,binary,fail,validateDevice,verify,canonical} from './chat-protocol.mjs';
// Clerk updateUserMetadata is a deep merge. Only our immutable slot is touched;
// no read/spread/write of admin or unrelated private metadata is permitted.
export function createIdentityStore(db,clerk){
 const active=db.collection('chat_identity_versions');
 const keys=['v','expectedVersion','keyVersion','deviceId','dhPublic','signPublic','backup','signature'];
 function validateBackup(b){
  shape(b,['v','recoveryScheme','kdf','memoryKiB','iterations','parallelism','salt','iv','ciphertext']);
  if(b.recoveryScheme!=='bip39-english-6-v1'||b.kdf!=='argon2id'||b.memoryKiB!==65536||b.iterations!==3||b.parallelism!==1)fail('invalid_kdf');
  binary(b.salt,32);binary(b.iv,12);binary(b.ciphertext,128,3072);
  return {v:1,recoveryScheme:'bip39-english-6-v1',kdf:'argon2id',memoryKiB:65536,iterations:3,parallelism:1,salt:b.salt,iv:b.iv,ciphertext:b.ciphertext};
 }
 const signed=(user,p)=>canonical(['tabletalk',1,'identity',user,p.expectedVersion,p.keyVersion,p.deviceId,p.dhPublic,p.signPublic,p.backup.recoveryScheme,p.backup.kdf,p.backup.memoryKiB,p.backup.iterations,p.backup.parallelism,p.backup.salt,p.backup.iv,p.backup.ciphertext]);
 async function get(user){
  let a=await active.findOne({_id:user});if(!a)return {identity:null};
  if(a.status==='pending'){
   // Durable encrypted DTO permits recovery without retaining the lost browser request.
   if(a.pendingPublic&&a.pendingBackup){
    try{await clerk.users.updateUserMetadata(user,{publicMetadata:{tabletalk:{[a.slot]:a.pendingPublic}},privateMetadata:{tabletalk:{[a.slot]:a.pendingBackup}}});}catch{fail('identity_unavailable');}
   }
   const saved=await clerk.users.getUser(user);
   if(saved.publicMetadata?.tabletalk?.[a.slot]?.keyVersion!==a.pendingVersion||!saved.privateMetadata?.tabletalk?.[a.slot])fail('identity_unavailable');
   await active.updateOne({_id:user,status:'pending',slot:a.slot,pendingHash:a.pendingHash},{$set:{version:a.pendingVersion,status:'active',committedHash:a.pendingHash},$unset:{pendingVersion:'',pendingHash:'',pendingPublic:'',pendingBackup:''}});
   a=await active.findOne({_id:user});
  }
  if(a.status!=='active'||a.version===0)return {identity:null};
  const account=await clerk.users.getUser(user),pub=account.publicMetadata?.tabletalk?.[a.slot],backup=account.privateMetadata?.tabletalk?.[a.slot];
  if(!pub||!backup||pub.keyVersion!==a.version)fail('identity_unavailable');
  return {identity:{v:1,keyVersion:a.version,deviceId:pub.deviceId,dhPublic:pub.dhPublic,signPublic:pub.signPublic,backup:validateBackup(backup)}};
 }
 async function put(user,p){
  shape(p,keys);uuid(p.deviceId);await validateDevice(p);const backup=validateBackup(p.backup);
  if(!Number.isSafeInteger(p.expectedVersion)||p.expectedVersion<0||p.keyVersion!==p.expectedVersion+1||p.keyVersion>100000)fail('invalid_version');
  if(!await verify(p.signPublic,signed(user,p),p.signature))fail('invalid_signature');
  await active.updateOne({_id:user},{$setOnInsert:{version:0,status:'active'}},{upsert:true}).catch(e=>{if(e.code!==11000)throw e;});
  const before=await active.findOne({_id:user});
  const requestHash=digest(canonical(p));
  // A committed response may be lost. Only the exact signed request may replay.
  if(before?.status==='active'&&before.version===p.keyVersion&&before.committedHash===requestHash)return get(user);
  if(before?.status==='active'&&before.version>0){
   const old=(await get(user)).identity;
   if(old.deviceId===p.deviceId)fail('identity_conflict');
  }
  // Immutable account key IDs cannot be recycled, including after later resets.
  const account=await clerk.users.getUser(user);
  for(const entry of Object.values(account.publicMetadata?.tabletalk||{})){
   if(entry?.deviceId===p.deviceId&&entry.keyVersion!==p.keyVersion)fail('identity_conflict');
   if(entry?.deviceId===p.deviceId&&(entry.dhPublic!==p.dhPublic||entry.signPublic!==p.signPublic))fail('identity_conflict');
  }
  const slot=before?.status==='pending'&&before.pendingHash===digest(canonical(p))?before.slot:'k'+p.keyVersion+'_'+randomUUID().replaceAll('-','');
  const pending=await active.findOne({_id:user,status:'pending',version:p.expectedVersion,pendingHash:digest(canonical(p))});
  const lock=pending?{matchedCount:1}:await active.updateOne({_id:user,version:p.expectedVersion,status:'active'},{$set:{status:'pending',slot,pendingVersion:p.keyVersion,pendingHash:digest(canonical(p)),pendingPublic:{v:1,keyVersion:p.keyVersion,deviceId:p.deviceId,dhPublic:p.dhPublic,signPublic:p.signPublic},pendingBackup:backup}});if(!lock.matchedCount)fail('identity_conflict');
  try{
   await clerk.users.updateUserMetadata(user,{publicMetadata:{tabletalk:{[slot]:{v:1,keyVersion:p.keyVersion,deviceId:p.deviceId,dhPublic:p.dhPublic,signPublic:p.signPublic}}},privateMetadata:{tabletalk:{[slot]:backup}}});
   await active.updateOne({_id:user,slot,status:'pending'},{$set:{version:p.keyVersion,status:'active',committedHash:requestHash},$unset:{pendingVersion:'',pendingHash:'',pendingPublic:'',pendingBackup:''}});
  }catch{
   // Keep fail-closed pending state. Do not allow another identity under this version
   // after an ambiguous Clerk write; caller must retry/recover explicitly.
   fail('identity_unavailable');
  }
  return get(user);
 }
 return {get,put,signed};
}
