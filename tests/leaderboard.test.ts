import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {freshRoom,register} from "../lib/poker";
import {publicRoom} from "../lib/public";
import {blackjackTablesAction} from "../lib/blackjack";
import {rouletteState,rouletteAction} from "../lib/roulette";
import {leaderboardSnapshot,cachedLeaderboard,displayName} from "../lib/leaderboard";
const alice={id:"secret-user-alice",name:"Alice Brown",email:"alice@private.test",admin:true};
const bob={id:"secret-user-bob",name:"Bob",email:"bob@private.test",admin:false};
function room(){const r=freshRoom();register(r,alice);register(r,bob);return r;}
test("net worth matches signed-in standings across poker phases, marks and game escrow without writes",()=>{
 for(const street of ["waiting","flop","showdown"] as const){
  const r=room();r.street=street;r.siteMaintenance=true;
  r.seats[0]={userId:alice.id,stack:1000,committed:300,bet:100,hole:["As","Ah"],folded:false,inHand:true,actedAt:null,sitOut:false,leaveAfter:false,seen:0};
  r.quotes={BTC:{micro:200_000_000,at:0}};
  r.members[0].holdings=[{symbol:"BTC",units:100_000_000,cost:10000},{symbol:"ETH",units:1,cost:123}];
  r.members[0].positions=[{id:"secret-position",symbol:"BTC",side:"long",margin:1000,leverage:2,entry:100_000_000,opened:0}];
  blackjackTablesAction(r,alice,{tableId:"lounge",type:"join",seat:0},0);
  blackjackTablesAction(r,alice,{tableId:"lounge",type:"bet",amount:100},0);
  rouletteState(r,1000);rouletteAction(r,alice,{type:"bet",bet:{kind:"red",amount:200}},1,"secret-bet",1000);
  const before=structuredClone(r),snapshot=leaderboardSnapshot(r,123);
  assert.deepEqual(r,before);
  const expected=publicRoom(structuredClone(r),alice).leaderboard;
  assert.deepEqual(snapshot.rows.map(({name,netWorth})=>({name,netWorth})),expected.map(({name,netWorth})=>({name,netWorth})));
  assert.equal(snapshot.updatedAt,123);
  for(const row of snapshot.rows)assert.deepEqual(Object.keys(row).sort(),["advancements","avatar","name","netWorth","publicId","rank"]);
  const json=JSON.stringify(snapshot);
  for(const secret of [alice.id,bob.id,alice.email,bob.email,"secret-position","secret-bet","As","privateMetadata","wallet","holdings"])assert.equal(json.includes(secret),false,secret);
 }
});
test("empty snapshot, ranked descending and deterministic name tie break, safe names and avatars",()=>{
 assert.deepEqual(leaderboardSnapshot(null,10),{updatedAt:10,rows:[]});
 const r=room();r.members.reverse();
 assert.deepEqual(leaderboardSnapshot(r).rows.map(x=>[x.rank,x.name,x.avatar]),[[1,"Alice Brown","AB"],[2,"Bob","B"]]);
 r.members[0].wallet+=1;assert.equal(leaderboardSnapshot(r).rows[0].name,"Bob");
 for(const name of ["","  ","alice@example.test","user_secret123"])assert.equal(displayName(name),"Player");
 assert.equal(displayName("  Alice\u0000 Brown "),"Alice Brown");
 assert.equal(displayName("a".repeat(100)).length,80);
});
test("cache coalesces anonymous loads, expires after 15 seconds and never mutates the source",async()=>{
 let now=0,calls=0;const r=room(),before=structuredClone(r);
 const get=cachedLeaderboard(async()=>{calls++;return r;},()=>now);
 const results=await Promise.all(Array.from({length:100},()=>get()));
 assert.equal(calls,1);assert.ok(results.every(x=>x===results[0]));
 r.members[0].wallet=1;now=14999;assert.equal((await get()).rows[0].netWorth,100000);
 now=15000;await get();assert.equal(calls,2);
 r.members[0].wallet=before.members[0].wallet;assert.deepEqual(r,before);
});
test("failed cache loads are retriable and never expose rejected error objects",async()=>{
 let calls=0;const get=cachedLeaderboard(async()=>{if(++calls===1)throw Error("private database credentials");return null;});
 await assert.rejects(get());assert.deepEqual((await get()).rows,[]);assert.equal(calls,2);
});
test("public page reads the Clerk session without gating, stays outside maintenance, with narrow rendering and no public mutation API",()=>{
 const read=(p:string)=>readFileSync(p,"utf8"),proxy=read("proxy.ts"),page=read("app/leaderboard/page.tsx"),store=read("lib/leaderboard-store.ts"),client=read("app/room-client.tsx");
 // Session must reach the page, so no early exact bypass; clerkMiddleware only protects /api/*.
 assert.doesNotMatch(proxy,/pathname\s*===\s*"\/leaderboard"/);
 assert.match(proxy,/startsWith\("\/api\/"\)/);
 assert.match(proxy,/return clerk\(request, event\)/);
 assert.doesNotMatch(page,/LiveProvider|MaintenanceGate|useUser|dangerouslySetInnerHTML/);
 assert.doesNotMatch(page,/RoomClient|currentUser|privateMetadata/);
 assert.match(read("app/layout.tsx"),/<RoomClient configured=\{configured\(\)\}>/);
 assert.match(client,/isPublicPage\(path\)/);
 assert.doesNotMatch(page,/\.email|privateMetadata\.(?!admin)/);
 assert.match(store,/findOne\(\{_id:"main"\}/);assert.match(store,/currentNamedRoom/);
 assert.doesNotMatch(store,/cachedLeaderboard/);
 assert.doesNotMatch(store,/await (readRoom|visit|mutate)|updateOne|insertOne/);
 assert.match(page,/snapshot\.rows\.map/);assert.match(page,/role="status"/);assert.match(page,/No players yet/);
 assert.match(client,/href:"\/leaderboard",label:"Leaderboard"/);
 assert.match(client,/View the public leaderboard/);
 assert.match(read("app/privacy/page.tsx"),/Public leaderboard/);
});
