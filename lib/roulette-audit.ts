import {db,readRoom} from "./db";
import {ensure} from "./errors";
import type {AuditEvent,Identity} from "./types";
/** Separate admin-only read. Never include these records in a room or socket snapshot. */
export async function rouletteAudit(who:Identity,publicId?:string){
 ensure(who.admin,"Administrator access required.",403);
 const room=await readRoom();
 const member=publicId?room.members.find(m=>m.publicId===publicId):undefined;
 if(publicId)ensure(member,"Account not found.",404);
 const events=await(await db()).collection<AuditEvent>("audit")
  .find({what:"roulette-dead-placement",...(member?{who:member.id}:{})})
  .sort({at:-1,_id:-1}).limit(100).toArray();
 // Include committed outbox events if the durable audit flush is temporarily behind.
 const pending=(room.auditPending||[]).filter(e=>e.what==="roulette-dead-placement"&&(!member||e.who===member.id));
 const unique=[...new Map([...events,...pending].map(e=>[e._id,e])).values()]
  .sort((a,b)=>b.at-a.at||b._id.localeCompare(a._id)).slice(0,100);
 return {events:unique.map(e=>({id:e._id,publicId:room.members.find(m=>m.id===e.who)?.publicId??null,at:e.at,placement:e.new}))};
}
