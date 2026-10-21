import {validPokerTable,pokerSeats} from "./poker-taunts-table.mjs";
import {randomUUID,createHash} from "node:crypto";
export const DEFAULT_THROW_PRICE=5000;
export function throwPrice(room,kind){const p=room.casinoLimits?.[kind==="egg"?"pokerEggPrice":"pokerTomatoPrice"];return Number.isSafeInteger(p)&&p>=100&&p<=100_000_000&&p%100===0?p:DEFAULT_THROW_PRICE;}
const publicId=id=>createHash("sha256").update(id).digest("hex").slice(0,16);
export async function chargePokerThrow({collection,auditCollection,user,payload,authorize,now=Date.now}){
 if(!validPokerTable(payload.tableId)||!Number.isInteger(payload.target)||payload.target<0||payload.target>=12)throw Error("invalid");
 for(let attempt=0;attempt<12;attempt++){
  const at=now();
  if(!Number.isSafeInteger(payload.requestAt)||at-payload.requestAt>120000||payload.requestAt-at>10000)throw Error("expired");
  await authorize();
  const room=await collection.findOne({_id:"main"});
  if(!room)throw Error("unavailable");
  const receipts=room.pokerThrowReceipts||[],prior=receipts.find(r=>r.id===payload.requestId);
  if(prior){
   if(prior.tableId!==payload.tableId||prior.target!==payload.target||prior.sourceId!==publicId(user)||prior.user!==user||prior.value!==payload.value||prior.targetId!==payload.targetId||prior.expectedPrice!==payload.expectedPrice||prior.requestAt!==payload.requestAt)throw Error("invalid");
   return {replayed:true,cost:prior.cost};
  }
  const seats=pokerSeats(room,payload.tableId);
  const source=seats.findIndex(s=>s?.userId===user),member=room.members.find(m=>m.id===user);
  if(source<0||!member||member.accessRevoked||room.siteMaintenance)throw Error("not_seated");
  const target=seats[payload.target];
  if(!target||source===payload.target||publicId(target.userId)!==payload.targetId)throw Error("target");
  const last=receipts.filter(r=>r.user===user).reduce((n,r)=>Math.max(n,r.at),0);
  if(at-last<4000)throw Error("cooldown");
  const cost=throwPrice(room,payload.value);
  if(payload.expectedPrice!==cost)throw Error("price_changed");
  if(!Number.isSafeInteger(member.wallet)||member.wallet<cost)throw Error("insufficient_funds");
  if(!Number.isSafeInteger((room.house||0)+cost))throw Error("unavailable");
  const receipt={tableId:payload.tableId,target:payload.target,sourceId:publicId(user),id:payload.requestId,user,value:payload.value,targetId:payload.targetId,expectedPrice:payload.expectedPrice,requestAt:payload.requestAt,cost,at};
  const audit={_id:randomUUID(),who:user,what:"poker-throw",target:target.userId,old:{wallet:member.wallet,house:room.house||0},new:{wallet:member.wallet-cost,house:(room.house||0)+cost,amount:cost,destination:"house",throwable:payload.value,tableId:payload.tableId,source,target:payload.target,sourceId:publicId(user),requestId:payload.requestId},at};
  const members=room.members.map(m=>m.id===user?{...m,wallet:m.wallet-cost}:m);
  await authorize();
  const result=await collection.updateOne({_id:"main",version:room.version},{$set:{members,house:(room.house||0)+cost,pokerThrowReceipts:[...receipts.filter(r=>at-r.at<300000),receipt],auditPending:[...(room.auditPending||[]),audit]},$inc:{version:1}});
  if(!result.matchedCount)continue;
  // Atomic durable outbox is authoritative; ordinary room mutations retry flushing.
  if(auditCollection)await auditCollection.updateOne({_id:audit._id},{$setOnInsert:audit},{upsert:true}).catch(()=>{});
  return {replayed:false,cost,source,sourceId:publicId(user),target:payload.target,targetId:payload.targetId};
 }
 throw Error("unavailable");
}
