import {createIdentityStore} from './chat-identity.mjs';
import {randomUUID} from 'node:crypto';
import {shape,uuid,binary,text,fail,digest,registerData,bundleFingerprint,signedWrap,signedMessage,verify,validateDevice} from './chat-protocol.mjs';
// All persistence is constructed field by field. Never spread caller input into Mongo.
export function createChatService(db,{now=Date.now,clerk}={}){
 const identity=clerk?createIdentityStore(db,clerk):null;
 const rooms=db.collection('rooms'),states=db.collection('chat_states'),devices=db.collection('chat_devices'),wraps=db.collection('chat_wraps'),messages=db.collection('chat_messages'),rates=db.collection('chat_rates');
 let queue=Promise.resolve(),pending=0;
 const serial=fn=>{if(pending>=128)return Promise.reject(Object.assign(new Error("busy"),{chatCode:"busy"}));pending++;const result=queue.then(fn).finally(()=>pending--);queue=result.catch(()=>{});return result;};
 const ready=Promise.all([messages.createIndex({epoch:1,senderUserId:1,id:1},{unique:true}),messages.createIndex({epoch:1,cursor:-1}),devices.createIndex({userId:1,deviceId:1},{unique:true}),rates.createIndex({expiresAt:1},{expireAfterSeconds:0})]);
 async function rate(user){const minute=Math.floor(now()/60000),id=user+':'+minute;await rates.updateOne({_id:id},{$setOnInsert:{count:0,expiresAt:new Date(now()+180000)}},{upsert:true});if(!(await rates.updateOne({_id:id,count:{$lt:120}},{$inc:{count:1}})).matchedCount)fail('rate_limited');}
 async function snapshot(user){
  const room=await rooms.findOne({_id:'main'});const members=(room?.members||[]).filter(m=>m.approved===true&&!m.accessRevoked).map(m=>m.id).sort();
  if(!members.includes(user))fail('forbidden');
  const directory=await devices.find({userId:{$in:members}},{projection:{_id:0,userId:1,deviceId:1,dhPublic:1,signPublic:1}}).sort({userId:1,deviceId:1}).limit(4096).toArray();
  const fingerprint=digest(JSON.stringify([members,directory]));
  let state=await states.findOne({_id:'main'});
  if(!state){await states.updateOne({_id:'main'},{$setOnInsert:{revision:1,epoch:randomUUID(),fingerprint,status:'unclaimed',owner:null,leaseUntil:0,counter:0,removalVersion:room.chatRemovalVersion||0,members,directory}},{upsert:true});state=await states.findOne({_id:'main'});}
  if(state.fingerprint!==fingerprint||(state.removalVersion||0)!==(room.chatRemovalVersion||0)){const removed=(state.members||[]).some(u=>!members.includes(u));const rotate=removed||(state.removalVersion||0)!==(room.chatRemovalVersion||0);if(rotate&&state.bootstrap)await wraps.updateOne({_id:state.bootstrap._id},{$setOnInsert:state.bootstrap},{upsert:true});const changed=await states.updateOne({_id:'main',revision:state.revision,fingerprint:state.fingerprint},{$set:{fingerprint,members,directory,removalVersion:room.chatRemovalVersion||0,...(rotate?{epoch:randomUUID(),status:'unclaimed',owner:null,leaseUntil:0,counter:0,bootstrap:null}:{})},$inc:{revision:1}});if(!changed.matchedCount)fail('stale_revision');state=await states.findOne({_id:'main'});}
  return {room,members,directory,state};
 }
 async function fence(s,user){
  // Linearization point against existing room mutations, which already CAS version.
  const current=await snapshot(user);if(current.state.revision!==s.state.revision||current.state.epoch!==s.state.epoch)fail('stale_revision');
  if(!(await rooms.updateOne({_id:'main',version:current.room.version},{$inc:{version:1}})).matchedCount)fail('stale_revision');
 }
 function current(p,s){if(p.room!==undefined&&p.room!=='main')fail();if(!Number.isSafeInteger(p.revision)||p.revision!==s.state.revision||uuid(p.epoch)!==s.state.epoch)fail('stale_revision');uuid(p.deviceId);}
 async function device(user,id){const d=await devices.findOne({userId:user,deviceId:uuid(id)});if(!d)fail('device_required');if(identity){const pointer=await db.collection('chat_identity_versions').findOne({_id:user});if(!pointer||pointer.status!=='active'||pointer.version!==d.keyVersion)fail('identity_conflict');}return d;}
 async function hasWrap(epoch,user,id){const state=await states.findOne({_id:'main',epoch});if(state?.bootstrap?.toUserId===user&&state.bootstrap.toDeviceId===id)return state.bootstrap;return wraps.findOne({_id:digest(JSON.stringify([epoch,user,id]))});}
 function view(s,user,ws){return {room:'main',revision:s.state.revision,epoch:s.state.epoch,status:s.state.status,owner:s.state.owner,leaseUntil:s.state.leaseUntil,members:s.members.map(userId=>({userId,devices:s.directory.filter(d=>d.userId===userId).map(d=>({deviceId:d.deviceId,dhPublic:d.dhPublic,signPublic:d.signPublic,fingerprint:bundleFingerprint(userId,d)}))})),wraps:ws};}
 const cleanWrap=d=>({v:1,room:'main',revision:d.revision,epoch:d.epoch,senderUserId:d.senderUserId,deviceId:d.deviceId,toUserId:d.toUserId,toDeviceId:d.toDeviceId,salt:d.salt,iv:d.iv,ciphertext:d.ciphertext,signature:d.signature});
 const cleanMessage=d=>({v:1,room:'main',revision:d.revision,epoch:d.epoch,senderUserId:d.senderUserId,deviceId:d.deviceId,id:d.id,ts:d.ts,iv:d.iv,ciphertext:d.ciphertext,signature:d.signature,senderSignPublic:d.senderSignPublic,serverTs:d.serverTs,cursor:d.cursor});
 async function perform(user,event,p){await ready;text(user);await rate(user);const s=await snapshot(user);
  if(event==='keys:get'){shape(p,['v']);if(!identity)fail('identity_unavailable');return identity.get(user);}
  if(event==='keys:put'){
   if(!identity)fail('identity_unavailable');
   const result=await identity.put(user,p);
   await devices.deleteMany({userId:user});
   const d=result.identity;
   await devices.insertOne({_id:d.deviceId,userId:user,deviceId:d.deviceId,dhPublic:d.dhPublic,signPublic:d.signPublic,keyVersion:d.keyVersion});
   return result;
  }
  if(event==='state'){shape(p,['v']);const ws=await wraps.find({toUserId:user,toDeviceId:{$in:s.directory.filter(d=>d.userId===user).map(d=>d.deviceId)}}).limit(512).toArray();if(s.state.bootstrap?.toUserId===user&&!ws.some(w=>w._id===s.state.bootstrap._id))ws.push(s.state.bootstrap);await fence(s,user);return view(s,user,ws.map(cleanWrap));}
  if(event==='register'){
   shape(p,['v','deviceId','dhPublic','signPublic','signature']);uuid(p.deviceId);
   if(identity){const owned=(await identity.get(user)).identity;if(!owned||owned.deviceId!==p.deviceId||owned.dhPublic!==p.dhPublic||owned.signPublic!==p.signPublic)fail('identity_conflict');}await validateDevice(p);if(!await verify(p.signPublic,registerData(user,p),p.signature))fail('invalid_signature');
   const old=await devices.findOne({deviceId:p.deviceId});if(old&&(old.userId!==user||old.dhPublic!==p.dhPublic||old.signPublic!==p.signPublic))fail('device_conflict');
   if(!old){if(await devices.countDocuments({userId:user})>=8)fail('device_limit');await fence(s,user);await devices.insertOne({_id:p.deviceId,userId:user,deviceId:p.deviceId,dhPublic:p.dhPublic,signPublic:p.signPublic,...(identity?{keyVersion:(await identity.get(user)).identity.keyVersion}:{})});}
   return view(await snapshot(user),user,[]);
  }
  if(event==='claim'){
   shape(p,['v','revision','epoch','deviceId']);current(p,s);await device(user,p.deviceId);await fence(s,user);
   if(s.state.status==='claimed'&&s.state.owner?.userId===user&&s.state.owner?.deviceId===p.deviceId&&s.state.leaseUntil>now())return view(s,user,[]);
   const takeover=s.state.status==='claimed'&&s.state.leaseUntil<=now();
   if(s.state.status!=='unclaimed'&&!takeover)fail('waiting');
   if(await wraps.countDocuments({epoch:p.epoch})||await messages.countDocuments({epoch:p.epoch}))fail('waiting');
   const epoch=takeover?randomUUID():p.epoch;
   const result=await states.updateOne({_id:'main',revision:p.revision,epoch:p.epoch,status:s.state.status,leaseUntil:s.state.leaseUntil},{$set:{epoch,status:'claimed',owner:{userId:user,deviceId:p.deviceId},leaseUntil:now()+30000}});if(!result.matchedCount)fail('stale_revision');
   return view(await snapshot(user),user,[]);
  }
  if(event==='wrap'){
   shape(p,['v','room','revision','epoch','deviceId','toUserId','toDeviceId','salt','iv','ciphertext','signature']);current(p,s);text(p.toUserId);uuid(p.toDeviceId);binary(p.salt,32);binary(p.iv,12);binary(p.ciphertext,48);binary(p.signature,64);
   const d=await device(user,p.deviceId);if(!s.members.includes(p.toUserId))fail('forbidden');await device(p.toUserId,p.toDeviceId);
   if(!await verify(d.signPublic,signedWrap(user,p),p.signature))fail('invalid_signature');
   const ownedSelf=await hasWrap(p.epoch,user,p.deviceId);
   const recovering=ownedSelf&&ownedSelf.content===signedWrap(user,p)&&p.toUserId===user&&p.toDeviceId===p.deviceId;
   const initial=s.state.status==='claimed'&&s.state.owner?.userId===user&&s.state.owner?.deviceId===p.deviceId&&(s.state.leaseUntil>now()||recovering);
   if(initial&&(p.toUserId!==user||p.toDeviceId!==p.deviceId))fail('self_wrap_required');
   if(!initial&&(s.state.status!=='active'||!await hasWrap(p.epoch,user,p.deviceId)))fail('waiting');
   await fence(s,user);
   const id=digest(JSON.stringify([p.epoch,p.toUserId,p.toDeviceId])),content=signedWrap(user,p),existing=await hasWrap(p.epoch,p.toUserId,p.toDeviceId);
   if(existing){if(existing.content!==content||existing.signature!==p.signature)fail('conflict');if(initial)await states.updateOne({_id:'main',revision:p.revision,epoch:p.epoch,status:'claimed',owner:s.state.owner},{$set:{status:'active',leaseUntil:0}});return {wrap:cleanWrap(existing)};}
   const doc={_id:id,v:1,room:'main',revision:p.revision,epoch:p.epoch,senderUserId:user,deviceId:p.deviceId,toUserId:p.toUserId,toDeviceId:p.toDeviceId,salt:p.salt,iv:p.iv,ciphertext:p.ciphertext,signature:p.signature,content};
   if(initial){const activation=await states.updateOne({_id:'main',revision:p.revision,epoch:p.epoch,status:'claimed',owner:s.state.owner},{$set:{status:'active',leaseUntil:0,bootstrap:doc}});if(!activation.matchedCount)fail('stale_revision');}
   else await wraps.insertOne(doc);
   return {wrap:cleanWrap(doc)};
  }
  if(event==='send'){
   shape(p,['v','room','revision','epoch','deviceId','id','ts','iv','ciphertext','signature']);current(p,s);uuid(p.id);binary(p.iv,12);binary(p.ciphertext,17,4112);binary(p.signature,64);if(!Number.isSafeInteger(p.ts))fail();
   const d=await device(user,p.deviceId);if(s.state.status!=='active'||!await hasWrap(p.epoch,user,p.deviceId))fail('waiting');
   const content=signedMessage(user,p);if(!await verify(d.signPublic,content,p.signature))fail('invalid_signature');
   const prior=await messages.findOne({epoch:p.epoch,senderUserId:user,id:p.id});if(prior){if(prior.content!==content)fail('conflict');await fence(s,user);return {message:cleanMessage(prior),duplicate:true};}
   if(Math.abs(now()-p.ts)>300000)fail('expired');await fence(s,user);
   const counter=await states.findOneAndUpdate({_id:'main',revision:p.revision,epoch:p.epoch,status:'active'},{$inc:{counter:1}},{returnDocument:'after'});if(!counter)fail('stale_revision');
   const doc={_id:digest(content),v:1,room:'main',revision:p.revision,epoch:p.epoch,senderUserId:user,deviceId:p.deviceId,id:p.id,ts:p.ts,iv:p.iv,ciphertext:p.ciphertext,signature:p.signature,senderSignPublic:d.signPublic,serverTs:now(),cursor:counter.counter,content};await messages.insertOne(doc);return {message:cleanMessage(doc),duplicate:false};
  }
  if(event==='history'){
   shape(p,['v','epoch','deviceId'],['before','limit']);uuid(p.epoch);await device(user,p.deviceId);if(!await hasWrap(p.epoch,user,p.deviceId))fail('waiting');
   const limit=p.limit??50;if(!Number.isSafeInteger(limit)||limit<1||limit>50)fail();if(p.before!==undefined&&(!Number.isSafeInteger(p.before)||p.before<1))fail();
   const docs=await messages.find({epoch:p.epoch,...(p.before===undefined?{}:{cursor:{$lt:p.before}})}).sort({cursor:-1}).limit(limit+1).toArray();await fence(s,user);const more=docs.length>limit;const page=docs.slice(0,limit);return {messages:page.reverse().map(cleanMessage),nextCursor:more?page[0].cursor:null};
  }
  fail('unknown_event');
 }
 return {handle:(user,event,p)=>serial(()=>perform(user,event,p)),authorized:user=>serial(async()=>{await ready;await snapshot(user);return true;}),ready};
}
