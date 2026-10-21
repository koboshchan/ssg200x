import {createHash} from "node:crypto";
import {isIP} from "node:net";
import {rateLimit} from "./store";
import {db} from "./db";
import {ensure} from "./errors";
import type {Db} from "mongodb";
export const TRANSFER_GUESS_INTERVAL_MS=2000;
export async function claimTransferGuess(userId:string,database?:Db){
 const d=database??await db(),limits=d.collection<{_id:string;nextAt:Date;expiresAt:Date}>("limits");
 const key="transfer-guess:rolling-user:"+userId;
 await limits.updateOne({_id:key},{$setOnInsert:{nextAt:new Date(0),expiresAt:new Date(Date.now()+60_000)}},{upsert:true}).catch(e=>{if(e.code!==11000)throw e;});
 // One server-clock conditional claim, shared by resolve/send and every app instance.
 // A rejected attempt never moves the boundary or extends the waiting period.
 const claim=await limits.updateOne({_id:key,$expr:{$lte:["$nextAt","$$NOW"]}},[{$set:{nextAt:{$add:["$$NOW",TRANSFER_GUESS_INTERVAL_MS]},expiresAt:{$add:["$$NOW",60_000]}}}]);
 ensure(claim.matchedCount,"Try one payment code every two seconds.",429);
}
/** Only trust an explicitly configured edge-overwritten header. By default all
 * sources share a database budget, which cannot be bypassed by forged XFF. */
export function transferSource(request:Request){
 const header=process.env.TRANSFER_TRUSTED_IP_HEADER;
 const candidate=header?request.headers.get(header)?.trim():"";
 return candidate&&isIP(candidate)?createHash("sha256").update("ssg200x.transfer-source.v1\0"+candidate).digest("hex"):"shared-untrusted-edge";
}
export async function limitTransferGuess(request:Request,userId:string){
 await claimTransferGuess(userId);
 await rateLimit("transfer-guess:source:"+transferSource(request),30);
 // Aggregate cap also bounds distributed account/IP guessing.
 await rateLimit("transfer-guess:global",120);
}
