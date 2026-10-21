import {z} from "zod";
import {db} from "./db";
import {ensure} from "./errors";
import type {Identity} from "./types";

export const FINGERPRINT_RETENTION_MS=90*24*60*60*1000;
export const MAX_FINGERPRINTS_PER_USER=10;
export const fingerprintReport=z.object({hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type DeviceSeen={hash:string;firstSeen:Date;lastSeen:Date};
export type DeviceRecord={_id:string;devices:DeviceSeen[];expiresAt:Date};
export type FingerprintMember={id:string;publicId:string;name:string};
export type PossibleAlt={publicId:string;name:string;firstSeen:string;lastSeen:string};
export type FingerprintPlayer={publicId:string;name:string;firstSeen:string|null;lastSeen:string|null;possibleAlts:PossibleAlt[]};
let indexes:Promise<unknown>|undefined;
async function records(){
 const c=(await db()).collection<DeviceRecord>("deviceFingerprints");
 indexes??=c.createIndex({expiresAt:1},{expireAfterSeconds:0}).catch(e=>{indexes=undefined;throw e;});
 await indexes;
 return c;
}
// A single atomic pipeline bounds each user's storage even under concurrent reports.
// No raw visitor ID, browser components, IP address or email enters this collection.
export async function recordFingerprint(who:Identity,hash:string,now=new Date()){
 fingerprintReport.parse({hash});
 const c=await records(),cutoff=new Date(now.getTime()-FINGERPRINT_RETENTION_MS);
 await c.updateOne({_id:who.id},[
  {$set:{devices:{$filter:{input:{$ifNull:["$devices",[]]},as:"device",cond:{$gt:["$$device.lastSeen",cutoff]}}}}},
  {$set:{devices:{$let:{vars:{previous:{$arrayElemAt:[{$filter:{input:"$devices",as:"device",cond:{$eq:["$$device.hash",hash]}}},0]}},in:{$slice:[{$concatArrays:[[{hash,firstSeen:{$ifNull:["$$previous.firstSeen",now]},lastSeen:now}],{$filter:{input:"$devices",as:"device",cond:{$ne:["$$device.hash",hash]}}}]},MAX_FINGERPRINTS_PER_USER]}}},expiresAt:new Date(now.getTime()+FINGERPRINT_RETENTION_MS)}}
 ],{upsert:true});
 // Expire individual hashes of active accounts as well as whole dormant documents.
 await c.updateMany({"devices.lastSeen":{$lte:cutoff}},{$pull:{devices:{lastSeen:{$lte:cutoff}}}});
}
export function possibleAltPlayers(members:FingerprintMember[],documents:DeviceRecord[],now=new Date()):FingerprintPlayer[]{
 const cutoff=now.getTime()-FINGERPRINT_RETENTION_MS,byUser=new Map(documents.map(d=>[d._id,d.devices.filter(x=>x.lastSeen.getTime()>cutoff)]));
 return members.map(member=>{
  const devices=byUser.get(member.id)||[],matches=new Map<string,PossibleAlt>();
  for(const other of members){
   if(other.id===member.id)continue;
   const shared=(byUser.get(other.id)||[]).filter(d=>devices.some(own=>own.hash===d.hash));
   if(shared.length)matches.set(other.id,{publicId:other.publicId,name:other.name,firstSeen:new Date(Math.min(...shared.map(d=>d.firstSeen.getTime()))).toISOString(),lastSeen:new Date(Math.max(...shared.map(d=>d.lastSeen.getTime()))).toISOString()});
  }
  return {publicId:member.publicId,name:member.name,firstSeen:devices.length?new Date(Math.min(...devices.map(d=>d.firstSeen.getTime()))).toISOString():null,lastSeen:devices.length?new Date(Math.max(...devices.map(d=>d.lastSeen.getTime()))).toISOString():null,possibleAlts:[...matches.values()]};
 });
}
export async function adminFingerprintPlayers(who:Identity,members:FingerprintMember[],now=new Date()){
 ensure(who.admin,"Administrator access required.",403);
 const c=await records(),cutoff=new Date(now.getTime()-FINGERPRINT_RETENTION_MS);
 await c.updateMany({"devices.lastSeen":{$lte:cutoff}},{$pull:{devices:{lastSeen:{$lte:cutoff}}}});
 const documents=await c.find({_id:{$in:members.map(m=>m.id)},expiresAt:{$gt:now}}).toArray();
 return possibleAltPlayers(members,documents,now);
}
