import {test} from "node:test";
import assert from "node:assert/strict";
import {internalLiveAuthorized} from "../lib/internal-live";
import {POST} from "../app/api/internal-live/route";
import {freshRoom,register} from "../lib/poker";
import {publicRoom} from "../lib/public";
import {verifiedGoogleEmail} from "../lib/google-identity";
// @ts-expect-error Shared custom-server JavaScript runtime.
import {verifiedSocketIdentity} from "../runtime/socket-identity.mjs";
test("internal snapshots reject missing, wrong, and unequal length secrets before reading identity",async()=>{
 const previous=process.env.INTERNAL_LIVE_SECRET;process.env.INTERNAL_LIVE_SECRET="secret-for-test";
 try{
  for(const secret of [undefined,"wrong","x".repeat(15)]){
   const request=new Request("http://localhost/api/internal-live",{method:"POST",headers:secret?{"x-internal-live-secret":secret}:{},body:'{"admin":true,"id":"victim"}'});
   assert.equal(internalLiveAuthorized(request),false);
   assert.equal((await POST(request)).status,401);
  }
  assert.equal(internalLiveAuthorized(new Request("http://localhost",{headers:{"x-internal-live-secret":"secret-for-test"}})),true);
 }finally{if(previous===undefined)delete process.env.INTERNAL_LIVE_SECRET;else process.env.INTERNAL_LIVE_SECRET=previous;}
});
test("socket identity matches verified Google rules including admin exception",()=>{
 const base={passwordEnabled:false,publicMetadata:{role:""},externalAccounts:[{provider:"oauth_google",emailAddress:"Alice@test.com"}],primaryEmailAddressId:"e",emailAddresses:[{id:"e",emailAddress:"alice@test.com",verification:{status:"verified"}}]};
 for(const user of [base,{...base,passwordEnabled:true},{...base,externalAccounts:[]},{...base,emailAddresses:[{...base.emailAddresses[0],verification:{status:"unverified"}}]},{...base,externalAccounts:[{provider:"google",emailAddress:"other@test.com"}]},{...base,passwordEnabled:true,publicMetadata:{role:"admin"},externalAccounts:[]}]){
  assert.equal(verifiedSocketIdentity(user,"alice")?.email,verifiedGoogleEmail(user));
 }
});
test("full room fanout projection hides opponents cards and private portfolios",()=>{
 const r=freshRoom(),alice={id:"alice-id",name:"Alice",email:"alice@test.com",admin:false},bob={id:"bob-id",name:"Bob",email:"bob@test.com",admin:false};
 register(r,alice);register(r,bob);
 r.members[1].holdings=[{symbol:"BTC",units:987654,cost:123456}];
 r.seats[0]={userId:alice.id,stack:1000,hole:["As","Ah"],bet:0,committed:0,folded:false,inHand:true,actedAt:null,sitOut:false,leaveAfter:false,seen:Date.now()};
 r.seats[1]={...r.seats[0],userId:bob.id,hole:["Ks","Kh"]};
 r.street="preflop";
 const a=publicRoom(r,alice),b=publicRoom(r,bob);
 assert.deepEqual(a.seats[0]?.hole,["As","Ah"]);assert.deepEqual(a.seats[1]?.hole,["?","?"]);
 assert.deepEqual(b.seats[1]?.hole,["Ks","Kh"]);assert.deepEqual(b.seats[0]?.hole,["?","?"]);
 assert.deepEqual(a.holdings,[]);assert.equal(b.holdings[0].units,987654);
 assert.deepEqual(a.adminUsers,[]);assert.deepEqual(a.members,[]);assert.deepEqual(a.adminPositions,[]);
 for(const secret of ["alice-id","bob-id","alice@test.com","bob@test.com","Ks","Kh","987654"])assert.equal(JSON.stringify(a).includes(secret),false);
});

import {liveStatusCache} from "../lib/live-status-cache";
test("live status cache coalesces concurrent sockets and retries a failed refresh",async()=>{
 let reads=0;
 const cached=liveStatusCache(async()=>{reads++;return {active:true};});
 const results=await Promise.all(Array.from({length:30},()=>cached()));
 assert.equal(reads,1);assert.equal(results.length,30);await cached();assert.equal(reads,1);
 let failures=0;
 const retry=liveStatusCache(async()=>{if(++failures===1)throw new Error("temporary");return "ok";});
 await assert.rejects(retry());assert.equal(await retry(),"ok");assert.equal(failures,2);
});

// @ts-expect-error Shared custom-server JavaScript runtime.
import {emitRoomState} from "../runtime/room-state.mjs";
test("room:state initial connection and reconnect always get their own private snapshot",()=>{
 const r=freshRoom(),alice={id:"private-a",name:"Alice",email:"a@test.com",admin:false},bob={id:"private-b",name:"Bob",email:"b@test.com",admin:false};
 register(r,alice);register(r,bob);
 r.members[1].holdings=[{symbol:"BTC",units:42,cost:123}];
 const events:[string,ReturnType<typeof publicRoom>][]=[];
 const socket={data:{version:r.version as number|undefined},emit:(event:string,payload:ReturnType<typeof publicRoom>)=>events.push([event,payload])};
 const data={maintenance:{blocked:false},room:publicRoom(r,alice)};
 emitRoomState(socket,data,true);assert.equal(events.length,1);assert.equal(events[0][0],"room:state");assert.deepEqual(events[0][1].holdings,[]);
 emitRoomState(socket,data);assert.equal(events.length,1);
 emitRoomState(socket,{...data,room:publicRoom(r,bob)},true);assert.equal(events.length,2);assert.equal(events[1][1].holdings[0].units,42);
 emitRoomState(socket,{...data,maintenance:{blocked:true}},true);assert.equal(events.length,2);assert.equal(socket.data.version,undefined);
 emitRoomState(socket,data);assert.equal(events.length,3);
});

import {readFileSync} from "node:fs";
test("authenticated allowed socket snapshots use throttled visit presence, never blocked snapshots",()=>{
 const route=readFileSync(new URL("../app/api/internal-live/route.ts",import.meta.url),"utf8");
 assert.match(route,/maintenance\.blocked\?null:await visit\(who\)/);
 assert.ok(route.indexOf("if(!internalLiveAuthorized(request))")<route.indexOf("await visit(who)"));
 const store=readFileSync(new URL("../lib/store.ts",import.meta.url),"utf8");
 const visit=store.slice(store.indexOf("export async function visit("),store.indexOf("export async function move("));
 assert.match(visit,/Date\.now\(\)-s\.seen < 15_000/);
 assert.match(visit,/r\.seats\[i\]!\.seen=Date\.now\(\)/);
 assert.match(visit,/register\(r,who\)/);
});
