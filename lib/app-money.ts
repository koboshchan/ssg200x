import {randomUUID} from "node:crypto";
import type {Db,ClientSession} from "mongodb";
import type {Room} from "./types";
import {assertRoom} from "./poker";
import {applications,credentials,grants,transactions,usage,appIndexes,appTransaction,audit,RetryAppTransaction,type Transaction,type Grant} from "./app-model";
import {type AppClient,currentClient,fenceClient,activeGrant,effectiveScopes} from "./app-auth";
import {moneySchema,idempotencyDigest,digest,requireApp,minLimits,DEFAULT_LIMITS,type MoneyInput,type Limits} from "./app-policy";
import {transactionView} from "./app-management";
import {appThrottle} from "./app-linking";
function fingerprint(appUserId:string,operation:string,v:MoneyInput,generation:string){return digest("money-fingerprint",JSON.stringify(["v1",appUserId,operation,generation,v.amount_cents,v.description,v.external_reference,v.credit_reason??null,v.original_transaction_id??null]));}
async function addBudget(d:Db,id:string,amount:number,limit:number,session:ClientSession){
 const c=usage(d),old=await c.findOne({_id:id},{session}),used=old?.amount??0;
 requireApp(Number.isSafeInteger(used+amount)&&used+amount<=limit,"limit_exceeded","Application or consent spending limit exceeded.",409);
 await c.updateOne({_id:id},{$inc:{amount,count:1}},{upsert:true,session});
}
async function budgets(d:Db,appId:string,g:Grant,kind:"debit"|"mint",amount:number,limits:Limits,appLimits:Limits,appDaily:number,session:ClientSession){
 requireApp(amount<=limits.per_operation_cents,"limit_exceeded","Per-operation limit exceeded.",409);
 const day=new Date().toISOString().slice(0,10),base="grant:"+g._id+":"+g.authorizationVersion+":"+kind+":";
 await addBudget(d,base+day,amount,limits.daily_cents,session);await addBudget(d,base+"lifetime",amount,limits.lifetime_cents,session);
 // App-scoped daily volume applies to every new debit and minted credit together.
 await addBudget(d,"app:"+appId+":volume:"+day,amount,appDaily,session);
 // Per-app user limits span consent renewals, so relinking cannot reset budgets.
 const userBase="user:"+appId+":"+g.userId+":"+kind+":";
 await addBudget(d,userBase+day,amount,appLimits.daily_cents,session);await addBudget(d,userBase+"lifetime",amount,appLimits.lifetime_cents,session);
 if(kind==="mint"){
 await addBudget(d,"app:"+appId+":mint:"+day,amount,appLimits.daily_cents,session);
 await addBudget(d,"app:"+appId+":mint:lifetime",amount,appLimits.lifetime_cents,session);
 }
}
async function response(d:Db,client:AppClient,t:Transaction,session?:ClientSession){
 const live=await currentClient(d,client,session,true),g=await grants(d).findOne({_id:t.grantId,appId:t.appId},session?{session}:{});
 const canRead=g&&g.authorizationVersion===t.authorizationVersion&&effectiveScopes(live,g).includes("balance:read");
 // Never return historical before/after balances. Current cash only when consent still permits it.
 let available:number|undefined;
 if(canRead){const r=await d.collection<Room>("rooms").findOne({_id:"main"},session?{session}:{}),m=r?.members.find(m=>m.id===t.userId&&m.approved&&!m.accessRevoked);available=m?.wallet;}
 return {...transactionView(t),...(available!==undefined?{available_cents:available}:{})};
}
export async function readTransaction(d:Db,client:AppClient,id:string,byKey=false){
 await currentClient(d,client,undefined,true);
 const t=await transactions(d).findOne(byKey?{appId:client.app._id,keyDigest:idempotencyDigest(id)}:{_id:id,appId:client.app._id});
 requireApp(t,"unavailable","Transaction unavailable.",404);return response(d,client,t);
}
export async function moveAppMoney(d:Db,client:AppClient,appUserId:string,operation:"debit"|"credit",key:string,input:unknown){
 const v=moneySchema.parse(input),keyDigest=idempotencyDigest(key);
 requireApp(operation==="credit"||(!v.credit_reason&&!v.original_transaction_id),"invalid_request","Debit cannot contain credit fields.");
 requireApp(operation!=="credit"||(v.credit_reason==="mint"&&!v.original_transaction_id)||(v.credit_reason==="refund"&&v.original_transaction_id),"invalid_request","Credit must identify mint or an original debit refund.");
 await appIndexes(d);await appThrottle(d,"money:"+client.app._id,300);
 const result=await appTransaction(d,async session=>{
 const existing=await transactions(d).findOne({appId:client.app._id,keyDigest},{session});
 if(existing){
 await currentClient(d,client,session,true);
 const current=await grants(d).findOne({_id:existing.grantId,appId:client.app._id},{session});
 requireApp(current&&current.authorizationVersion===existing.authorizationVersion&&existing.fingerprint===fingerprint(appUserId,operation,v,current.authorizationVersion),"idempotency_conflict","Idempotency key was used for a different operation or consent generation.",409);
 return {body:await response(d,client,existing,session),replayed:true};
 }
 const live=await fenceClient(d,client,session);
 const refund=operation==="credit"&&v.credit_reason==="refund";
 let g:Grant;
 if(refund){
 const original=await transactions(d).findOne({_id:v.original_transaction_id,appId:live.app._id,appUserId,operation:"debit"},{session});
 requireApp(original&&original.createdAt.getTime()+90*86400_000>Date.now(),"unavailable","Original debit unavailable or refund window expired.",404);
 requireApp(live.app.approvedScopes.includes("balance:debit")&&live.credential.scopes.includes("balance:debit"),"insufficient_scope","Refund facility not approved.",403);
 const found=await grants(d).findOne({_id:original.grantId,appId:live.app._id,appUserId},{session});requireApp(found,"unavailable","Original association unavailable.",404);g=found;
 // Append-only original ledger is never modified. A separate transactional sum reserves partial refunds.
 await addBudget(d,"refund:"+original._id,v.amount_cents,original.amountCents,session);
 }else{
 g=await activeGrant(d,live,appUserId,operation==="debit"?"balance:debit":"balance:credit",session);
 if(operation==="credit")requireApp(live.app.creditMode==="mint","insufficient_scope","Arbitrary minting is disabled.",403);
 const limits=minLimits(DEFAULT_LIMITS,g.limits,operation==="debit"?live.app.limits:live.app.mintLimits);
 await budgets(d,live.app._id,g,operation==="debit"?"debit":"mint",v.amount_cents,limits,operation==="debit"?live.app.limits:live.app.mintLimits,live.app.appDailyCents,session);
 }
 // Updating the same grant row makes lowering limits/revocation serialize with new money.
 requireApp((await grants(d).updateOne({_id:g._id,authorizationVersion:g.authorizationVersion},{$inc:{fence:1}},{session})).matchedCount,"unavailable","Association changed.",409);
 const r=await d.collection<Room>("rooms").findOne({_id:"main"},{session});requireApp(r,"temporarily_unavailable","Room unavailable.",503);
 requireApp(!r.siteMaintenance,"temporarily_unavailable","Under maintenance.",503);
 const m=r.members.find(m=>m.id===g.userId);requireApp(m&&m.approved&&!m.accessRevoked,"unavailable","Player unavailable.",403);
 const delta=operation==="debit"?-v.amount_cents:v.amount_cents,before=m.wallet,after=before+delta,issuanceBefore=r.issuance??0;
 requireApp(Number.isSafeInteger(after)&&after>=0,"insufficient_funds","Not enough available cash.",409);requireApp(after<=1_000_000_000,"limit_exceeded","Wallet simulation limit exceeded.",409);
 requireApp(Number.isSafeInteger(issuanceBefore+delta)&&Number.isSafeInteger((m.adjustments??0)+delta),"limit_exceeded","Simulation precision exceeded.",409);
 m.wallet=after;m.adjustments=(m.adjustments??0)+delta;r.issuance=issuanceBefore+delta;
 m.activity=[(operation==="debit"?"Application purchase":"Application "+(refund?"refund":"reward"))+" $"+(v.amount_cents/100).toFixed(2)+" · "+live.app.name,...(m.activity??[])].slice(0,40);
 assertRoom(r);
 const {_id,...fields}=r;Reflect.deleteProperty(fields,"chatMutationLock");fields.version=r.version+1;
 if(!(await d.collection<Room>("rooms").updateOne({_id,version:r.version},{$set:fields,$unset:{chatMutationLock:""}},{session})).matchedCount)throw new RetryAppTransaction();
 const t:Transaction={_id:randomUUID(),appId:live.app._id,credentialId:live.credential._id,grantId:g._id,authorizationVersion:g.authorizationVersion,userId:g.userId,appUserId,operation,creditReason:v.credit_reason,amountCents:v.amount_cents,signedDelta:delta,originalTransactionId:v.original_transaction_id,externalReference:v.external_reference,description:v.description,fingerprint:fingerprint(appUserId,operation,v,g.authorizationVersion),keyDigest,before,after,issuanceBefore,issuanceAfter:issuanceBefore+delta,roomVersion:r.version+1,limits:g.limits,policyVersion:live.app.policyVersion,createdAt:new Date(),responseVersion:1};
 await transactions(d).insertOne(t,{session});await audit(d,live.app._id,"money_committed",t._id,{credentialId:live.credential._id,grantId:g._id,authorizationVersion:g.authorizationVersion,signedDelta:delta,requestKeyDigest:keyDigest},session);
 return {body:await response(d,live,t,session),replayed:false};
 });
 return result;
}
