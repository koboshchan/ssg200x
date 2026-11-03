import {randomUUID} from "node:crypto";
import {z,ZodError} from "zod";
import {db} from "./db";
import {endpoint,parse} from "./api";
import {AppError} from "./errors";
import {AppApiError,requireApp,scopesSchema} from "./app-policy";
import {authenticateApp,currentClient,effectiveScopes,activeGrant} from "./app-auth";
import {applications,credentials,grants,transactions,appIndexes} from "./app-model";
import {registerApp,editApp,reviewApp,createCredential,revokeCredential,appView,credentialView,transactionView,connectedGrantView,reduceGrant,ownedApp} from "./app-management";
import {createLink,previewLink,authorizeLink,pollLink,appThrottle} from "./app-linking";
import {moveAppMoney,readTransaction} from "./app-money";
import {transferSource} from "./transfer-rate-limit";
import type {Room,Identity} from "./types";
const headers={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
const json=(body:unknown,status=200,extra:Record<string,string>={})=>Response.json(body,{status,headers:{...headers,...extra}});
async function body(request:Request){return parse(request,z.unknown(),16_384);}
export async function externalAppRoute(request:Request){
 const requestId=randomUUID();
 try{
 const d=await db();await appIndexes(d);const client=await authenticateApp(request,d);
 // Fail closed on Origin and cookies as an authentication source. Cookies never select an identity.
 await appThrottle(d,"external:"+client.app._id,600);
 const path=new URL(request.url).pathname.replace(/^\/api\/v1\/?/,"").split("/").filter(Boolean).map(decodeURIComponent),method=request.method;
 const maintenance=await d.collection<Room>("rooms").findOne({_id:"main"});
 requireApp(!maintenance?.siteMaintenance||path[0]==="transactions","temporarily_unavailable","Under maintenance.",503);
 requireApp(!new URL(request.url).searchParams.has("access_token"),"invalid_request","Never put credentials in URLs.");
 if(method!=="GET")requireApp(request.headers.get("content-type")?.split(";")[0]==="application/json","invalid_request","Use application/json.",415);
 if(path.length===1&&path[0]==="link-requests"&&method==="POST")return json(await createLink(d,client,await body(request)),201);
 if(path.length===3&&path[0]==="link-requests"&&path[2]==="poll"&&method==="POST")return json(await pollLink(d,client,path[1],await body(request)));
 if(path[0]==="transactions"&&method==="GET"){
 if(path.length===2)return json(await readTransaction(d,client,path[1]));
 if(path.length===3&&path[1]==="by-key")return json(await readTransaction(d,client,path[2],true));
 }
 if(path[0]==="users"){
 const live=await currentClient(d,client,undefined,path.length===3&&(path[2]==="debits"||path[2]==="credits"));
 if(path.length===1&&method==="GET"){
 const url=new URL(request.url),rawLimit=url.searchParams.get("limit")??"50",cursor=url.searchParams.get("cursor");
 requireApp(/^\d{1,3}$/.test(rawLimit)&&Number(rawLimit)>0&&Number(rawLimit)<=100&&(!cursor||/^[0-9a-f-]{36}$/.test(cursor)),"invalid_request","Invalid pagination.");
 const rows=await grants(d).find({appId:live.app._id,revokedAt:null,expiresAt:{$gt:new Date()},policyVersion:live.app.policyVersion,...(cursor?{appUserId:{$gt:cursor}}:{})}).sort({appUserId:1}).limit(Number(rawLimit)+1).toArray(),page=rows.slice(0,Number(rawLimit));
 const room=page.some(g=>effectiveScopes(live,g).includes("profile"))?await d.collection<Room>("rooms").findOne({_id:"main"}):null;
 return json({items:page.map(g=>({app_user_id:g.appUserId,grant_id:g._id,scopes:effectiveScopes(live,g),status:"active",...(effectiveScopes(live,g).includes("profile")?{display_name:room?.members.find(m=>m.id===g.userId&&m.approved&&!m.accessRevoked)?.name}:{})})),next_cursor:rows.length>page.length?page.at(-1)!.appUserId:null});
 }
 if(path.length===2&&method==="GET"){
 const g=await activeGrant(d,live,path[1],"profile"),r=await d.collection<Room>("rooms").findOne({_id:"main"}),m=r?.members.find(m=>m.id===g.userId&&m.approved&&!m.accessRevoked);requireApp(m,"unavailable","Association unavailable.",404);
 return json({app_user_id:g.appUserId,grant_id:g._id,display_name:m.name,granted_scopes:effectiveScopes(live,g)});
 }
 if(path.length===3&&path[2]==="balance"&&method==="GET"){
 const g=await activeGrant(d,live,path[1],"balance:read"),r=await d.collection<Room>("rooms").findOne({_id:"main"}),m=r?.members.find(m=>m.id===g.userId&&m.approved&&!m.accessRevoked);requireApp(m&&r,"unavailable","Association unavailable.",404);
 return json({available_cents:m.wallet,unit:"ssg_cent",observed_at:new Date(),room_version:r.version});
 }
 if(path.length===3&&(path[2]==="debits"||path[2]==="credits")&&method==="POST"){
 const result=await moveAppMoney(d,live,path[1],path[2]==="debits"?"debit":"credit",request.headers.get("idempotency-key")??"",await body(request));
 return json(result.body,result.replayed?200:201,result.replayed?{"Idempotency-Replayed":"true"}:{});
 }
 }
 throw new AppApiError("unavailable","Endpoint unavailable.",404);
 }catch(e){
 const error=e instanceof AppError?new AppApiError(e.status===429?"rate_limited":"invalid_request",e.message,e.status):e;
 const known=error instanceof AppApiError,invalid=error instanceof ZodError||error instanceof SyntaxError||error instanceof URIError;
 const status=known?error.status:invalid?400:503;
 return json({error:{code:known?error.code:invalid?"invalid_request":"temporarily_unavailable",message:known?error.message:invalid?"Invalid request.":"Service unavailable. Retry with the same idempotency key.",request_id:requestId,...(known&&error.retryAfter?{retry_after_seconds:error.retryAfter}:{})}},status,known&&error.retryAfter?{"Retry-After":String(error.retryAfter)}:{});
 }
}
export function browserAppRoute(request:Request,kind:"developer"|"links"|"admin"){
 return endpoint(request,async who=>{
 try{
 const d=await db();await appIndexes(d);const url=new URL(request.url),prefix=kind==="developer"?"/api/developer/apps":kind==="admin"?"/api/admin/apps":"/api/app-links",parts=url.pathname.slice(prefix.length).split("/").filter(Boolean).map(decodeURIComponent),method=request.method;
 if(kind==="links"){
 if(!parts.length&&method==="GET"){const gs=await grants(d).find({userId:who.id}).sort({createdAt:-1}).limit(100).toArray();return {items:await Promise.all(gs.map(g=>connectedGrantView(d,g)))};}
 if(parts.length===1&&parts[0]==="preview"&&method==="POST")return previewLink(d,who,await body(request),transferSource(request));
 if(parts.length===1&&parts[0]==="authorize"&&method==="POST")return authorizeLink(d,who,await body(request));
 if(parts.length===1&&(method==="PATCH"||method==="DELETE"))return reduceGrant(d,who,parts[0],method==="DELETE"?{}:await body(request),method==="DELETE");
 }else{
 requireApp(kind!=="admin"||who.admin,"unavailable","Unavailable.",404);
 if(!parts.length){
 if(method==="GET"){const rows=await applications(d).find(kind==="admin"?{}:{ownerUserId:who.id}).sort({createdAt:-1}).limit(100).toArray();return {items:rows.map(appView)};}
 if(method==="POST"&&kind==="developer")return registerApp(d,who,await body(request));
 }
 if(parts.length===1&&method==="PATCH")return kind==="admin"?reviewApp(d,who,parts[0],await body(request)):editApp(d,who,parts[0],await body(request));
 if(parts.length===1&&method==="GET"){
 const app=kind==="admin"?await applications(d).findOne({_id:parts[0]}):await ownedApp(d,who,parts[0]);requireApp(app,"unavailable","Application unavailable.",404);
 const cs=kind==="developer"?await credentials(d).find({appId:app._id}).sort({createdAt:-1}).limit(50).toArray():[];
 const ts=await transactions(d).find({appId:app._id}).sort({createdAt:-1}).limit(100).toArray();
 const audits=kind==="admin"?await d.collection("app_audit").find({$or:[{target:app._id},{actor:app._id}]}).sort({at:-1}).limit(100).project({_id:0}).toArray():undefined;
 return {app:appView(app),credentials:cs.map(credentialView),linked_user_count:await grants(d).countDocuments({appId:app._id,revokedAt:null,expiresAt:{$gt:new Date()}}),transactions:ts.map(transactionView),...(audits?{audit:audits,issuance_delta_cents:await transactions(d).aggregate([{$match:{appId:app._id}},{$group:{_id:null,total:{$sum:"$signedDelta"}}}]).next().then(x=>x?.total??0)}:{})};
 }
 if(kind==="developer"&&parts.length===2&&parts[1]==="credentials"&&method==="POST")return createCredential(d,who,parts[0],await body(request));
 if(kind==="developer"&&parts.length===3&&parts[1]==="credentials"&&method==="DELETE")return revokeCredential(d,who,parts[0],parts[2]);
 }
 throw new AppApiError("unavailable","Endpoint unavailable.",404);
 }catch(e){if(e instanceof AppApiError)throw new AppError(e.message,e.status);throw e;}
 });
}
