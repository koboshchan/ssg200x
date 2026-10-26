import test,{mock} from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {NextRequest} from "next/server";
let userId:string|null=null,admin=false;
let middleware:any, inMiddleware=false;
const adminLookups:string[]=[];
const account=()=>userId?{id:userId,firstName:"Alice",username:null,passwordEnabled:false,primaryEmailAddressId:"e",emailAddresses:[{id:"e",emailAddress:"private@example.test",verification:{status:"verified"}}],externalAccounts:[{provider:"google",emailAddress:"private@example.test"}],privateMetadata:{admin}}:null;
mock.module("@clerk/nextjs/server",{namedExports:{
 auth:async()=>({userId,sessionId:"session_fixture"}),currentUser:async()=>{
  if(inMiddleware)throw Error("App Router auth() is unavailable before middleware forwards headers");
  return account();
 },
 clerkClient:async()=>({users:{getUser:async(id:string)=>{adminLookups.push(id);return account();}}}),
 clerkMiddleware:(callback:any)=>{middleware=async(...args:any[])=>{inMiddleware=true;try{return await callback(...args);}finally{inMiddleware=false;}};return async()=>{};}
}});
mock.module("../lib/clerk-reads.ts",{namedExports:{
 currentClerkSession:async()=>{},
 currentClerkUser:async(id:string)=>{adminLookups.push(id);return account();}
}});
mock.module("../lib/store.ts",{namedExports:{rateLimit:async()=>{},mutate:async()=>{throw Error("must not reach writes");}}});
mock.module("../lib/feature-flags.ts",{namedExports:{enforceFeatureRequest:async()=>{},featureSnapshot:async()=>({features:{},revision:0}),requireFeature:async()=>{},changeFeatures:async()=>{throw Error("must not reach writes");}}});
mock.module("../lib/site-maintenance.ts",{namedExports:{siteMaintenance:async()=>({blocked:false})}});
const {endpoint,parse}=await import("../lib/api.ts");
const {POST:adminAction}=await import("../app/api/admin/route.ts");
await import("../proxy.ts");
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_fixture";
process.env.CLERK_SECRET_KEY="sk_fixture_only";
process.env.APP_ORIGIN="https://example.test";
const request=(path:string,method="GET",body?:object)=>new Request("https://example.test"+path,{method,headers:{origin:"https://example.test","content-type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
test("anonymous endpoint fails before business handler",async()=>{
 userId=null;let called=false;
 const r=await endpoint(request("/api/room"),async()=>{called=true;return {};});
 assert.equal(r.status,401);assert.equal(called,false);
});
test("identity is session-derived, never query/body userId or administrator flags",async()=>{
 userId="alice";admin=false;
 const r=await endpoint(request("/api/settings?userId=bob","POST",{userId:"bob",admin:true}),async who=>({id:who.id,admin:who.admin}));
 assert.equal(r.status,200);assert.deepEqual(await r.json(),{id:"alice",admin:false});
});
test("non-admin cannot invoke real administrator route even with forged payload",async()=>{
 userId="alice";admin=false;
 const r=await adminAction(request("/api/admin","POST",{admin:true,type:"balance",publicId:"abcdef0123456789",delta:100}));
 assert.equal(r.status,403);
});
test("cross-origin writes fail before handler",async()=>{
 userId="alice";let called=false;
 const r=await endpoint(new Request("https://example.test/api/settings",{method:"POST",headers:{origin:"https://evil.test","content-type":"application/json"},body:"{}"}),async()=>{called=true;return {};});
 assert.equal(r.status,403);assert.equal(called,false);
});
test("server middleware protects all room pages, including RSC requests",async()=>{
 userId=null;
 for(const path of ["/poker","/blackjack","/roulette","/markets","/wallet","/settings","/standings","/players"]){
  const req=new NextRequest("https://example.test"+path+"?_rsc=fixture");
  const r=await middleware(async()=>({userId,sessionId:"session_fixture"}),req);
  assert.equal(r.status,307,path);const game=["/poker","/blackjack","/roulette"].includes(path);assert.equal(r.headers.get("location"),"https://example.test/"+(game?"?next="+encodeURIComponent(path):""),path);
 }
});
test("players admin page is denied server-side to ordinary authenticated users",async()=>{
 userId="alice";admin=false;
 assert.equal((await middleware(async()=>({userId,sessionId:"session_fixture"}),new NextRequest("https://example.test/players"))).status,404);
 admin=true;assert.equal(await middleware(async()=>({userId,sessionId:"session_fixture"}),new NextRequest("https://example.test/players")),undefined);
});
test("intentional public pages remain public",async()=>{
 userId=null;
 for(const path of ["/","/leaderboard","/privacy","/terms"])assert.equal(await middleware(async()=>({userId,sessionId:"session_fixture"}),new NextRequest("https://example.test"+path)),undefined);
});
test("every external API uses authenticated endpoint; internal live uses process secret",async()=>{
 const routes=(base:string):string[]=>readdirSync(base,{withFileTypes:true}).flatMap(e=>e.isDirectory()?routes(base+"/"+e.name):e.name==="route.ts"?[base]:[]);
 for(const full of routes("app/api")){
  const dir=full.slice("app/api/".length),code=readFileSync(full+"/route.ts","utf8");
  if(dir==="internal-live"){assert.match(code,/if\(!internalLiveAuthorized\(request\)\)/);continue;}
  if(dir==="features"){assert.match(code,/export async function GET/);assert.doesNotMatch(code,/export async function (POST|PUT|PATCH|DELETE)/);assert.match(code,/featureSnapshot\(\)/);continue;}
  if(/\bendpoint\(/.test(code)){assert.match(code,/endpoint\(request,/,dir);continue;}
  // Read-only route that authenticates directly: must verify the active Clerk session and 401 before any data access.
  if(!/await auth\(\)/.test(code)){
   // No handler-level auth: only acceptable as a GET-only route that the middleware 401s for anonymous callers.
   assert.doesNotMatch(code,/export async function (POST|PUT|PATCH|DELETE)/,dir);userId=null;
   const r=await middleware(async()=>({userId,sessionId:null}),new NextRequest("https://example.test/api/"+dir));assert.equal(r.status,401,dir);continue;
  }
  assert.match(code,/await auth\(\)[\s\S]*?!userId\|\|!sessionId[\s\S]*?status:401[\s\S]*?await currentClerkSession\(sessionId,userId\)/,dir);assert.doesNotMatch(code,/export async function (POST|PUT|PATCH|DELETE)/,dir);
 }
});

test("admin middleware reads the verified callback ID without App Router auth helpers",async()=>{
 userId="alice";admin=true;adminLookups.length=0;
 for(const path of ["/players","/players/detail","/admin","/admin/settings"]){
  assert.equal(await middleware(async()=>({userId:"callback-session",sessionId:"session_fixture"}),new NextRequest("https://example.test"+path)),undefined);
 }
 assert.deepEqual(adminLookups,Array(4).fill("callback-session"));
 admin=false;
 for(const path of ["/players","/players/detail","/admin","/admin/settings"]){
  assert.equal((await middleware(async()=>({userId:"callback-session",sessionId:"session_fixture"}),new NextRequest("https://example.test"+path))).status,404);
 }
});
test("signed-out admin requests never look up a user",async()=>{
 userId=null;adminLookups.length=0;
 for(const path of ["/players","/admin"]){
  assert.equal((await middleware(async()=>({userId:null}),new NextRequest("https://example.test"+path))).status,307);
 }
 assert.deepEqual(adminLookups,[]);
});

test("blackjack chip composition uses a bounded larger body while other APIs keep 2KB limit",async()=>{
 const {z}=await import("zod");const data={amount:100000,chips:Array(1000).fill(100)};
 assert.deepEqual(await parse(request("/api/blackjack","POST",data),z.unknown(),8192),data);
 await assert.rejects(()=>parse(request("/api/settings","POST",data),z.unknown()),{status:413});
 await assert.rejects(()=>parse(request("/api/blackjack","POST",{chips:"x".repeat(8200)}),z.unknown(),8192),{status:413});
});
