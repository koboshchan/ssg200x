import test from "node:test";
import assert from "node:assert/strict";
import {isolatedQaEmailEnabled,verifiedAccountEmail} from "../runtime/account-policy.mjs";
import {verifiedGoogleEmail} from "../lib/google-identity";
// @ts-expect-error Shared custom-server JavaScript runtime.
import {verifiedSocketIdentity} from "../runtime/socket-identity.mjs";
// @ts-expect-error Runtime-only JavaScript guard.
import {sessionGuard} from "../runtime/chat-session.mjs";
const pk=(host:string)=>"pk_test_"+Buffer.from(host+"$").toString("base64");
const env={SSG_QA_EMAIL_AUTH:"1",SSG_ISOLATED_QA:"1",QA_PROTECTED_COLLECTIONS:"candles",CLERK_PUBLISHABLE_KEY:pk("owned-qa.clerk.accounts.dev"),CLERK_SECRET_KEY:"sk_test_"+"a".repeat(32)};
const user={firstName:"Ordinary",passwordEnabled:true,primaryEmailAddressId:"e",emailAddresses:[{id:"e",emailAddress:"QA@example.test",verification:{status:"verified"}}],externalAccounts:[],privateMetadata:{admin:false}};
const rejected:Record<string,string|undefined>[]=[
 {},{...env,SSG_QA_EMAIL_AUTH:undefined},{...env,SSG_QA_EMAIL_AUTH:"true"},
 {...env,SSG_ISOLATED_QA:undefined},{...env,SSG_ISOLATED_QA:"0"},
 {...env,QA_PROTECTED_COLLECTIONS:undefined},{...env,QA_PROTECTED_COLLECTIONS:"other"},
 {...env,CLERK_SECRET_KEY:"sk_live_"+"a".repeat(32)},
 {...env,CLERK_PUBLISHABLE_KEY:env.CLERK_PUBLISHABLE_KEY.replace("pk_test_","pk_live_")},
 {...env,CLERK_SECRET_KEY:"sk_test_"},{...env,CLERK_SECRET_KEY:"sk_test_bad!key"},
 {...env,CLERK_PUBLISHABLE_KEY:"pk_test_notbase64"},
 {...env,CLERK_PUBLISHABLE_KEY:pk("clerk.production.example")},
 {...env,CLERK_PUBLISHABLE_KEY:pk("qa.clerk.accounts.dev.evil.test")},
 {...env,CLERK_PUBLISHABLE_KEY:pk("https://qa.clerk.accounts.dev")},
 {...env,CLERK_PUBLISHABLE_KEY:pk("qa.clerk.accounts.dev")+"!"},
 {...env,CLERK_PUBLISHABLE_KEY:"pk_test_"+Buffer.from("qa.clerk.accounts.dev").toString("base64")},
 {...env,CLERK_PUBLISHABLE_KEY:pk("qa.clerk.accounts.dev")+"AAAA"}
];
test("email allowance requires all isolation guards and independently valid DEV key shapes",()=>{
 for(const config of rejected){
  assert.equal(isolatedQaEmailEnabled(config),false);
  assert.equal(verifiedAccountEmail(user,config),undefined);
  assert.equal(verifiedSocketIdentity(user,"ordinary",config),null);
 }
});
test("ordinary verified email works only in isolated opted-in DEV and grants no admin",()=>{
 assert.equal(isolatedQaEmailEnabled(env),true);
 assert.equal(verifiedAccountEmail(user,env),"qa@example.test");
 assert.deepEqual(verifiedSocketIdentity(user,"ordinary",env),{id:"ordinary",name:"Ordinary",email:"qa@example.test",admin:false});
 const {CLERK_PUBLISHABLE_KEY,...rest}=env;
 assert.equal(isolatedQaEmailEnabled({...rest,NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:CLERK_PUBLISHABLE_KEY}),true);
 assert.equal(isolatedQaEmailEnabled({...env,NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:CLERK_PUBLISHABLE_KEY,CLERK_PUBLISHABLE_KEY:"pk_live_invalid"}),false);
});
test("unverified, missing, nonprimary verification and client-like admin metadata never qualify",()=>{
 for(const modified of [
  {...user,emailAddresses:[{...user.emailAddresses[0],verification:{status:"unverified"}}]},
  {...user,emailAddresses:[{...user.emailAddresses[0],verification:undefined}]},
  {...user,primaryEmailAddressId:"missing"},
  {...user,emailAddresses:[{...user.emailAddresses[0],emailAddress:""}]},
  {...user,primaryEmailAddressId:"unverified",emailAddresses:[...user.emailAddresses,{id:"unverified",emailAddress:"other@example.test",verification:{status:"unverified"}}]}
 ]){
  assert.equal(verifiedAccountEmail(modified,env),undefined);
  assert.equal(verifiedSocketIdentity({...modified,publicMetadata:{admin:true}},"ordinary",env),null);
 }
});
test("Google and preexisting trusted administrator policies remain unchanged for live/default config",()=>{
 const google={...user,passwordEnabled:false,externalAccounts:[{provider:"oauth_google",emailAddress:"qa@example.test"}]};
 for(const config of [{},...rejected]){
  assert.equal(verifiedAccountEmail(google,config),"qa@example.test");
  assert.equal(verifiedAccountEmail({...google,passwordEnabled:true},config),undefined);
  assert.equal(verifiedAccountEmail({...user,privateMetadata:{admin:true}},config),"qa@example.test");
 }
});
test("HTTP compatibility export and live socket renewal use the same policy",async()=>{
 const saved={...process.env};
 try{
  for(const key of ["SSG_QA_EMAIL_AUTH","SSG_ISOLATED_QA","QA_PROTECTED_COLLECTIONS","CLERK_PUBLISHABLE_KEY","NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY","CLERK_SECRET_KEY"])delete process.env[key];
  Object.assign(process.env,env);
  assert.equal(verifiedGoogleEmail(user),"qa@example.test");
  const socket={connected:true,data:{expires:Date.now()+60000,sessionId:"session",identity:{id:"ordinary",admin:false}}};
  const guard=sessionGuard({}, {reads:{session:async()=>({status:"active",userId:"ordinary"}),user:async()=>user}});
  await guard(socket);
  assert.equal(socket.data.identity.admin,false);
  process.env.CLERK_SECRET_KEY="sk_live_"+"a".repeat(32);
  assert.equal(verifiedGoogleEmail(user),undefined);
  await assert.rejects(()=>guard(socket),/session/);
 }finally{
  for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];
  Object.assign(process.env,saved);
 }
});
