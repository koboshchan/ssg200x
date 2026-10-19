import {randomUUID} from "node:crypto";
import {db} from "./db";
import type {Room,Identity,AuditEvent} from "./types";
export function audit(r:Room,who:Identity,what:string,target:string,old:unknown,value:unknown){
 r.auditPending=[...(r.auditPending||[]),{_id:randomUUID(),who:who.id,what,target,old,new:value,at:Date.now()}];
}
export async function flushAudit(r:Room){
 const c=(await db()).collection<AuditEvent>("audit");
 for(const event of r.auditPending||[])await c.updateOne({_id:event._id},{$setOnInsert:event},{upsert:true});
 // Pending events remain durable in the atomic room until a later successful CAS compacts them.
}
export async function compactAudit(r:Room){
 if(!r.auditPending?.length)return;
 const ids=await(await db()).collection<AuditEvent>("audit").find({_id:{$in:r.auditPending.map(x=>x._id)}},{projection:{_id:1}}).toArray();
 const done=new Set(ids.map(x=>x._id));r.auditPending=r.auditPending.filter(x=>!done.has(x._id));
}
