import {tickDoudizhu,doudizhuNeedsTick} from "./doudizhu";
import {applyPokerKick,reconcilePokerKickVotes,pokerKickNeedsTick,type PokerKickRequest} from "./poker-kicks";
import {seatedPokerTable,pokerTableRoom,touchPokerSeat,applyPokerTableAction,tickPokerTables,pokerTableNeedsTick,POKER_TABLE_IDS,type PokerTableId} from "./poker-tables";
import {tickRoulette} from "./roulette-store";
import {blackjackTablesTick,blackjackNeedsTick} from "./blackjack";
import {flushAudit,compactAudit} from "./audit";
import { randomUUID } from "node:crypto";
import { db, rooms, readRoom } from "./db";
import { AppError, ensure } from "./errors";
import { assertRoom, tick, register, seatOf, applyAction, active } from "./poker";
import type { Identity, Action, Room } from "./types";
export async function mutate<T>(fn: (r: Room)=>T | Promise<T>) {
 // Fresh server-owned copies on each CAS retry. No speculative state leaves here.
 for(let attempt=0;attempt<12;attempt++) {
  const previous=await readRoom(), next=structuredClone(previous);
  await compactAudit(next);
  const result=await fn(next);
  reconcilePokerKickVotes(next,Date.now());
  assertRoom(next);
  const {_id,...fields}=next; Reflect.deleteProperty(fields,"chatMutationLock"); fields.version=previous.version+1;
  if((await(await rooms()).updateOne({_id,version:previous.version},{$set:fields,$unset:{chatMutationLock:""}})).matchedCount) {
   next.version=fields.version; await flushAudit(next).catch(()=>{}); return {room:next,result};
  }
 }
 throw new AppError("The room is busy. Try again.",409);
}
export async function visit(who: Identity) {
 const existing=await readRoom();
 const ownTable=seatedPokerTable(existing,who.id);
 const s=ownTable?pokerTableRoom(existing,ownTable).seats.find(s=>s?.userId===who.id):null;
 if(existing.members.some(m=>m.id===who.id) && (!s || Date.now()-s.seen < 15_000) && existing.members.find(m=>m.id===who.id)!.approved) {
  return existing;
 }
 return (await mutate(r=>{
  register(r,who);
  touchPokerSeat(r,who.id,Date.now());
 })).room;
}
export async function move(who:Identity, action:Action, requestId:string, handNumber:number, turnDeadline:number|null,requestAt:number,tableId:PokerTableId="01") {
 return (await mutate(r=>{
  register(r,who);
  ensure(Date.now()-requestAt>=-10_000&&Date.now()-requestAt<=120_000,"Request expired. Try again.",409);
  const repeated=r.receipts.find(receipt=>receipt.id===requestId);
  if(repeated) {ensure(repeated.userId===who.id,"Invalid request.",409);return;}
  const now=Date.now();
  applyPokerTableAction(r,tableId,who,action,handNumber,turnDeadline,now);
  r.receipts=[{id:requestId,userId:who.id,at:now},...r.receipts.filter(x=>x.at&&now-x.at<300_000)];
 })).room;
}
export async function tickRoom() {
 const r=await readRoom(), now=Date.now();
 await tickRoulette();
 if(doudizhuNeedsTick(r,now))await mutate(r=>tickDoudizhu(r,Date.now()));
 if(Object.values(r.blackjackTables?.tables||{}).some(t=>t&&blackjackNeedsTick(t,now)))await mutate(r=>blackjackTablesTick(r,Date.now()));
 if(pokerKickNeedsTick(r,now)||POKER_TABLE_IDS.some(id=>pokerTableNeedsTick(pokerTableRoom(r,id),now)))await mutate(r=>tickPokerTables(r,Date.now()));
}
let indexes:Promise<unknown>|undefined;
export async function rateLimit(id:string,limit=180) {
 indexes??=db().then(d=>d.collection("limits").createIndex({expiresAt:1},{expireAfterSeconds:0})).catch(e=>{indexes=undefined;throw e;});
 await indexes;
 const c=(await db()).collection<{_id:string;count:number;expiresAt:Date}>("limits");
 const minute=Math.floor(Date.now()/60_000),key=id+":"+minute;
 await c.updateOne({_id:key},{$setOnInsert:{count:0,expiresAt:new Date((minute+3)*60_000)}},{upsert:true}).catch(e=>{if(e.code!==11000)throw e;});
 ensure((await c.updateOne({_id:key,count:{$lt:limit}},{$inc:{count:1}})).matchedCount,"Too many requests. Try next minute.",429);
}
export const requestId = randomUUID;


/** Stock publication only. Serialize against renewal/takeover of the EXISTING
 * workers document in the same transaction as the room CAS. No second lock.
 * Mongo replica-set support is required; uncertainty never falls back to an
 * unfenced write. Ordinary mutations/payments retain their existing behavior.
 */
export async function mutateStockPublication(owner:string,fn:(room:Room)=>void,candles?: (session:import("mongodb").ClientSession)=>Promise<void>,leaseId="coinbase-feed"){
 const database=await db(),session=database.client.startSession();
 try{
  await session.withTransaction(async()=>{
   const now=Date.now();
   const lease=await database.collection<{_id:string;owner:string;until:number}>("workers").updateOne(
    {_id:leaseId,owner,until:{$gt:now+1000}},
    {$inc:{stockPublications:1}},{session});
   ensure(lease.matchedCount===1,"Stock worker lease revoked.",503);
   const c=database.collection<Room>("rooms");
   const previous=await c.findOne({_id:"main"},{session});
   ensure(previous,"Room unavailable.",503);
   const next=structuredClone(previous);fn(next);assertRoom(next);
   const {_id,...fields}=next;fields.version=previous.version+1;
   const result=await c.updateOne({_id,version:previous.version},{$set:fields},{session});
   ensure(result.matchedCount===1,"Stock room changed.",409);
   if(candles)await candles(session);
   // withTransaction retries conflicts from takeover/renewal, rechecking owner.
   ensure(Date.now()<now+1000,"Stock publication expired.",503);
  },{readConcern:{level:"snapshot"},writeConcern:{w:"majority"}});
 }finally{await session.endSession();}
}

export async function pokerKick(who:Identity,request:PokerKickRequest){return (await mutate(r=>{register(r,who);applyPokerKick(r,who,request,Date.now());})).room;}
