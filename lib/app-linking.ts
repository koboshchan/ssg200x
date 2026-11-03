import {randomUUID} from "node:crypto";
import type {Db,ClientSession} from "mongodb";
import {z} from "zod";
import type {Identity,Room} from "./types";
import {applications,grants,links,previews,appIndexes,appTransaction,audit,type Grant,type Link} from "./app-model";
import {type AppClient,currentClient,fenceClient,effectiveScopes} from "./app-auth";
import {LINK_TTL,GRANT_TTL,scopesSchema,limitsSchema,plain,normalizeAppCode,generateAppCode,secret,keyedDigest,digest,equalHash,requireApp,withinLimits,minLimits,DEFAULT_LIMITS} from "./app-policy";
import {connectedGrantView} from "./app-management";
export async function appThrottle(d:Db,key:string,cap:number,window=60_000){
 const bucket=Math.floor(Date.now()/window),id=key+":"+bucket,c=d.collection<{_id:string;count:number;expiresAt:Date}>("app_throttles");
 // Atomic increment followed by check keeps every caller over the cap rejected.
 const row=await c.findOneAndUpdate({_id:id},{$inc:{count:1},$setOnInsert:{expiresAt:new Date((bucket+2)*window)}},{upsert:true,returnDocument:"after"}).catch(async e=>{if(e.code!==11000)throw e;return c.findOneAndUpdate({_id:id},{$inc:{count:1}},{returnDocument:"after"});});
 if(!row||row.count>cap){const {AppApiError}=await import("./app-policy");throw new AppApiError("rate_limited","Too many requests.",429,Math.ceil(window/1000));}
}
export async function createLink(d:Db,client:AppClient,input:unknown){
 const v=z.object({user_code:z.string().max(100).optional(),scopes:scopesSchema,external_subject:plain.max(160).optional()}).strict().parse(input);
 const code=v.user_code?normalizeAppCode(v.user_code):generateAppCode(),token=secret(),now=new Date();
 await appIndexes(d);await appThrottle(d,"link-create:"+client.app._id,10);await appThrottle(d,"link-create-day:"+client.app._id,1000,86400_000);
 return appTransaction(d,async session=>{
 const live=await fenceClient(d,client,session);requireApp(v.scopes.every(s=>live.app.approvedScopes.includes(s)&&live.credential.scopes.includes(s)),"insufficient_scope","Requested scope not approved.",403);
 const outstanding=await links(d).countDocuments({appId:live.app._id,state:"pending",expiresAt:{$gt:now}},{session});requireApp(outstanding<100,"limit_exceeded","Too many pending link requests.",409);
 const row:Link={_id:randomUUID(),appId:live.app._id,credentialId:live.credential._id,codeHash:keyedDigest("link-code",code),deviceTokenHash:digest("device-token",token),requestedScopes:v.scopes,externalSubject:v.external_subject??"",policyVersion:live.app.policyVersion,state:"pending",createdAt:now,expiresAt:new Date(now.getTime()+LINK_TTL),nextPollAt:new Date(0),fence:0};
 // Keep a code tombstone until expiry, even once authorized.
 requireApp(!await links(d).findOne({codeHash:row.codeHash},{session}),"invalid_request","Code unavailable. Generate a new code.",409);
 await links(d).insertOne(row,{session});await audit(d,live.app._id,"link_created",row._id,{},session);
 return {request_id:row._id,device_token:token,user_code:code,verification_uri:new URL("/link",process.env.APP_ORIGIN??"http://localhost").href,expires_at:row.expiresAt,interval_seconds:5};
 });
}
export async function previewLink(d:Db,who:Identity,input:unknown,source="untrusted"){
 const v=z.object({user_code:z.string().max(100)}).strict().parse(input);
 await appThrottle(d,"preview-user:"+who.id,5);await appThrottle(d,"preview-source:"+digest("source",source),20);await appThrottle(d,"preview-day:"+who.id,100,86400_000);
 const code=normalizeAppCode(v.user_code),now=new Date(),link=await links(d).findOne({codeHash:keyedDigest("link-code",code),state:"pending",expiresAt:{$gt:now}});
 requireApp(link,"unavailable","Code expired or unavailable.",404);
 const app=await applications(d).findOne({_id:link.appId,status:"approved",policyVersion:link.policyVersion});requireApp(app,"unavailable","Code expired or unavailable.",404);
 const raw=secret(),expires=new Date(Math.min(link.expiresAt.getTime(),now.getTime()+120_000));
 await previews(d).insertOne({_id:digest("preview",raw),requestId:link._id,userId:who.id,appId:app._id,policyVersion:app.policyVersion,expiresAt:expires});
 return {confirmation_token:raw,app:{app_id:app._id,name:app.name,description:app.description,website:app.website,status:app.status,credit_mode:app.creditMode},requested_scopes:link.requestedScopes,external_subject:link.externalSubject,expires_at:expires,limits:minLimits(app.limits,DEFAULT_LIMITS),refund_after_revoke:true};
}
export async function authorizeLink(d:Db,who:Identity,input:unknown){
 const v=z.object({confirmation_token:z.string().length(43),scopes:scopesSchema,limits:limitsSchema}).strict().parse(input);
 const result=await appTransaction(d,async session=>{
 const now=new Date(),preview=await previews(d).findOne({_id:digest("preview",v.confirmation_token),userId:who.id,expiresAt:{$gt:now}},{session});requireApp(preview,"unavailable","Confirmation expired or unavailable.",404);
 const link=await links(d).findOne({_id:preview.requestId,state:"pending",expiresAt:{$gt:now}},{session});requireApp(link,"unavailable","Code expired or unavailable.",404);
 const app=await applications(d).findOne({_id:link.appId,status:"approved",policyVersion:preview.policyVersion},{session});requireApp(app&&link.policyVersion===app.policyVersion,"unavailable","Application policy changed.",409);
 requireApp(v.scopes.every(s=>link.requestedScopes.includes(s)&&app.approvedScopes.includes(s))&&withinLimits(v.limits,app.limits)&&withinLimits(v.limits,DEFAULT_LIMITS),"invalid_request","Requested scopes or limits exceed approval.");
 const room=await d.collection<Room>("rooms").findOne({_id:"main"},{session});requireApp(room?.members.some(m=>m.id===who.id&&m.approved&&!m.accessRevoked),"unavailable","Player unavailable.",403);
 // Registration credential must still be live and fences all auth-state races.
 const credential=(await import("./app-model")).credentials(d);
 requireApp((await credential.updateOne({_id:link.credentialId,appId:app._id,revokedAt:null,expiresAt:{$gt:now}},{$inc:{fence:1}},{session})).matchedCount,"unavailable","Link registration credential expired.",409);
 await applications(d).updateOne({_id:app._id},{$inc:{fence:1}},{session});
 const old=await grants(d).findOne({appId:app._id,userId:who.id},{session});
 if(link.externalSubject){const bound=await grants(d).findOne({appId:app._id,externalSubject:link.externalSubject,revokedAt:null,expiresAt:{$gt:now}},{session});requireApp(!bound||bound.userId===who.id,"unavailable","External account already connected.",409);}
 const grant:Grant={_id:old?._id??randomUUID(),appId:app._id,userId:who.id,appUserId:old?.appUserId??randomUUID(),externalSubject:link.externalSubject,scopes:v.scopes,limits:v.limits,policyVersion:app.policyVersion,authorizationVersion:randomUUID(),fence:(old?.fence??0)+1,createdAt:now,expiresAt:new Date(now.getTime()+GRANT_TTL),revokedAt:null};
 await grants(d).replaceOne({_id:grant._id},grant,{upsert:true,session});
 requireApp((await links(d).updateOne({_id:link._id,state:"pending",expiresAt:{$gt:new Date()}},{$set:{state:"approved",grantId:grant._id,authorizationVersion:grant.authorizationVersion},$inc:{fence:1}},{session})).matchedCount,"unavailable","Code already consumed.",409);
 await previews(d).deleteOne({_id:preview._id},{session});await audit(d,who.id,"grant_consented",grant._id,{scopes:grant.scopes,limits:grant.limits,authorizationVersion:grant.authorizationVersion,policyVersion:app.policyVersion,refundAfterRevoke:true},session);return grant;
 });return {grant:await connectedGrantView(d,result)};
}
export async function pollLink(d:Db,client:AppClient,id:string,input:unknown){
 const v=z.object({device_token:z.string().length(43)}).strict().parse(input);await currentClient(d,client);await appThrottle(d,"poll:"+client.app._id,300);
 const row=await links(d).findOne({_id:id,appId:client.app._id});requireApp(row&&equalHash(row.deviceTokenHash,digest("device-token",v.device_token)),"unavailable","Link request unavailable.",404);
 if(row.expiresAt<=new Date())return {state:"expired"};
 const claimed=await links(d).updateOne({_id:id,appId:client.app._id,nextPollAt:{$lte:new Date()}},{$set:{nextPollAt:new Date(Date.now()+5000)},$inc:{fence:1}});
 if(!claimed.matchedCount){const {AppApiError}=await import("./app-policy");throw new AppApiError("slow_down","Poll at most once per five seconds.",429,5);}
 if(row.state!=="approved")return {state:row.state==="pending"?"authorization_pending":"denied"};
 const grant=await grants(d).findOne({_id:row.grantId,appId:client.app._id,authorizationVersion:row.authorizationVersion});
 requireApp(grant&&effectiveScopes(client,grant).length,"unavailable","Association unavailable.",404);
 const scopes=effectiveScopes(client,grant),r=scopes.includes("profile")?await d.collection<Room>("rooms").findOne({_id:"main"}):null,m=r?.members.find(m=>m.id===grant.userId&&m.approved&&!m.accessRevoked);
 return {state:"approved",grant_id:grant._id,app_user_id:grant.appUserId,granted_scopes:scopes,...(m?{display_name:m.name}:{})};
}
