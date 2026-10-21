import {playerReference} from "../runtime/clerk-names.mjs";
import {createHash,randomInt,randomUUID} from "node:crypto";
import {wordlist} from "@scure/bip39/wordlists/english.js";
import type {Db} from "mongodb";
import {db} from "./db";
import {ensure,AppError} from "./errors";
import {assertRoom} from "./poker";
import type {Identity,Room} from "./types";

export const CODE_TTL_MS=10*60_000;
// New rows use independent IDs. Legacy rows have no ownerId and use the owner as _id.
// code is a sensitive bearer credential, retained ONLY for authenticated owner listing.
// Never include a raw row in previews, history, socket payloads or logs.
type ReceiveCode={_id:string;ownerId?:string;code?:string;hash:string;generation:string;expiresAt:Date;amount:number;note:string};
const codeOwner=(entry:ReceiveCode)=>entry.ownerId??entry._id;
const ownerFilter=(id:string)=>({$or:[{ownerId:id},{_id:id,ownerId:{$exists:false}}]});
export type Transfer={kind?:"airdrop";_id:string;sender:string;recipient:string;senderName:string;recipientName:string;amount:number;note:string;at:number;fingerprint:string;senderBefore:number;senderAfter:number;recipientBefore:number;recipientAfter:number};
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
// Keep the v2 hash domain and accept legacy four-word requests until they expire.
const codeHash=(code:string)=>hash("ssg200x.payment-request.v2\0"+code);
const words=new Set(wordlist);
export function parseTransferAmount(input:unknown){
 ensure(typeof input==="string"&&/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(input),"Enter a plain dollar amount with at most two decimal places.");
 const [whole,fraction=""]=input.split(".");const amount=Number(BigInt(whole)*100n+BigInt(fraction.padEnd(2,"0")));
 ensure(Number.isSafeInteger(amount)&&amount>0&&amount<=100_000_000,"Send $0.01–$1,000,000.");return amount;
}
export function normalizeReceiveCode(input:unknown){ensure(typeof input==="string"&&input.length<=100,"Enter the two-word payment request code.");const code=input.trim().toLowerCase().replace(/\s+/g," ");ensure(/^[a-z]+ [a-z]+(?: [a-z]+ [a-z]+)?$/.test(code)&&code.split(" ").every(w=>words.has(w)),"Enter the two-word payment request code.");return code;}
export function transferNote(input:unknown){ensure(input===undefined||typeof input==="string","Invalid note.");const note=(input??"").trim();ensure(note.length<=160&&!/[\u0000-\u001f\u007f<>]/.test(note),"Use a plain-text note of at most 160 characters.");return note;}
let indexed:Db|undefined;
export async function transferIndexes(d:Db){if(indexed===d)return;await Promise.all([d.collection("transfer_codes").createIndex({hash:1},{unique:true}),d.collection("transfer_codes").createIndex({expiresAt:1},{expireAfterSeconds:0}),d.collection("transfer_codes").createIndex({ownerId:1,expiresAt:1}),d.collection("transfer_code_issuers").createIndex({expiresAt:1},{expireAfterSeconds:0}),d.collection("transfers").createIndex({sender:1,at:-1}),d.collection("transfers").createIndex({recipient:1,at:-1}),d.collection("transfers").createIndex({at:-1})]);indexed=d;}
function member(r:Room,id:string){const m=r.members.find(m=>m.id===id);ensure(m?.approved&&!m.accessRevoked,"Player unavailable.",403);return m;}
async function approvedRoom(d:Db,who:Identity){const r=await d.collection<Room>("rooms").findOne({_id:"main"});ensure(r,"Room unavailable.",503);member(r,who.id);return r;}
async function limitCodeGeneration(d:Db,ownerId:string){
 const issuers=d.collection<{_id:string;nextAt:Date;expiresAt:Date}>("transfer_code_issuers");
 // Initialize independently so the conditional claim never upserts on a failed match.
 await issuers.updateOne({_id:ownerId},{$setOnInsert:{nextAt:new Date(0),expiresAt:new Date(Date.now()+CODE_TTL_MS)}},{upsert:true}).catch(e=>{if(e.code!==11000)throw e;});
 // Mongo's clock and one conditional write arbitrate across every application instance.
 const claim=await issuers.updateOne({_id:ownerId,$expr:{$lte:["$nextAt","$$NOW"]}},[{$set:{nextAt:{$add:["$$NOW",1000]},expiresAt:{$add:["$$NOW",CODE_TTL_MS+1000]}}}]);
 ensure(claim.matchedCount,"Create at most one payment request per second.",429);
}
export async function createReceiveCode(who:Identity,input:{amount:unknown;note?:unknown},database?:Db){
 const amount=parseTransferAmount(input.amount),note=transferNote(input.note),d=database??await db();
 await transferIndexes(d);await approvedRoom(d,who);await limitCodeGeneration(d,who.id);
 // Preserve all existing requests. The existing unique hash index arbitrates collisions.
 for(let i=0;i<5;i++){
  const code=Array.from({length:2},()=>wordlist[randomInt(wordlist.length)]).join(" "),expiresAt=new Date(Date.now()+CODE_TTL_MS),id=randomUUID();
  try{await d.collection<ReceiveCode>("transfer_codes").insertOne({_id:id,ownerId:who.id,code,hash:codeHash(code),generation:randomUUID(),expiresAt,amount,note});return {id,code,amount,note,expiresAt:expiresAt.getTime()};}
  catch(e){if((e as {code?:number}).code!==11000)throw e;}
 }
 throw new AppError("Could not create a receive code. Try again.",503);
}
export async function activeReceiveCodes(who:Identity,database?:Db){
 const d=database??await db();await approvedRoom(d,who);
 const entries=await d.collection<ReceiveCode>("transfer_codes").find({...ownerFilter(who.id),expiresAt:{$gt:new Date()}}).sort({expiresAt:1,_id:1}).toArray();
 // Legacy hashes are irreversible. Keep those requests usable/cancellable without inventing codes.
 return entries.map(e=>({id:e._id,code:e.code??null,amount:e.amount,note:e.note,expiresAt:e.expiresAt.getTime()}));
}
export async function cancelReceiveCode(who:Identity,id:unknown,database?:Db){
 ensure(typeof id==="string"&&id.length>0&&id.length<=256,"Invalid payment request.");
 const d=database??await db();await approvedRoom(d,who);
 // Ownership and liveness are checked in the delete itself, including races with send.
 const removed=await d.collection<ReceiveCode>("transfer_codes").deleteOne({_id:id,...ownerFilter(who.id),expiresAt:{$gt:new Date()}});
 ensure(removed.deletedCount,"Code expired or unavailable.",404);return {cancelled:true};
}
export async function resolveReceiveCode(who:Identity,input:unknown,database?:Db){const d=database??await db(),code=normalizeReceiveCode(input);const entry=await d.collection<ReceiveCode>("transfer_codes").findOne({hash:codeHash(code),expiresAt:{$gt:new Date()}});ensure(entry,"Code expired or unavailable.",404);ensure(codeOwner(entry)!==who.id,"You cannot send to yourself.");const r=await d.collection<Room>("rooms").findOne({_id:"main"});ensure(r,"Room unavailable.",503);member(r,who.id);const recipient=member(r,codeOwner(entry));return {name:recipient.name,publicId:recipient.publicId,amount:entry.amount,note:entry.note,expiresAt:entry.expiresAt.getTime()};}
class RoomChanged extends Error{}
export async function sendTransfer(who:Identity,input:{code:unknown;requestId:string;recipient:string},database?:Db){
 const d=database??await db(),code=normalizeReceiveCode(input.code);
 ensure(!("amount" in input)&&!("note" in input),"The receiver fixes the amount and note.");
 ensure(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId),"Invalid request key.");
 ensure(typeof input.recipient==="string"&&input.recipient.length>0&&input.recipient.length<=256,"Confirm the recipient first.");
 await transferIndexes(d);
 const id=hash(who.id+"\0"+input.requestId),fingerprint=hash(JSON.stringify([codeHash(code),input.recipient]));
 const transfers=d.collection<Transfer>("transfers"),codes=d.collection<ReceiveCode>("transfer_codes"),rooms=d.collection<Room>("rooms");
 for(let attempt=0;attempt<12;attempt++){
 const session=d.client.startSession();
 try{return await session.withTransaction(async()=>{
  const existing=await transfers.findOne({_id:id},{session});
  if(existing){ensure(existing.sender===who.id&&existing.fingerprint===fingerprint,"Request key was already used for a different transfer.",409);return transferView(existing,who);}
  const entry=await codes.findOne({hash:codeHash(code),expiresAt:{$gt:new Date()}},{session});ensure(entry,"Code expired or unavailable.",409);ensure(codeOwner(entry)!==who.id,"You cannot send to yourself.");
  const r=await rooms.findOne({_id:"main"},{session});ensure(r,"Room unavailable.",503);
  const amount=entry.amount,note=entry.note;ensure(Number.isSafeInteger(amount)&&amount>0&&amount<=100_000_000,"Invalid payment request.",409);
  const sender=member(r,who.id),recipient=member(r,codeOwner(entry));ensure(recipient.publicId===input.recipient,"Recipient changed. Confirm again.",409);
  // Wallet is already cash-only: opening margin, buying assets and poker/roulette/blackjack buy-ins debit it immediately.
  ensure(Number.isSafeInteger(sender.wallet)&&sender.wallet>=amount,"Not enough available cash.",409);ensure(Number.isSafeInteger(recipient.wallet+amount),"Recipient balance exceeds the simulation limit.");
  const record:Transfer={_id:id,sender:who.id,recipient:recipient.id,senderName:sender.name,recipientName:recipient.name,amount,note,at:Date.now(),fingerprint,senderBefore:sender.wallet,senderAfter:sender.wallet-amount,recipientBefore:recipient.wallet,recipientAfter:recipient.wallet+amount};
  sender.wallet-=amount;recipient.wallet+=amount;
  sender.adjustments=(sender.adjustments||0)-amount;recipient.adjustments=(recipient.adjustments||0)+amount;
  for(const [m,text] of [[sender,`Sent $${(amount/100).toFixed(2)} to ${playerReference(recipient)}`],[recipient,`Received $${(amount/100).toFixed(2)} from ${playerReference(sender)}`]] as const)m.activity=[text,...(m.activity||[])].slice(0,40);
  assertRoom(r);
  // Same room/version CAS as all trade and poker writers. Their stale writes cannot overwrite this transaction.
  const {_id,...fields}=r;Reflect.deleteProperty(fields,"chatMutationLock");fields.version=r.version+1;
  if(!(await rooms.updateOne({_id,version:r.version},{$set:fields,$unset:{chatMutationLock:""}},{session})).matchedCount)throw new RoomChanged();
  ensure((await codes.deleteOne({_id:entry._id,hash:entry.hash,generation:entry.generation},{session})).deletedCount,"Code changed. Confirm again.",409);
  await transfers.insertOne(record,{session});return transferView(record,who);
 },{readConcern:{level:"snapshot"},writeConcern:{w:"majority"},readPreference:"primary"});}
 catch(e){if(e instanceof RoomChanged)continue;if((e as {code?:number}).code===11000){const existing=await transfers.findOne({_id:id});if(existing){ensure(existing.fingerprint===fingerprint,"Request key was already used for a different transfer.",409);return transferView(existing,who);}}if((e as {code?:number}).code===20)throw new AppError("Transfers require a MongoDB replica set. No money was moved.",503);throw e;}
 finally{await session.endSession();}
 }
 throw new AppError("The room is busy. Try again with the same request key.",409);
}
export function transferView(t:Transfer,who:Identity){ensure(who.admin||t.sender===who.id||t.recipient===who.id,"Transfer unavailable.",403);return {id:t._id,kind:t.kind??"transfer",amount:t.amount,note:t.note,at:t.at,from:t.senderName,to:t.recipientName,direction:t.kind==="airdrop"?(t.recipient===who.id?"received":"other"):t.sender===who.id?"sent":t.recipient===who.id?"received":"other",...(who.admin?{senderBefore:t.senderBefore,senderAfter:t.senderAfter,recipientBefore:t.recipientBefore,recipientAfter:t.recipientAfter}:{})};}
export async function transferHistory(who:Identity,all=false,database?:Db){ensure(!all||who.admin,"Admin access required.",403);const d=database??await db();const records=await d.collection<Transfer>("transfers").find(all?{}:{$or:[{sender:who.id},{recipient:who.id}]}).sort({at:-1,_id:-1}).limit(100).toArray();return records.map(t=>transferView(t,who));}
