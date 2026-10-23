import {createHash} from "node:crypto";
import {db,readRoom} from "./db";
import {miniAction,settleMiniGame,type MiniGame,type MiniInput} from "./minigames";
import {financeFingerprint} from "./finance-requests";
import {audit,flushAudit,compactAudit} from "./audit";
import {assertRoom} from "./poker";
import {ensure} from "./errors";
import {bindRoomFeatures} from "./feature-context";
import {getFeatureSettings} from "../runtime/feature-settings.mjs";
import type {Identity,Room} from "./types";
type Drop={_id:string;owner:string;requestId:string;fingerprint:string;game:MiniGame;state:"pending"|"settled";landAt:number};
const key=(owner:string,requestId:string)=>createHash("sha256").update(JSON.stringify([owner,requestId])).digest("hex");
let indexes:Promise<unknown>|undefined;
async function collection(){
 const d=await db(),c=d.collection<Drop>("plinkoDrops");
 indexes??=c.createIndex({state:1,landAt:1}).catch(e=>{indexes=undefined;throw e;});
 await indexes;return c;
}
/** A receipt has no TTL: an arbitrarily late replay can never buy a second drop.
 * Room debit, authoritative path and receipt are one replica-set transaction.
 * Standalone Mongo fails closed, never falls back to non-transactional writes. */
export async function dropPlinko(who:Identity,input:MiniInput){
 ensure(input.type==="start"&&input.game==="plinko","Invalid Plinko order.");
 await readRoom();
 const d=await db(),drops=await collection(),session=d.client.startSession();
 let committed!:Room,id:string|null=null;
 try{
  await session.withTransaction(async()=>{
   const rooms=d.collection<Room>("rooms"),previous=await rooms.findOne({_id:"main"},{session});
   ensure(previous,"Room unavailable.",503);
   const next=structuredClone(previous);await compactAudit(next);const member=next.members.find(m=>m.id===who.id);
   ensure(!member?.accessRevoked,"Room access revoked.",403);
   const receipt=await drops.findOne({_id:key(who.id,input.requestId)},{session});
   if(receipt){
    ensure(receipt.owner===who.id&&receipt.fingerprint===financeFingerprint(input),"Request key was used for a different order.",409);
    if(!next.miniGames?.some(g=>g.id===receipt.game.id))next.miniGames=[structuredClone(receipt.game),...(next.miniGames??[])];
    committed=next;id=receipt.game.id;return;
   }
   const features=getFeatureSettings(d.collection("featureFlags"));await features.ready;
   bindRoomFeatures(next,{...features.current()});
   // Generic finance receipts remain globally scoped for other games. The
   // durable Plinko collection above is scoped to owner+key.
   const historical=next.financeReceipts?.find(r=>r.id===input.requestId&&r.userId===who.id)||next.receipts.find(r=>r.id===input.requestId&&r.userId===who.id);
   if(historical){id=miniAction(next,who,input);committed=next;return;}
   id=miniAction(next,who,input,undefined,true);
   const game=next.miniGames?.find(g=>g.id===id);
   // A historical generic receipt acknowledges without creating a new wager.
   if(!game){committed=next;return;}
   assertRoom(next);
   const {_id,...fields}=next;fields.version=previous.version+1;
   ensure((await rooms.updateOne({_id,version:previous.version},{$set:fields},{session})).matchedCount===1,"Room changed.",409);
   await drops.insertOne({_id:key(who.id,input.requestId),owner:who.id,requestId:input.requestId,fingerprint:financeFingerprint(input),game:structuredClone(game),state:"pending",landAt:game.landAt!},{session});
   next.version=fields.version;committed=next;
  },{readConcern:{level:"snapshot"},writeConcern:{w:"majority"}});
 }finally{await session.endSession();}
 await flushAudit(committed).catch(()=>{});
 return {room:committed,result:id};
}
/** Both workers may discover the same due ID. Only one transaction can claim
 * pending -> settled, update the wallet and persist the audit. No client claim
 * endpoint or client clock participates. Restart recovery scans persisted due
 * records; future records are retained and picked up by the next timer tick. */
export async function settleDuePlinko(){
 const d=await db(),drops=await collection();
 const failures:unknown[]=[];
 const due=drops.find({state:"pending",landAt:{$lte:Date.now()}},{projection:{_id:1}}).batchSize(64);
 for await(const candidate of due){
  const session=d.client.startSession();let committed:Room|undefined;
  try{
   await session.withTransaction(async()=>{
    committed=undefined;
    const now=Date.now(),drop=await drops.findOne({_id:candidate._id,state:"pending",landAt:{$lte:now}},{session});
    if(!drop)return;
    const rooms=d.collection<Room>("rooms"),previous=await rooms.findOne({_id:"main"},{session});
    ensure(previous,"Room unavailable.",503);
    const next=structuredClone(previous);await compactAudit(next);const g=next.miniGames?.find(g=>g.id===drop.game.id&&g.owner===drop.owner);
    ensure(g&&g.kind==="plinko"&&g.status==="active"&&g.landAt===drop.landAt&&g.landAt<=now,"Pending Plinko ledger mismatch.",503);
    const member=next.members.find(m=>m.id===drop.owner);ensure(member,"Drop owner unavailable.",503);
    const before=member.wallet;
    settleMiniGame(next,g,"won");g.settledAt=now;g.revision++;
    audit(next,{id:member.id,name:member.name,email:member.email,admin:false},"plinko-settled",g.id,{wallet:before},{wallet:member.wallet,payout:g.payout,landAt:g.landAt,settledAt:now});
    assertRoom(next);
    const claimed=await drops.updateOne({_id:drop._id,state:"pending",landAt:{$lte:now}},{$set:{state:"settled",game:structuredClone(g)}},{session});
    ensure(claimed.modifiedCount===1,"Drop was already settled.",409);
    const {_id,...fields}=next;fields.version=previous.version+1;
    ensure((await rooms.updateOne({_id,version:previous.version},{$set:fields},{session})).matchedCount===1,"Room changed.",409);
    next.version=fields.version;committed=next;
   },{readConcern:{level:"snapshot"},writeConcern:{w:"majority"}});
  }catch(error){failures.push(error);}finally{await session.endSession();}
  if(committed)await flushAudit(committed).catch(()=>{});
 }
 if(failures.length)throw new AggregateError(failures,"Some Plinko settlements are deferred");
}

/** Independent of sockets and the other game timers. Starting a process recovers
 * due drops immediately; durable future drops are revisited every quarter second. */
export function startPlinkoWorker(){
 const globals=globalThis as typeof globalThis & {plinkoTimer?:ReturnType<typeof setInterval>};
 if(globals.plinkoTimer)return;
 let running=false;
 const run=async()=>{if(running)return;running=true;try{await settleDuePlinko();}catch{console.error("Plinko settlement deferred");}finally{running=false;}};
 globals.plinkoTimer=setInterval(()=>void run(),250);globals.plinkoTimer.unref();void run();
}
