import {randomUUID} from "node:crypto";
import type {Db} from "mongodb";
import type {Identity} from "./types";
import {applications,credentials,grants,transactions,appIndexes,appTransaction,audit,type Application,type Credential,type Grant,type Transaction} from "./app-model";
import {DEFAULT_LIMITS,ZERO_LIMITS,SCOPES,GRANT_TTL,registrationSchema,limitsSchema,scopesSchema,secret,digest,requireApp,withinLimits,type Limits} from "./app-policy";
import {z} from "zod";
export function appView(a:Application){return {app_id:a._id,client_id:a.clientId,name:a.name,description:a.description,website:a.website,status:a.status,approved_scopes:a.approvedScopes,credit_mode:a.creditMode,limits:a.limits,mint_limits:a.mintLimits,app_daily_cents:a.appDailyCents,policy_version:a.policyVersion,created_at:a.createdAt,updated_at:a.updatedAt};}
export function credentialView(c:Credential){return {credential_id:c._id,prefix:c.prefix,created_at:c.createdAt,expires_at:c.expiresAt,revoked_at:c.revokedAt};}
export function transactionView(t:Transaction){return {transaction_id:t._id,app_user_id:t.appUserId,grant_id:t.grantId,status:"committed",amount_cents:t.amountCents,direction:t.operation,...(t.creditReason?{credit_reason:t.creditReason}:{}),external_reference:t.externalReference,description:t.description,created_at:t.createdAt,...(t.originalTransactionId?{original_transaction_id:t.originalTransactionId}:{})};}
export async function ownedApp(d:Db,who:Identity,id:string){const a=await applications(d).findOne({_id:id,ownerUserId:who.id});requireApp(a,"unavailable","Application unavailable.",404);return a;}
export async function registerApp(d:Db,who:Identity,input:unknown){
 requireApp(who.admin,"forbidden","Only admins can create applications.",403);
 const v=registrationSchema.parse(input);await appIndexes(d);
 return appTransaction(d,async session=>{
 const count=await applications(d).countDocuments({ownerUserId:who.id,status:{$ne:"deleted"}},{session});requireApp(count<10,"limit_exceeded","At most ten active applications.",409);
 // Owner fence prevents simultaneous registration from exceeding the cap.
 await d.collection("app_owners").updateOne({_id:who.id as never},{$inc:{fence:1}},{upsert:true,session});
 const now=new Date(),app:Application={_id:randomUUID(),clientId:"app_"+randomUUID(),ownerUserId:who.id,...v,status:"draft",approvedScopes:[],creditMode:"refunds",limits:{...DEFAULT_LIMITS},mintLimits:{...ZERO_LIMITS},appDailyCents:5_000_000,policyVersion:1,fence:0,createdAt:now,updatedAt:now};
 await applications(d).insertOne(app,{session});await audit(d,who.id,"app_registered",app._id,{},session);return {app:appView(app)};
 });
}
export async function editApp(d:Db,who:Identity,id:string,input:unknown){
 const v=registrationSchema.partial().extend({status:z.enum(["pending","deleted"]).optional()}).strict().parse(input);
 return appTransaction(d,async session=>{
 const app=await applications(d).findOne({_id:id,ownerUserId:who.id},{session});requireApp(app&&app.status!=="deleted","unavailable","Application unavailable.",404);
 Object.assign(app,v);app.status=v.status==="deleted"?"deleted":"pending";app.policyVersion++;app.fence++;app.updatedAt=new Date();
 await applications(d).replaceOne({_id:id},app,{session});await audit(d,who.id,"app_edited",id,{status:app.status},session);return {app:appView(app)};
 });
}
const reviewSchema=z.object({status:z.enum(["approved","suspended","deleted"]),approved_scopes:scopesSchema.optional(),credit_mode:z.enum(["refunds","mint"]).optional(),limits:limitsSchema.optional(),mint_limits:limitsSchema.optional(),app_daily_cents:z.number().int().min(0).max(100_000_000).optional()}).strict();
export async function reviewApp(d:Db,who:Identity,id:string,input:unknown){
 requireApp(who.admin,"unavailable","Unavailable.",404);const v=reviewSchema.parse(input);
 return appTransaction(d,async session=>{
 const app=await applications(d).findOne({_id:id},{session});requireApp(app&&app.status!=="deleted","unavailable","Application unavailable.",404);
 if(v.status==="approved"){requireApp(v.approved_scopes&&v.limits&&v.app_daily_cents!==undefined,"invalid_request","Approval requires explicit scopes and debit/app limits.");
 if(v.credit_mode==="mint")requireApp(v.mint_limits&&Object.values(v.mint_limits).every(n=>n>0)&&v.approved_scopes.includes("balance:credit"),"invalid_request","Minting requires explicit positive caps and credit approval.");}
 app.status=v.status;app.approvedScopes=v.approved_scopes??app.approvedScopes;app.limits=v.limits??app.limits;app.appDailyCents=v.app_daily_cents??app.appDailyCents;app.creditMode=v.credit_mode??app.creditMode;app.mintLimits=app.creditMode==="mint"?(v.mint_limits??app.mintLimits):{...ZERO_LIMITS};app.policyVersion++;app.fence++;app.updatedAt=new Date();
 await applications(d).replaceOne({_id:id},app,{session});await audit(d,who.id,"app_reviewed",id,{status:app.status,scopes:app.approvedScopes,limits:app.limits,mintLimits:app.mintLimits},session);return {app:appView(app)};
 });
}
export async function createCredential(d:Db,who:Identity,id:string,input:unknown){
 const v=z.object({overlap_credential_id:z.string().max(100).optional(),overlap_seconds:z.number().int().min(0).max(86400).default(3600)}).strict().parse(input),raw=secret(),credentialId="ac_"+randomUUID(),now=new Date();
 return appTransaction(d,async session=>{
 const app=await applications(d).findOne({_id:id,ownerUserId:who.id,status:{$ne:"deleted"}},{session});requireApp(app,"unavailable","Application unavailable.",404);
 await applications(d).updateOne({_id:id},{$inc:{fence:1}},{session});
 if(v.overlap_credential_id){
 const old=await credentials(d).findOne({_id:v.overlap_credential_id,appId:id,revokedAt:null},{session});requireApp(old,"unavailable","Credential unavailable.",404);
 await credentials(d).updateOne({_id:old._id},{$set:{expiresAt:new Date(Math.min(old.expiresAt.getTime(),now.getTime()+v.overlap_seconds*1000))},$inc:{fence:1}},{session});
 }
 const count=await credentials(d).countDocuments({appId:id,revokedAt:null,expiresAt:{$gt:now}},{session});requireApp(count<5,"limit_exceeded","At most five active credentials.",409);
 const credential:Credential={_id:credentialId,appId:id,secretHash:digest("credential",raw),prefix:credentialId.slice(0,11),scopes:[...SCOPES],createdAt:now,expiresAt:new Date(now.getTime()+GRANT_TTL),revokedAt:null,fence:0};
 await credentials(d).insertOne(credential,{session});await audit(d,who.id,"credential_created",credentialId,{appId:id},session);
 return {credential:credentialView(credential),secret:credentialId+"."+raw};
 });
}
export async function revokeCredential(d:Db,who:Identity,appId:string,id:string){
 return appTransaction(d,async session=>{await ownedApp(d,who,appId);const result=await credentials(d).updateOne({_id:id,appId},{$set:{revokedAt:new Date()},$inc:{fence:1}},{session});requireApp(result.matchedCount,"unavailable","Credential unavailable.",404);await audit(d,who.id,"credential_revoked",id,{appId},session);return {revoked:true};});
}
export async function connectedGrantView(d:Db,g:Grant){
 const app=await applications(d).findOne({_id:g.appId}),day=new Date().toISOString().slice(0,10),row=await d.collection("app_usage").findOne({_id:("grant:"+g._id+":"+g.authorizationVersion+":debit:"+day) as never});
 const ts=await transactions(d).find({grantId:g._id,userId:g.userId}).sort({createdAt:-1}).limit(20).toArray();
 return {grant_id:g._id,app_id:g.appId,app_user_id:g.appUserId,app_name:app?.name??"Unavailable application",external_subject:g.externalSubject,scopes:g.scopes,limits:g.limits,created_at:g.createdAt,expires_at:g.expiresAt,revoked_at:g.revokedAt,todays_debit_cents:row?.amount??0,transactions:ts.map(transactionView)};
}
export async function reduceGrant(d:Db,who:Identity,id:string,input:unknown,revoke=false){
 const v=revoke?null:z.object({limits:limitsSchema,scopes:scopesSchema.optional()}).strict().parse(input);
 const g=await appTransaction(d,async session=>{
 const grant=await grants(d).findOne({_id:id,userId:who.id},{session});requireApp(grant,"unavailable","Association unavailable.",404);
 if(v){requireApp(withinLimits(v.limits,grant.limits)&&(!v.scopes||v.scopes.every(s=>grant.scopes.includes(s))),"invalid_request","Increases require fresh consent.");grant.limits=v.limits;grant.scopes=v.scopes??grant.scopes;}else grant.revokedAt=new Date();
 grant.fence++;await grants(d).replaceOne({_id:id},grant,{session});await audit(d,who.id,revoke?"grant_revoked":"grant_reduced",id,{},session);return grant;
 });return revoke?{revoked:true}:{grant:await connectedGrantView(d,g)};
}
