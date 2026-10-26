import test,{mock} from "node:test";
import assert from "node:assert/strict";
let status="verified";
const account=()=>({id:"ordinary",firstName:"QA",passwordEnabled:true,primaryEmailAddressId:"e",emailAddresses:[{id:"e",emailAddress:"qa@example.test",verification:{status}}],externalAccounts:[],privateMetadata:{admin:false}});
mock.module("@clerk/nextjs/server",{namedExports:{auth:async()=>({userId:"ordinary",sessionId:"active"})}});
mock.module("../lib/clerk-reads.ts",{namedExports:{currentClerkSession:async()=>{},currentClerkUser:async()=>account()}});
mock.module("../lib/store.ts",{namedExports:{rateLimit:async()=>{}}});
mock.module("../lib/site-maintenance.ts",{namedExports:{siteMaintenance:async()=>({blocked:false})}});
mock.module("../lib/feature-flags.ts",{namedExports:{enforceFeatureRequest:async()=>{}}});
mock.module("../lib/tab-guard.ts",{namedExports:{checkActionTab:async()=>{}}});
const {endpoint}=await import("../lib/api.ts");
const saved={...process.env};
test("real HTTP endpoint allows only verified ordinary DEV email, without granting administrator",async()=>{
 try{
  Object.assign(process.env,{SSG_QA_EMAIL_AUTH:"1",SSG_ISOLATED_QA:"1",QA_PROTECTED_COLLECTIONS:"candles",CLERK_PUBLISHABLE_KEY:"pk_test_"+Buffer.from("owned-qa.clerk.accounts.dev$").toString("base64"),CLERK_SECRET_KEY:"sk_test_"+"a".repeat(32)});
  const request=()=>new Request("https://isolated.example.test/api/room");
  let calls=0;
  const handler=async(who:any)=>{calls++;return {id:who.id,admin:who.admin};};
  let response=await endpoint(request(),handler);
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{id:"ordinary",admin:false});
  assert.equal(calls,1);
  for(const config of [
   {SSG_QA_EMAIL_AUTH:"0"}, {SSG_QA_EMAIL_AUTH:"1",SSG_ISOLATED_QA:"0"},
   {SSG_ISOLATED_QA:"1",CLERK_SECRET_KEY:"sk_live_"+"a".repeat(32)},
   {CLERK_SECRET_KEY:"sk_test_"+"a".repeat(32)}
  ]){
   Object.assign(process.env,config);
   if(config.CLERK_SECRET_KEY?.startsWith("sk_test_"))status="unverified";
   response=await endpoint(request(),handler);
   assert.equal(response.status,403);
   assert.equal(calls,1);
  }
 }finally{
  for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];
  Object.assign(process.env,saved);
 }
});
