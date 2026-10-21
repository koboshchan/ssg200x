import {randomInt,randomUUID} from 'node:crypto';
import {wordlist} from '@scure/bip39/wordlists/english.js';
import {shape,text,uuid,binary,fail,verify,canonical,digest} from './chat-protocol.mjs';

export const dmSignedData=(user,p)=>canonical(['ssg-dm',1,user,p.toUserId,p.id,p.senderDeviceId,p.recipientDeviceId,p.senderKeyVersion,p.recipientKeyVersion,p.salt,p.iv,p.ciphertext]);
const wireFields=['v','id','toUserId','senderDeviceId','recipientDeviceId','senderKeyVersion','recipientKeyVersion','salt','iv','ciphertext','signature'];
const historyFields=[...wireFields,'senderUserId','senderDhPublic','senderSignPublic','recipientDhPublic','recipientSignPublic','serverTs','cursor'];
const clean=d=>Object.fromEntries(historyFields.map(k=>[k,d[k]]));
const generate=()=>Array.from({length:4},()=>wordlist[randomInt(wordlist.length)]).join(' ');
const words=new Set(wordlist);
function username(s){if(typeof s!=='string'||s.length>100||!/^\w+ \w+ \w+ \w+$/.test(s)||s.split(' ').some(w=>!words.has(w)))fail();return s;}
// One bounded queue serializes all DM writes in the supported single server process.
export function createDmService(db,{now=Date.now,generateUsername=generate}={}){
 const rooms=db.collection('rooms'),names=db.collection('dm_usernames'),messages=db.collection('dm_messages'),blocks=db.collection('dm_blocks'),rates=db.collection('dm_rates'),devices=db.collection('chat_devices'),versions=db.collection('chat_identity_versions');
 const ready=Promise.all([names.createIndex({username:1},{unique:true}),messages.createIndex({senderUserId:1,id:1},{unique:true}),messages.createIndex({pair:1,cursor:-1}),blocks.createIndex({owner:1,peer:1},{unique:true}),rates.createIndex({expiresAt:1},{expireAfterSeconds:0})]);
 let queue=Promise.resolve(),pending=0;
 const serial=fn=>{if(pending>=128)return Promise.reject(Object.assign(new Error('busy'),{chatCode:'busy'}));pending++;const r=queue.then(fn).finally(()=>pending--);queue=r.catch(()=>{});return r;};
 async function rate(user,kind,max){const id=digest(canonical([user,kind,Math.floor(now()/60000)]));await rates.updateOne({_id:id},{$setOnInsert:{count:0,expiresAt:new Date(now()+180000)}},{upsert:true});if(!(await rates.updateOne({_id:id,count:{$lt:max}},{$inc:{count:1}})).matchedCount)fail('rate_limited');}
 async function membership(user,peer){const r=await rooms.findOne({_id:'main'});const members=(r?.members||[]).filter(m=>m.approved===true&&!m.accessRevoked).map(m=>m.id);if(!members.includes(user))fail('forbidden');if(peer!==undefined&&(peer===user||!members.includes(peer)))fail('unavailable');return members;}
 async function ensureName(user){let row=await names.findOne({_id:user});if(row)return row.username;for(let i=0;i<32;i++){const candidate=username(generateUsername());try{await names.insertOne({_id:user,username:candidate});return candidate;}catch(e){if(e.code!==11000)throw e;row=await names.findOne({_id:user});if(row)return row.username;}}fail('busy');}
 async function backfill(members){for(const user of members)await ensureName(user);}
 async function active(user,id,version){const pointer=await versions.findOne({_id:user,status:'active'});if(!pointer||!Number.isSafeInteger(pointer.version)||pointer.version<1)fail('identity_required');const d=await devices.findOne({userId:user,keyVersion:pointer.version,...(id?{deviceId:id}:{})});if(!d||(version!==undefined&&version!==d.keyVersion))fail('identity_required');return d;}
 async function blocked(a,b){return !!await blocks.findOne({$or:[{owner:a,peer:b},{owner:b,peer:a}]});}
 async function unchanged(user,d){
  const current=await active(user,d.deviceId,d.keyVersion);
  // Compare the entire authenticated bundle, not only the device/version labels.
  if(['deviceId','keyVersion','dhPublic','signPublic'].some(k=>current[k]!==d[k]))fail('identity_conflict');
 }
 const pair=(a,b)=>digest(canonical([a,b].sort()));
 async function perform(user,event,p){await ready;text(user);await rate(user,'all',120);const members=await membership(user);
  if(event==='profile'){shape(p,['v']);await backfill(members);await membership(user);return {username:await ensureName(user)};}
  if(event==='lookup'){shape(p,['v','username']);username(p.username);await backfill(members);const n=await names.findOne({username:p.username});if(!n||n._id===user||!members.includes(n._id))return {peer:null};let d;try{d=await active(n._id);}catch(e){if(e.chatCode==='identity_required')return {peer:null};throw e;}await membership(user,n._id);return {peer:{userId:n._id,username:n.username,deviceId:d.deviceId,keyVersion:d.keyVersion,dhPublic:d.dhPublic,signPublic:d.signPublic}};}
  if(event==='threads'){
   shape(p,['v']);await backfill(members);
   // Unique peer aggregation bounds response by room membership, never loads ciphertext.
   const rows=await messages.aggregate([{$match:{$or:[{senderUserId:user},{toUserId:user}]}},{$project:{peer:{$cond:[{$eq:['$senderUserId',user]},'$toUserId','$senderUserId']},serverTs:1}},{$group:{_id:'$peer',updatedAt:{$max:'$serverTs'}}},{$sort:{updatedAt:-1}},{$limit:4096}]).toArray();
   const ownBlocks=await blocks.find({owner:user}).limit(4096).toArray();for(const b of ownBlocks)if(!rows.some(r=>r._id===b.peer))rows.push({_id:b.peer,updatedAt:0});
   const threads=[];for(const r of rows){if(r._id!==user&&members.includes(r._id))threads.push({userId:r._id,username:await ensureName(r._id),blocked:await blocked(user,r._id),updatedAt:r.updatedAt});}await membership(user);return {threads};
  }
  if(event==='history'){
   shape(p,['v','userId'],['before','limit']);text(p.userId);await membership(user,p.userId);const limit=p.limit??50;if(!Number.isSafeInteger(limit)||limit<1||limit>50)fail();if(p.before!==undefined&&(typeof p.before!=='string'||!/^\d{16}-[0-9a-f-]{36}$/.test(p.before)))fail();
   const docs=await messages.find({pair:pair(user,p.userId),...(p.before?{cursor:{$lt:p.before}}:{})}).sort({cursor:-1}).limit(limit+1).toArray();await membership(user,p.userId);const page=docs.slice(0,limit),nextCursor=docs.length>limit?page.at(-1).cursor:null;return {messages:page.reverse().map(clean),nextCursor,blocked:await blocked(user,p.userId)};
  }
  if(event==='block'){
   shape(p,['v','userId','blocked']);text(p.userId);if(typeof p.blocked!=='boolean')fail();await membership(user,p.userId);if(p.blocked)await blocks.updateOne({owner:user,peer:p.userId},{$setOnInsert:{owner:user,peer:p.userId}},{upsert:true});else await blocks.deleteOne({owner:user,peer:p.userId});return {blocked:await blocked(user,p.userId)};
  }
  if(event==='send'){
   shape(p,wireFields);uuid(p.id);text(p.toUserId);uuid(p.senderDeviceId);uuid(p.recipientDeviceId);for(const v of [p.senderKeyVersion,p.recipientKeyVersion])if(!Number.isSafeInteger(v)||v<1)fail();binary(p.salt,32);binary(p.iv,12);binary(p.ciphertext,17,4112);binary(p.signature,64);await rate(user,'send',30);
   await membership(user,p.toUserId);if(await blocked(user,p.toUserId))fail('unavailable');const sender=await active(user,p.senderDeviceId,p.senderKeyVersion),recipient=await active(p.toUserId,p.recipientDeviceId,p.recipientKeyVersion);const content=dmSignedData(user,p);if(!await verify(sender.signPublic,content,p.signature))fail('invalid_signature');
   const prior=await messages.findOne({senderUserId:user,id:p.id});if(prior&&(prior.content!==content||prior.signature!==p.signature))fail('conflict');
   await membership(user,p.toUserId);if(await blocked(user,p.toUserId))fail('unavailable');await unchanged(user,sender);await unchanged(p.toUserId,recipient);
   await membership(user,p.toUserId);if(await blocked(user,p.toUserId))fail('unavailable');
   if(prior)return {message:clean(prior),duplicate:true};
   const serverTs=now();const doc={_id:randomUUID(),...Object.fromEntries(wireFields.map(k=>[k,p[k]])),senderUserId:user,senderDhPublic:sender.dhPublic,senderSignPublic:sender.signPublic,recipientDhPublic:recipient.dhPublic,recipientSignPublic:recipient.signPublic,serverTs,cursor:String(serverTs).padStart(16,'0')+'-'+randomUUID(),pair:pair(user,p.toUserId),content};await messages.insertOne(doc);return {message:clean(doc),duplicate:false};
  }
  fail('unknown_event');
 }
 return {ready,handle:(user,event,p)=>serial(()=>perform(user,event,p))};
}
