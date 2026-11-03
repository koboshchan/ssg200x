import type {Db,ClientSession} from "mongodb";
import {credentials,applications,grants,type Application,type Credential,type Grant} from "./app-model";
import {digest,equalHash,requireApp,type Scope} from "./app-policy";
export type AppClient={app:Application;credential:Credential};
export function appApiEnabled(){requireApp(process.env.APP_API_ENABLED==="true","temporarily_unavailable","Application API is disabled.",503);}
export async function authenticateApp(request:Request,d:Db):Promise<AppClient>{
 appApiEnabled();
 requireApp(!request.headers.has("origin"),"invalid_client","Use your application's confidential backend.",403);
 const auth=request.headers.get("authorization")??"",clientId=request.headers.get("x-client-id")??"";
 const match=/^Bearer (ac_[0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(auth);
 requireApp(match&&clientId.length<=100,"invalid_client","Invalid application credentials.",401);
 const credential=await credentials(d).findOne({_id:match[1]});
 requireApp(credential&&!credential.revokedAt&&credential.expiresAt>new Date()&&equalHash(credential.secretHash,digest("credential",match[2])),"invalid_client","Invalid application credentials.",401);
 const app=await applications(d).findOne({_id:credential.appId,clientId});
 requireApp(app&&app.status!=="draft"&&app.status!=="pending"&&app.status!=="deleted","invalid_client","Invalid application credentials.",401);
 return {app,credential};
}
export async function currentClient(d:Db,client:AppClient,session?:ClientSession,allowSuspended=false){
 const options=session?{session}:{};
 const app=await applications(d).findOne({_id:client.app._id},options);
 const credential=await credentials(d).findOne({_id:client.credential._id,appId:client.app._id,revokedAt:null,expiresAt:{$gt:new Date()}},options);
 requireApp(credential,"invalid_client","Credential revoked or expired.",401);
 requireApp(app&&(app.status==="approved"||(allowSuspended&&app.status==="suspended")),"app_suspended","Application is not approved.",403);
 return {app,credential};
}
export async function fenceClient(d:Db,client:AppClient,session:ClientSession,allowSuspended=false){
 const live=await currentClient(d,client,session,allowSuspended);
 requireApp((await applications(d).updateOne({_id:live.app._id,policyVersion:live.app.policyVersion,status:live.app.status},{$inc:{fence:1}},{session})).matchedCount,"app_suspended","Application policy changed.",403);
 requireApp((await credentials(d).updateOne({_id:live.credential._id,revokedAt:null,expiresAt:{$gt:new Date()}},{$inc:{fence:1}},{session})).matchedCount,"invalid_client","Credential changed.",401);
 return live;
}
export function effectiveScopes(client:AppClient,grant:Grant):Scope[]{
 if(client.app.status!=="approved"||grant.revokedAt||grant.expiresAt<=new Date()||grant.policyVersion!==client.app.policyVersion)return [];
 return grant.scopes.filter(s=>client.app.approvedScopes.includes(s)&&client.credential.scopes.includes(s));
}
export async function activeGrant(d:Db,client:AppClient,appUserId:string,scope?:Scope,session?:ClientSession){
 const grant=await grants(d).findOne({appId:client.app._id,appUserId},session?{session}:{});
 requireApp(grant&&!grant.revokedAt&&grant.expiresAt>new Date()&&grant.policyVersion===client.app.policyVersion,"unavailable","Association unavailable.",404);
 if(scope)requireApp(effectiveScopes(client,grant).includes(scope),"insufficient_scope","Scope not authorized.",403);
 return grant;
}
