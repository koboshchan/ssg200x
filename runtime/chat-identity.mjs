import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {digest,shape,uuid,binary,fail,validateDevice,verify,canonical} from './chat-protocol.mjs';
// Clerk metadata merges are not compare-and-swap. Mongo owns the first-setup
// reservation; only its single publisher may fill an entirely empty account.
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
 const occupied=account=>['publicMetadata','privateMetadata'].some(field=>{
  const metadata=account[field];
  if(!Object.hasOwn(metadata||{},'tabletalk'))return false;
  const value=metadata.tabletalk;
  return !value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>0;
 });
 const matches=(account,a)=>a.pendingPublic&&a.pendingBackup&&
  isDeepStrictEqual(account.publicMetadata?.tabletalk?.[a.slot],a.pendingPublic)&&
  isDeepStrictEqual(account.privateMetadata?.tabletalk?.[a.slot],a.pendingBackup);
 async function finish(user,a){
  let account=await clerk.users.getUser(user);
  if(!matches(account,a)){
   // Never repair a partial/different backup by overwriting either side. Legacy
   // pending rotations are also read-only, even if their new slot is empty.
   if(occupied(account)||a.version!==0||a.pendingVersion!==1||!a.pendingPublic||!a.pendingBackup)fail('identity_exists');
   const lock=await active.updateOne({_id:user,status:'pending',slot:a.slot,pendingHash:a.pendingHash},{$set:{status:'publishing'}});
   // Do not steal an empty publishing reservation after a crash: Clerk has no
   // fencing token, so an old in-flight write could still complete. Fail closed.
   if(!lock.matchedCount)fail('identity_unavailable');
   try{
    account=await clerk.users.getUser(user);
    if(occupied(account))fail('identity_exists');
    await clerk.users.updateUserMetadata(user,{publicMetadata:{tabletalk:{[a.slot]:a.pendingPublic}},privateMetadata:{tabletalk:{[a.slot]:a.pendingBackup}}});
   }catch(e){
    // A failed or ambiguous request may retry the same reservation, never a new
    // identity. On retry complete matching data is read, not written again.
    await active.updateOne({_id:user,status:'publishing',slot:a.slot,pendingHash:a.pendingHash},{$set:{status:'pending'}});
    if(e.chatCode==='identity_exists')throw e;
    fail('identity_unavailable');
   }
   account=await clerk.users.getUser(user);
   if(!matches(account,a))fail('identity_unavailable');
  }
  await active.updateOne({_id:user,status:{$in:['pending','publishing']},slot:a.slot,pendingHash:a.pendingHash},{$set:{version:a.pendingVersion,status:'active',committedHash:a.pendingHash},$unset:{pendingVersion:'',pendingHash:'',pendingPublic:'',pendingBackup:''}});
 }
 async function get(user){
  let a=await active.findOne({_id:user});
  if(!a||a.status==='active'&&a.version===0){
   if(occupied(await clerk.users.getUser(user)))fail('identity_exists');
   return {identity:null};
  }
  if(a.status==='pending'||a.status==='publishing'){await finish(user,a);a=await active.findOne({_id:user});}
  if(a.status!=='active'||a.version===0)fail('identity_unavailable');
  const account=await clerk.users.getUser(user),pub=account.publicMetadata?.tabletalk?.[a.slot],backup=account.privateMetadata?.tabletalk?.[a.slot];
  if(!pub||!backup||pub.keyVersion!==a.version)fail('identity_unavailable');
  return {identity:{v:1,keyVersion:a.version,deviceId:pub.deviceId,dhPublic:pub.dhPublic,signPublic:pub.signPublic,backup:validateBackup(backup)}};
 }
 async function put(user,p){
  shape(p,keys);uuid(p.deviceId);await validateDevice(p);const backup=validateBackup(p.backup);
  if(!Number.isSafeInteger(p.expectedVersion)||p.expectedVersion<0||p.keyVersion!==p.expectedVersion+1||p.keyVersion>100000)fail('invalid_version');
  if(!await verify(p.signPublic,signed(user,p),p.signature))fail('invalid_signature');
  const requestHash=digest(canonical(p));
  const before=await active.findOne({_id:user});
  // Lost ACK retries are read-only. No version, backup or public key is replaced.
  if(before?.status==='active'&&before.version===p.keyVersion&&before.committedHash===requestHash)return get(user);
  if(before?.status==='pending'||before?.status==='publishing'){
   if(before.pendingHash!==requestHash)fail('identity_exists');
   return get(user);
  }
  if(before?.version>0||p.expectedVersion!==0||p.keyVersion!==1)fail('identity_exists');
  if(occupied(await clerk.users.getUser(user)))fail('identity_exists');
  await active.updateOne({_id:user},{$setOnInsert:{version:0,status:'active'}},{upsert:true}).catch(e=>{if(e.code!==11000)throw e;});
  const slot='k1_'+randomUUID().replaceAll('-','');
  const lock=await active.updateOne({_id:user,version:0,status:'active'},{$set:{status:'pending',slot,pendingVersion:1,pendingHash:requestHash,pendingPublic:{v:1,keyVersion:1,deviceId:p.deviceId,dhPublic:p.dhPublic,signPublic:p.signPublic},pendingBackup:backup}});
  if(!lock.matchedCount)fail('identity_exists');
  return get(user);
 }
 return {get,put,signed};
}
