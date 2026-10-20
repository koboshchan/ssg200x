import {rouletteTick,ROULETTE_MS,type RouletteState} from "./roulette";
import {blackjackTablesTick} from "./blackjack";
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
 const s=existing.seats[seatOf(existing,who.id)];
 if(existing.members.some(m=>m.id===who.id) && (!s || Date.now()-s.seen < 15_000) && existing.members.find(m=>m.id===who.id)!.approved) {
  return existing;
 }
 return (await mutate(r=>{
  register(r,who);
  const i=seatOf(r,who.id); if(i>=0)r.seats[i]!.seen=Date.now();
 })).room;
}
export async function move(who:Identity, action:Action, requestId:string, handNumber:number, turnDeadline:number|null,requestAt:number) {
 return (await mutate(r=>{
  register(r,who);
  ensure(Date.now()-requestAt>=-10_000&&Date.now()-requestAt<=120_000,"Request expired. Try again.",409);
  const repeated=r.receipts.find(receipt=>receipt.id===requestId);
  if(repeated) {ensure(repeated.userId===who.id,"Invalid request.",409);return;}
  const now=Date.now();
  tick(r,now);
  // Actions refer to a specific hand, never become an accidental bet in the next.
  if(["fold","check","call","raise"].includes(action.type))ensure(r.handNumber===handNumber&&r.deadline===turnDeadline,"The turn has changed. Refresh first.",409);
  if(action.type==="ready"||action.type==="resume")ensure(r.handNumber===handNumber,"The hand has changed. Refresh first.",409);
  applyAction(r,who,action,now);
  r.receipts=[{id:requestId,userId:who.id,at:now},...r.receipts.filter(x=>x.at&&now-x.at<300_000)];
 })).room;
}
export async function tickRoom() {
 const r=await readRoom(), now=Date.now();
 const wheel=(r as Room & {roulette?:RouletteState}).roulette;
 if(!wheel||now>=wheel.started+ROULETTE_MS)await mutate(r=>rouletteTick(r,Date.now()));
 if(Object.values(r.blackjackTables?.tables||{}).some(t=>t&&t.deadline!==null&&now>=t.deadline))await mutate(r=>blackjackTablesTick(r,Date.now()));
 if((!active(r)&&r.seats.some(s=>s?.ready)&&(r.readyDeadline==null||now>=r.readyDeadline)) || (r.deadline!==null && now>=r.deadline) || (r.nextDeal!==null && now>=r.nextDeal) || (!active(r)&&r.seats.some(s=>s&&!s.ready&&(s.leaveAfter||s.stack===0||(r.readyDeadline==null&&now-s.seen>90_000)))))await mutate(r=>tick(r,Date.now()));
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
export async function mutateStockPublication(owner:string,fn:(room:Room)=>void,candles?: (session:import("mongodb").ClientSession)=>Promise<void>){
 const database=await db(),session=database.client.startSession();
 try{
  await session.withTransaction(async()=>{
   const now=Date.now();
   const lease=await database.collection<{_id:string;owner:string;until:number}>("workers").updateOne(
    {_id:"coinbase-feed",owner,until:{$gt:now+1000}},
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
