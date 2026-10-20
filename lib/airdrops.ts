import {createHash,randomUUID} from "node:crypto";
import type {Db} from "mongodb";
import {db} from "./db";
import {AppError,ensure} from "./errors";
import {assertRoom,totalChips} from "./poker";
import {parseTransferAmount,transferNote,transferIndexes,type Transfer} from "./transfers";
import type {Identity,Room} from "./types";

export const AIRDROP_PREVIEW_TTL_MS=5*60_000;
type Preview={_id:string;owner:string;version:number;recipients:string[];amount:number;note:string;count:number;total:number;expiresAt:Date;fingerprint:string;consumedBy?:string};
type Receipt={_id:string;owner:string;fingerprint:string;previewId:string;count:number;total:number;amount:number;note:string;at:number};
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let indexed:Db|undefined;
async function indexes(d:Db){if(indexed===d)return;await transferIndexes(d);await d.collection("airdrop_previews").createIndex({expiresAt:1},{expireAfterSeconds:0});indexed=d;}
function admin(who:Identity){ensure(who.admin===true,"Administrator access required.",403);}
function recipients(r:Room){return r.members.filter(m=>m.approved&&!m.accessRevoked).map(m=>m.id).sort();}
function binding(p:Omit<Preview,"fingerprint">){return hash(JSON.stringify([p.owner,p.version,p.recipients,p.amount,p.note,p.count,p.total,p.expiresAt.getTime()]));}
function view(p:Preview){return {previewId:p._id,count:p.count,total:p.total,amount:p.amount,note:p.note,expiresAt:p.expiresAt.getTime()};}
function result(r:Receipt){return {id:r._id,previewId:r.previewId,count:r.count,total:r.total,amount:r.amount,note:r.note,at:r.at};}
function supported(e:unknown):never{if((e as {code?:number}).code===20)throw new AppError("Airdrops require a MongoDB replica set. No money was issued.",503);throw e;}
export async function previewAirdrop(who:Identity,input:{amount:unknown;note?:unknown},database?:Db){
 admin(who);const amount=parseTransferAmount(input.amount),note=transferNote(input.note),d=database??await db();await indexes(d);
 const session=d.client.startSession();
 try{return await session.withTransaction(async()=>{
  const r=await d.collection<Room>("rooms").findOne({_id:"main"},{session});ensure(r,"Room unavailable.",503);
  const ids=recipients(r),total=amount*ids.length;ensure(ids.length>0,"No eligible wallets.",409);ensure(new Set(ids).size===ids.length,"Invalid wallet membership.",503);ensure(Number.isSafeInteger(total)&&Number.isSafeInteger((r.issuance||0)+total)&&Number.isSafeInteger(totalChips(r)+total),"Airdrop exceeds the simulation limit.");
  for(const m of r.members.filter(m=>ids.includes(m.id)))ensure(Number.isSafeInteger(m.wallet+amount)&&Number.isSafeInteger((m.adjustments||0)+amount),"A wallet exceeds the simulation limit.");
  const fields={_id:randomUUID(),owner:who.id,version:r.version,recipients:ids,amount,note,count:ids.length,total,expiresAt:new Date(Date.now()+AIRDROP_PREVIEW_TTL_MS)};
  const p:Preview={...fields,fingerprint:binding(fields)};await d.collection<Preview>("airdrop_previews").insertOne(p,{session});return view(p);
 },{readConcern:{level:"snapshot"},writeConcern:{w:"majority"},readPreference:"primary"});}catch(e){supported(e);}finally{await session.endSession();}
}
export async function confirmAirdrop(who:Identity,input:{previewId:string;requestId:string},database?:Db){
 admin(who);ensure(uuid.test(input.previewId)&&uuid.test(input.requestId),"Invalid request key.");
 const d=database??await db();await indexes(d);
 // Global request IDs prevent two administrators from reusing the same issuance key.
 const id=hash("ssg200x.airdrop.v1\0"+input.requestId),fingerprint=hash(JSON.stringify([who.id,input.previewId]));
 const receipts=d.collection<Receipt>("airdrop_receipts"),previews=d.collection<Preview>("airdrop_previews"),rooms=d.collection<Room>("rooms");
 const session=d.client.startSession();
 try{return await session.withTransaction(async()=>{
  const existing=await receipts.findOne({_id:id},{session});if(existing){ensure(existing.owner===who.id&&existing.fingerprint===fingerprint,"Request key was already used for a different airdrop.",409);return result(existing);}
  const p=await previews.findOne({_id:input.previewId},{session});ensure(p&&p.owner===who.id,"Preview unavailable. Preview again.",409);
  ensure(!p.consumedBy,"This preview has already been confirmed.",409);ensure(p.expiresAt.getTime()>Date.now(),"Preview expired. Preview again.",409);ensure(p.fingerprint===binding(p),"Preview changed. Preview again.",409);
  const r=await rooms.findOne({_id:"main"},{session});ensure(r,"Room unavailable.",503);
  ensure(r.version===p.version&&JSON.stringify(recipients(r))===JSON.stringify(p.recipients),"The room changed. Preview again before confirming.",409);
  const before=r.members.find(m=>m.id===who.id)?.wallet??0,at=Date.now();
  ensure(Number.isSafeInteger(p.total)&&p.total===p.amount*p.count&&Number.isSafeInteger((r.issuance||0)+p.total)&&Number.isSafeInteger(totalChips(r)+p.total),"Airdrop exceeds the simulation limit.");
  const records:(Transfer&{kind:"airdrop"})[]=[];
  for(const recipient of p.recipients){
   const m=r.members.find(m=>m.id===recipient)!;
   ensure(Number.isSafeInteger(m.wallet+p.amount)&&Number.isSafeInteger((m.adjustments||0)+p.amount),"A wallet exceeds the simulation limit.");
   const old=m.wallet;m.wallet+=p.amount;m.adjustments=(m.adjustments||0)+p.amount;
   m.activity=[`Airdrop +$${(p.amount/100).toFixed(2)}`,...(m.activity||[])].slice(0,40);
   records.push({_id:hash(id+"\0"+m.id),kind:"airdrop",sender:who.id,recipient:m.id,senderName:who.name,recipientName:m.name,amount:p.amount,note:p.note,at,fingerprint:p.fingerprint,senderBefore:before,senderAfter:before,recipientBefore:old,recipientAfter:m.wallet});
  }
  // Issuance is not a debit. If the administrator owns an eligible wallet it also receives one credit.
  const after=r.members.find(m=>m.id===who.id)?.wallet??0;for(const record of records)record.senderAfter=after;
  r.issuance=(r.issuance||0)+p.total;assertRoom(r);
  const {_id,...fields}=r;Reflect.deleteProperty(fields,"chatMutationLock");fields.version=r.version+1;
  ensure((await rooms.updateOne({_id,version:p.version},{$set:fields,$unset:{chatMutationLock:""}},{session})).matchedCount,"The room changed. Preview again before confirming.",409);
  ensure((await previews.updateOne({_id:p._id,consumedBy:{$exists:false}},{$set:{consumedBy:id}},{session})).matchedCount,"This preview has already been confirmed.",409);
  await d.collection<Transfer&{kind:"airdrop"}>("transfers").insertMany(records,{session});
  const receipt:Receipt={_id:id,owner:who.id,fingerprint,previewId:p._id,count:p.count,total:p.total,amount:p.amount,note:p.note,at};await receipts.insertOne(receipt,{session});return result(receipt);
 },{readConcern:{level:"snapshot"},writeConcern:{w:"majority"},readPreference:"primary"});}
 catch(e){if((e as {code?:number}).code===11000){const existing=await receipts.findOne({_id:id});if(existing){ensure(existing.owner===who.id&&existing.fingerprint===fingerprint,"Request key was already used for a different airdrop.",409);return result(existing);}}supported(e);}
 finally{await session.endSession();}
}
