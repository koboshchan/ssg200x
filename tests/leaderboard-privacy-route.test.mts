import test,{mock} from "node:test";
import assert from "node:assert/strict";
import {freshRoom,register} from "../lib/poker";
import {publicRoom} from "../lib/public";
let userId:string|null="alice",room=freshRoom(),writes=0;
const identity=(id:string)=>({id,name:id,email:id+"@test",admin:false});
register(room,identity("alice"));register(room,identity("bob"));
mock.module("@clerk/nextjs/server",{namedExports:{auth:async()=>({userId,sessionId:userId?"fixture-session":null})}});
mock.module("../lib/clerk-reads.ts",{namedExports:{
 currentClerkSession:async()=>{},currentClerkUser:async(id:string)=>({
 id,firstName:id,primaryEmailAddressId:"email",passwordEnabled:false,
 emailAddresses:[{id:"email",emailAddress:id+"@test",verification:{status:"verified"}}],
 externalAccounts:[{provider:"google",emailAddress:id+"@test"}],privateMetadata:{}
 })
}});
mock.module("../lib/site-maintenance.ts",{namedExports:{siteMaintenance:async()=>({blocked:false})}});
mock.module("../lib/store.ts",{namedExports:{
 rateLimit:async()=>{},visit:async()=>structuredClone(room),
 mutate:async(fn:(room:typeof room)=>void)=>{
  const next=structuredClone(room);fn(next);room=next;writes++;return {room};
 }
}});
mock.module("../lib/public.ts",{namedExports:{freshPublicRoom:async(r:typeof room,who:ReturnType<typeof identity>)=>publicRoom(r,who)}});
process.env.CLERK_PUBLISHABLE_KEY="pk_privacy_fixture";
process.env.CLERK_SECRET_KEY="sk_privacy_fixture";
process.env.APP_ORIGIN="https://privacy.test";
const {GET,POST}=await import("../app/api/settings/route");
const req=(body?:unknown,origin="https://privacy.test")=>new Request("https://privacy.test/api/settings?userId=bob",body===undefined?{}:{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify(body)});
test("real settings route authenticates, validates strict booleans and updates only session owner",async()=>{
 userId=null;const initial=structuredClone(room);
 assert.equal((await GET(req())).status,401);
 assert.equal((await POST(req({hideFromLeaderboard:true}))).status,401);
 userId="alice";
 assert.deepEqual(await(await GET(req())).json(),{triggerInputMode:"price",hideFromLeaderboard:false});
 assert.equal((await POST(req({hideFromLeaderboard:true},"https://evil.test"))).status,403);
 for(const payload of [{},{hideFromLeaderboard:"true"},{hideFromLeaderboard:1},{hideFromLeaderboard:null},{hideFromLeaderboard:true,userId:"bob"},{hideFromLeaderboard:true,publicId:room.members[1].publicId},{hideFromLeaderboard:true,admin:true}]){
  assert.equal((await POST(req(payload))).status,400,JSON.stringify(payload));
 }
 assert.equal(writes,0);assert.deepEqual(room,initial);
 const id="12345678-1234-4123-8123-123456789abc";
 const saved=await POST(req({hideFromLeaderboard:true,requestId:id,requestAt:Date.now()}));
 assert.equal(saved.status,200);assert.equal((await saved.json()).me.hideFromLeaderboard,true);
 assert.equal(room.members[0].settings?.hideFromLeaderboard,true);
 assert.equal(room.members[1].settings,undefined);
 assert.equal((await POST(req({triggerInputMode:"pnl"}))).status,200);
 assert.deepEqual(await(await GET(req())).json(),{triggerInputMode:"pnl",hideFromLeaderboard:true});
 // A replay cannot silently toggle the privacy setting back.
 assert.equal((await POST(req({hideFromLeaderboard:false,requestId:id}))).status,200);
 assert.equal(room.members[0].settings?.hideFromLeaderboard,true);
 userId="bob";
 assert.equal((await POST(req({hideFromLeaderboard:true,requestId:id}))).status,409);
 assert.equal(room.members[1].settings,undefined);
 userId="alice";
 assert.equal((await POST(req({hideFromLeaderboard:false,requestAt:Date.now()-121000}))).status,409);
 assert.equal((await POST(req({hideFromLeaderboard:false}))).status,200);
 assert.deepEqual(await(await GET(req())).json(),{triggerInputMode:"pnl",hideFromLeaderboard:false});
 assert.equal((await GET(req())).headers.get("cache-control"),"no-store");
});
