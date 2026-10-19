import { randomUUID } from "node:crypto";
import { db, rooms, readRoom } from "./db";
import { AppError, ensure } from "./errors";
import { assertRoom, tick, register, seatOf, applyAction, addLog, active, cashOut } from "./poker";
import type { Identity, Action, Room } from "./types";
export async function mutate<T>(fn: (r: Room)=>T | Promise<T>) {
 // Fresh server-owned copies on each CAS retry. No speculative state leaves here.
 for(let attempt=0;attempt<12;attempt++) {
  const previous=await readRoom(), next=structuredClone(previous);
  const result=await fn(next);
  assertRoom(next);
  const {_id,...fields}=next; fields.version=previous.version+1;
  if((await(await rooms()).updateOne({_id,version:previous.version},{$set:fields})).matchedCount) {
   next.version=fields.version; return {room:next,result};
  }
 }
 throw new AppError("The room is busy. Try again.",409);
}
export async function visit(who: Identity) {
 const existing=await readRoom();
 const s=existing.seats[seatOf(existing,who.id)];
 if(existing.members.some(m=>m.id===who.id) && (!s || Date.now()-s.seen < 15_000) && !(who.admin && !existing.members.find(m=>m.id===who.id)!.approved)) {
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
  applyAction(r,who,action,now);
  r.receipts=[{id:requestId,userId:who.id,at:now},...r.receipts.filter(x=>x.at&&now-x.at<300_000)];
 })).room;
}
export async function approve(who:Identity, target:string, approved:boolean) {
 ensure(who.admin,"Only Lucas can approve players.",403);
 return (await mutate(r=>{
  register(r,who);
  const m=r.members.find(m=>m.publicId===target);
  ensure(m,"Account not found.",404);
  ensure(m.id!==who.id,"You cannot remove your own access.");
  m.approved=approved;
  if(!approved) {
   const i=seatOf(r,m.id);
   if(i>=0) {const s=r.seats[i]!; if(active(r)&&s.inHand){s.leaveAfter=true;s.sitOut=true;}else cashOut(r,i);}
  }
  addLog(r,m.name+(approved?" was approved":" had access removed"));
 })).room;
}
export async function tickRoom() {
 const r=await readRoom(), now=Date.now();
 if((r.deadline!==null && now>=r.deadline) || (r.nextDeal!==null && now>=r.nextDeal) || (!active(r)&&r.seats.some(s=>s&&(s.leaveAfter||s.stack===0||now-s.seen>90_000))))await mutate(r=>tick(r,Date.now()));
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
