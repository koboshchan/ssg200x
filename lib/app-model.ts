import type {Db,ClientSession,Document} from "mongodb";
import {randomUUID} from "node:crypto";
import type {Scope,Limits} from "./app-policy";
import {DEFAULT_SCOPES,DEFAULT_LIMITS,ZERO_LIMITS} from "./app-policy";
export type Application={_id:string;clientId:string;ownerUserId:string;name:string;description:string;website:string;status:"approved"|"suspended"|"deleted";approvedScopes:Scope[];creditMode:"refunds"|"mint";limits:Limits;mintLimits:Limits;appDailyCents:number;policyVersion:number;fence:number;createdAt:Date;updatedAt:Date};
export type Credential={_id:string;appId:string;secretHash:string;prefix:string;scopes:Scope[];createdAt:Date;expiresAt:Date;revokedAt:Date|null;lastUsedAt?:Date;fence:number};
export type Grant={_id:string;appId:string;userId:string;appUserId:string;externalSubject:string;scopes:Scope[];limits:Limits;consentTextVersion?:string;policyVersion:number;authorizationVersion:string;fence:number;createdAt:Date;expiresAt:Date;revokedAt:Date|null};
export type Link={_id:string;appId:string;credentialId:string;codeHash:string;deviceTokenHash:string;requestedScopes:Scope[];externalSubject:string;policyVersion:number;state:"pending"|"approved"|"denied";grantId?:string;authorizationVersion?:string;createdAt:Date;expiresAt:Date;nextPollAt:Date;fence:number};
export type Preview={_id:string;requestId:string;userId:string;appId:string;policyVersion:number;expiresAt:Date};
export type Transaction={_id:string;appId:string;credentialId:string;grantId:string;authorizationVersion:string;userId:string;appUserId:string;operation:"debit"|"credit";creditReason?:"refund"|"mint";amountCents:number;signedDelta:number;originalTransactionId?:string;externalReference:string;description:string;fingerprint:string;keyDigest:string;before:number;after:number;issuanceBefore:number;issuanceAfter:number;roomVersion:number;limits:Limits;policyVersion:number;createdAt:Date;responseVersion:1};
export const applications=(d:Db)=>d.collection<Application>("app_applications");
export const credentials=(d:Db)=>d.collection<Credential>("app_credentials");
export const grants=(d:Db)=>d.collection<Grant>("app_grants");
export const links=(d:Db)=>d.collection<Link>("app_link_codes");
export const previews=(d:Db)=>d.collection<Preview>("app_previews");
export const transactions=(d:Db)=>d.collection<Transaction>("app_transactions");
export const usage=(d:Db)=>d.collection<{_id:string;amount:number;count:number}>("app_usage");
export async function audit(d:Db,actor:string,event:string,target:string,details:Document,session:ClientSession){await d.collection("app_audit").insertOne({actor,event,target,details,requestId:randomUUID(),at:new Date()},{session});}
const indexed=new WeakSet<Db>();
export async function appIndexes(d:Db){
 if(indexed.has(d))return;
 await Promise.all([
 applications(d).createIndex({clientId:1},{unique:true}),applications(d).createIndex({ownerUserId:1,createdAt:-1}),
 credentials(d).createIndex({appId:1,createdAt:-1}),
 grants(d).createIndex({appId:1,userId:1},{unique:true}),grants(d).createIndex({appId:1,appUserId:1},{unique:true}),grants(d).createIndex({userId:1,createdAt:-1}),
 links(d).createIndex({codeHash:1},{unique:true}),links(d).createIndex({expiresAt:1},{expireAfterSeconds:0}),links(d).createIndex({appId:1,createdAt:-1}),
 previews(d).createIndex({expiresAt:1},{expireAfterSeconds:0}),
 transactions(d).createIndex({appId:1,keyDigest:1},{unique:true}),transactions(d).createIndex({appId:1,appUserId:1,createdAt:-1}),transactions(d).createIndex({userId:1,createdAt:-1}),transactions(d).createIndex({originalTransactionId:1}),
 d.collection("app_throttles").createIndex({expiresAt:1},{expireAfterSeconds:0}),d.collection("app_audit").createIndex({at:-1}),
 ]);await activateLegacyApps(d);indexed.add(d);
}
/**
 * One-time idempotent migration for the removed admin-review workflow. Legacy "draft"/"pending" rows never stored what the owner asked for
 * (the old form only collected name/description/website), so the requested policy is unknown. They become "approved" keeping whatever policy is
 * already stored (scopes, limits, credit mode, mint caps); a legacy row with no stored scopes gets DEFAULT_SCOPES (profile, balance:read,
 * balance:debit), refunds-only credits and the default caps. Mint is never invented: a row keeps mint only if it already stored a valid mint
 * policy. Admins can raise scopes/limits/mint later. "suspended" and "deleted" rows are never touched. Existing consent is invalidated by a
 * policyVersion bump. Every call is a no-op once no draft/pending rows remain.
 */
export async function activateLegacyApps(d:Db){
 const legacy=d.collection<Omit<Application,"status">&{status:string}>("app_applications");
 const ids=(await legacy.find({status:{$in:["draft","pending"]}},{projection:{_id:1}}).toArray()).map(r=>r._id);
 for(const id of ids){
  // Read and derive policy inside the transaction so a concurrent admin edit is never overwritten by stale data.
  await appTransaction(d,async session=>{
   const row=await legacy.findOne({_id:id,status:{$in:["draft","pending"]}},{session});
   if(!row)return;
   const scopes=Array.isArray(row.approvedScopes)&&row.approvedScopes.length?row.approvedScopes:[...DEFAULT_SCOPES];
   const mintOk=row.creditMode==="mint"&&scopes.includes("balance:credit")&&!!row.mintLimits&&Object.values(row.mintLimits).every(n=>n>0);
   const set={status:"approved" as const,approvedScopes:scopes,creditMode:mintOk?"mint" as const:"refunds" as const,limits:row.limits??{...DEFAULT_LIMITS},mintLimits:mintOk?row.mintLimits:{...ZERO_LIMITS},appDailyCents:row.appDailyCents??5_000_000,updatedAt:new Date()};
   const r=await legacy.updateOne({_id:id,status:row.status,policyVersion:row.policyVersion,fence:row.fence},{$set:set,$inc:{policyVersion:1,fence:1}},{session});
   if(!r.modifiedCount)throw new RetryAppTransaction();
   await audit(d,"system","app_auto_activated",id,{fromStatus:row.status,scopes:set.approvedScopes,creditMode:set.creditMode,limits:set.limits,mintLimits:set.mintLimits,migration:"remove-review-v1"},session);
  });
 }
}
export class RetryAppTransaction extends Error{}
export async function appTransaction<T>(d:Db,work:(session:ClientSession)=>Promise<T>):Promise<T>{
 for(let attempt=0;attempt<8;attempt++){
  const session=d.client.startSession();
  try{return (await session.withTransaction(()=>work(session),{readConcern:{level:"snapshot"},writeConcern:{w:"majority"},readPreference:"primary",timeoutMS:12_000}))!;}
  catch(e){if(e instanceof RetryAppTransaction||(e as {code?:number}).code===11000){if(attempt<7)continue;}throw e;}
  finally{await session.endSession();}
 }
 throw new Error("Transaction retry limit");
}
