import {test,before,beforeEach,after} from "node:test";
import assert from "node:assert/strict";
import {db,closeDatabase} from "../../lib/db";
import {appIndexes,activateLegacyApps,applications} from "../../lib/app-model";
import {registerApp,editApp,manageApp} from "../../lib/app-management";
import {DEFAULT_LIMITS,DEFAULT_SCOPES} from "../../lib/app-policy";
import type {Identity} from "../../lib/types";
if(!process.env.MONGODB_DB?.startsWith("fakebucks_test_app_"))throw new Error("Refusing non-test database");
const user:Identity={id:"u",name:"U",email:"u@example.test",admin:false},admin={...user,id:"admin",admin:true};
const meta={name:"Auto app",description:"Trusted",website:"https://example.test"};
const names=["app_applications","app_audit","app_owners"];
beforeEach(async()=>{const d=await db();for(const n of names)await d.collection(n).deleteMany({});await appIndexes(d);});
after(async()=>{await(await db()).dropDatabase();await closeDatabase();});
test("only admins register apps",async()=>{await assert.rejects(async()=>registerApp(await db(),user,meta),{status:403});assert.equal(await applications(await db()).countDocuments(),0);});
test("new app is immediately approved with safe defaults",async()=>{const {app}=await registerApp(await db(),admin,meta);assert.equal(app.status,"approved");assert.deepEqual(app.approved_scopes,DEFAULT_SCOPES);assert.equal(app.credit_mode,"refunds");assert.deepEqual(app.limits,DEFAULT_LIMITS);assert.ok(Object.values(app.mint_limits).every(n=>n===0));});
test("requested scopes limits and mint are applied at registration",async()=>{
 const limits={per_operation_cents:1000,daily_cents:2000,lifetime_cents:3000};
 const {app}=await registerApp(await db(),admin,{...meta,approved_scopes:["balance:debit","balance:credit"],limits,credit_mode:"mint",mint_limits:limits,app_daily_cents:777});
 assert.equal(app.status,"approved");assert.deepEqual(app.approved_scopes,["balance:debit","balance:credit"]);assert.deepEqual(app.limits,limits);assert.deepEqual(app.mint_limits,limits);assert.equal(app.credit_mode,"mint");assert.equal(app.app_daily_cents,777);
 await assert.rejects(async()=>registerApp(await db(),admin,{...meta,credit_mode:"mint",mint_limits:limits}),{code:"invalid_request"});
 await assert.rejects(async()=>registerApp(await db(),admin,{...meta,approved_scopes:["balance:credit"],credit_mode:"mint"}),{code:"invalid_request"});
 await assert.rejects(async()=>registerApp(await db(),admin,{...meta,status:"suspended"}));
});
test("edit never sends an app back to review or unsuspends it",async()=>{
 const d=await db(),{app}=await registerApp(d,admin,meta);
 assert.equal((await editApp(d,admin,app.app_id,{description:"New"})).app.status,"approved");
 await manageApp(d,admin,app.app_id,{status:"suspended"});
 assert.equal((await editApp(d,admin,app.app_id,{description:"Newer"})).app.status,"suspended");
 await assert.rejects(()=>editApp(d,admin,app.app_id,{status:"pending"} as never));
 assert.equal((await manageApp(d,admin,app.app_id,{status:"deleted"})).app.status,"deleted");
});
test("legacy draft/pending migrate once; suspended/deleted untouched; stored policy preserved",async()=>{
 const d=await db(),col=d.collection("app_applications"),base={ownerUserId:"admin",description:"",website:"https://x.test",approvedScopes:[],creditMode:"refunds",limits:{...DEFAULT_LIMITS},mintLimits:{per_operation_cents:0,daily_cents:0,lifetime_cents:0},appDailyCents:5_000_000,policyVersion:1,fence:0,createdAt:new Date(),updatedAt:new Date()};
 const L={per_operation_cents:5,daily_cents:6,lifetime_cents:7};
 await col.insertMany([
  {...base,_id:"draft" as never,clientId:"app_1",name:"deltastrike",status:"draft"},
  {...base,_id:"pend" as never,clientId:"app_2",name:"p",status:"pending",approvedScopes:["balance:debit"],limits:L,appDailyCents:9},
  {...base,_id:"mintpend" as never,clientId:"app_3",name:"m",status:"pending",approvedScopes:["balance:debit","balance:credit"],creditMode:"mint",mintLimits:L},
  {...base,_id:"badmint" as never,clientId:"app_4",name:"b",status:"pending",approvedScopes:["balance:debit"],creditMode:"mint",mintLimits:L},
  {...base,_id:"susp" as never,clientId:"app_5",name:"s",status:"suspended"},
  {...base,_id:"del" as never,clientId:"app_6",name:"d",status:"deleted"},
  {...base,_id:"appr" as never,clientId:"app_7",name:"a",status:"approved",approvedScopes:["profile"]},
 ]);
 await activateLegacyApps(d);
 const get=(id:string)=>col.findOne({_id:id as never}) as Promise<any>;
 const dr=await get("draft");assert.equal(dr.status,"approved");assert.deepEqual(dr.approvedScopes,DEFAULT_SCOPES);assert.equal(dr.creditMode,"refunds");assert.equal(dr.policyVersion,2);assert.equal(dr.fence,1);
 const p=await get("pend");assert.equal(p.status,"approved");assert.deepEqual(p.approvedScopes,["balance:debit"]);assert.deepEqual(p.limits,L);assert.equal(p.appDailyCents,9);
 const m=await get("mintpend");assert.equal(m.creditMode,"mint");assert.deepEqual(m.mintLimits,L);
 const b=await get("badmint");assert.equal(b.creditMode,"refunds");assert.equal(b.mintLimits.daily_cents,0);
 assert.equal((await get("susp")).status,"suspended");assert.equal((await get("del")).status,"deleted");
 const a=await get("appr");assert.deepEqual(a.approvedScopes,["profile"]);assert.equal(a.policyVersion,1);
 const before=await col.find().sort({_id:1}).toArray(),audits=await d.collection("app_audit").countDocuments({event:"app_auto_activated"});assert.equal(audits,4);
 await activateLegacyApps(d);await activateLegacyApps(d);
 assert.deepEqual(await col.find().sort({_id:1}).toArray(),before);assert.equal(await d.collection("app_audit").countDocuments({event:"app_auto_activated"}),4);
});
test("racing migrations activate each row exactly once",async()=>{
 const d=await db(),col=d.collection("app_applications");
 await col.insertOne({_id:"r" as never,clientId:"app_r",ownerUserId:"admin",name:"r",description:"",website:"https://x.test",status:"pending",approvedScopes:[],creditMode:"refunds",limits:{...DEFAULT_LIMITS},mintLimits:{per_operation_cents:0,daily_cents:0,lifetime_cents:0},appDailyCents:1,policyVersion:1,fence:0,createdAt:new Date(),updatedAt:new Date()});
 await Promise.all([activateLegacyApps(d),activateLegacyApps(d),activateLegacyApps(d)]);
 const r=await col.findOne({_id:"r" as never}) as any;assert.equal(r.policyVersion,2);assert.equal(await d.collection("app_audit").countDocuments({target:"r"}),1);
});
test("appIndexes (every app route entry) runs the migration",async()=>{
 const d=await db();await d.collection("app_applications").insertOne({_id:"i" as never,clientId:"app_i",ownerUserId:"admin",name:"i",description:"",website:"https://x.test",status:"draft",approvedScopes:[],creditMode:"refunds",limits:{...DEFAULT_LIMITS},mintLimits:{per_operation_cents:0,daily_cents:0,lifetime_cents:0},appDailyCents:1,policyVersion:1,fence:0,createdAt:new Date(),updatedAt:new Date()});
 const {MongoClient}=await import("mongodb");const c=await new MongoClient(process.env.MONGODB_URI!).connect();
 try{await appIndexes(c.db(process.env.MONGODB_DB));assert.equal(((await d.collection("app_applications").findOne({_id:"i" as never})) as any).status,"approved");}finally{await c.close();}
});
test("migration does not overwrite a concurrent admin edit",async()=>{
 const d=await db(),col=d.collection("app_applications"),L={per_operation_cents:11,daily_cents:12,lifetime_cents:13};
 await col.insertOne({_id:"c" as never,clientId:"app_c",ownerUserId:"admin",name:"c",description:"",website:"https://x.test",status:"pending",approvedScopes:[],creditMode:"refunds",limits:{...DEFAULT_LIMITS},mintLimits:{per_operation_cents:0,daily_cents:0,lifetime_cents:0},appDailyCents:1,policyVersion:1,fence:0,createdAt:new Date(),updatedAt:new Date()});
 for(let i=0;i<10;i++){
  await col.updateOne({_id:"c" as never},{$set:{status:"pending",approvedScopes:[],policyVersion:1,fence:0}});
  const mig=activateLegacyApps(d);
  // No status filter: edit lands whether it runs before (pending) or after (approved) activation; both orderings must keep it.
  assert.equal((await col.updateOne({_id:"c" as never},{$set:{approvedScopes:["profile"],limits:L},$inc:{policyVersion:1,fence:1}})).matchedCount,1);
  await mig;await activateLegacyApps(d);
  const r=await col.findOne({_id:"c" as never}) as any;assert.equal(r.status,"approved");
  // either the edit landed first (kept) or after activation (also kept); never reverted to stale scopes/limits
  assert.deepEqual(r.approvedScopes,["profile"]);assert.deepEqual(r.limits,L);
 }
});
test("legacy -1 mint policy is preserved exactly; finite 0 stays invalid",async()=>{
 const d=await db(),col=d.collection("app_applications"),U={per_operation_cents:-1,daily_cents:-1,lifetime_cents:-1},Z={per_operation_cents:-1,daily_cents:0,lifetime_cents:-1};
 const base={ownerUserId:"admin",description:"",website:"https://x.test",approvedScopes:["balance:debit","balance:credit"],creditMode:"mint",limits:{...DEFAULT_LIMITS},appDailyCents:5,policyVersion:1,fence:0,createdAt:new Date(),updatedAt:new Date()};
 await col.insertMany([{...base,_id:"u" as never,clientId:"app_u",name:"u",status:"pending",mintLimits:U},{...base,_id:"z" as never,clientId:"app_z",name:"z",status:"draft",mintLimits:Z}]);
 await activateLegacyApps(d);
 const u=await col.findOne({_id:"u" as never}) as any,z=await col.findOne({_id:"z" as never}) as any;
 assert.equal(u.status,"approved");assert.equal(u.creditMode,"mint");assert.deepEqual(u.mintLimits,U);assert.deepEqual(u.approvedScopes,["balance:debit","balance:credit"]);
 assert.equal(z.status,"approved");assert.equal(z.creditMode,"refunds");assert.deepEqual(z.mintLimits,{per_operation_cents:0,daily_cents:0,lifetime_cents:0});
});
