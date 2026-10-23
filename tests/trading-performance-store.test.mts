import test,{mock} from "node:test";
import assert from "node:assert/strict";
import {freshRoom,register} from "../lib/poker";
const room=freshRoom();register(room,{id:"secret",name:"Visible",email:"private@test",admin:false});
let authenticated=true,sessionValid=true;
mock.module("@clerk/nextjs/server",{namedExports:{auth:async()=>authenticated?{userId:"viewer-not-target",sessionId:"active-session"}:{userId:null,sessionId:null}}});
mock.module("../lib/clerk-reads.ts",{namedExports:{currentClerkSession:async()=>{if(!sessionValid)throw Error("session");}}});
let roomReads=0,finds=0,writes=0,indices:any[]=[],samples:any[]=[],gate=true;
const collection={
 createIndex:async(...args:any[])=>{indices.push(args);},
 bulkWrite:async(ops:any[])=>{writes++;for(const op of ops){const s=op.updateOne.update.$setOnInsert;if(!samples.some(x=>x.publicId===s.publicId&&x.bucket===s.bucket))samples.push(s);}},
 find:(query:any)=>{finds++;return {sort:()=>({limit:()=>({toArray:async()=>samples.filter(s=>s.publicId===query.publicId&&s.at>=query.at.$gte&&s.at<=query.at.$lte)})})};}
};
mock.module("../lib/db.ts",{namedExports:{
 db:async()=>({collection:(name:string)=>{assert.equal(name,"tradingPerformanceSnapshots");return collection;}}),
 rooms:async()=>({findOne:async(_query:any,options:any)=>{roomReads++;const projected=Object.fromEntries(Object.keys(options.projection).filter(key=>options.projection[key]===1&&key in room).map(key=>[key,room[key as keyof typeof room]]));return structuredClone(projected);}})
}});
mock.module("../lib/feature-flags.ts",{namedExports:{requireFeature:async(key:string)=>{assert.equal(key,"leaderboard");if(!gate){const e=new Error("disabled");throw e;}}}});
const store=await import("../lib/trading-performance-store.ts");
const route=await import("../app/api/leaderboard/[publicId]/performance/route.ts");
test("raw snapshot capture immutable minute buckets and unique/TTL32day indexes; no finance mutations",async()=>{
 const before=structuredClone(room),at=40*86400_000;
 await store.captureTradingPerformance(at);await store.captureTradingPerformance(at+1);
 assert.equal(samples.length,1);assert.equal(writes,2);
 assert.ok(indices.some(([keys,opts])=>keys.publicId===1&&keys.bucket===1&&opts.unique));
 assert.ok(indices.some(([keys,opts])=>keys.expiresAt===1&&opts.expireAfterSeconds===0));
 assert.equal(samples[0].expiresAt.getTime()-at,32*86400_000);
 assert.deepEqual(room,before);assert.equal(roomReads,2);
});
test("authenticated public-target read does not write or create indexes, unknown/hidden identical404, feature enforced",async()=>{
 const publicId=room.members[0].publicId,w=writes,i=indices.length;
 const invoke=(id:string)=>route.GET(new Request("http://localhost/api/leaderboard/"+id+"/performance"),{params:Promise.resolve({publicId:id})});
 let response=await invoke(publicId);assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"no-store");
 const body=await response.json();assert.equal(body.periods.length,4);
 assert.ok(body.periods.every((p:any)=>p.pnl===null));assert.ok(!JSON.stringify(body).includes("secret"));
 const missing=await invoke("0000000000000000");
 room.members[0].settings={triggerInputMode:"price",hideFromLeaderboard:true};
 const hidden=await invoke(publicId);
 assert.equal(missing.status,404);assert.equal(hidden.status,404);assert.deepEqual(await missing.json(),await hidden.json());
 const prev=finds;await invoke("../bad");assert.equal(finds,prev);
 gate=false;response=await invoke(publicId);assert.equal(response.status,503);
 assert.equal(writes,w);assert.equal(indices.length,i);
});

test("capture and read retain projected crypto health, and missing real history stays unavailable",async()=>{
 const at=40*86400_000+60_000,member=room.members[0];
 member.settings={triggerInputMode:"price",hideFromLeaderboard:false};
 member.holdings=[{symbol:"BTC",units:10_000_000,cost:1000}];
 room.quotes={BTC:{micro:100_000_000,at,cryptoGeneration:"projection-test"}};
 room.cryptoStatus={connected:true,heartbeatSubscribed:true,generation:"projection-test",lastMessage:at,leaseUntil:at+10000};
 const before=structuredClone(room);
 await store.captureTradingPerformance(at);
 const captured=samples.find(s=>s.at===at);
 assert.equal(captured.pnl,0);assert.equal(captured.capital,1000);
 const result=await store.getTradingPerformance(member.publicId,at);
 assert.ok(result.periods.every(p=>p.pnl===null&&p.reason==="baseline_unavailable"));
 assert.deepEqual(room,before);
 room.cryptoStatus.connected=false;
 const unavailable=await store.getTradingPerformance(member.publicId,at);
 assert.ok(unavailable.periods.every(p=>p.pnl===null&&p.reason==="valuation_unavailable"));
});

test("performance authentication rejects anonymous and revoked sessions before room/history access",async()=>{
 const previousReads=roomReads,previousFinds=finds;
 const invoke=()=>route.GET(new Request("http://localhost/api/leaderboard/"+room.members[0].publicId+"/performance"),{params:Promise.resolve({publicId:room.members[0].publicId})});
 gate=true;authenticated=false;
 let response=await invoke();assert.equal(response.status,401);assert.equal(response.headers.get("cache-control"),"no-store");
 authenticated=true;sessionValid=false;response=await invoke();assert.equal(response.status,401);
 assert.equal(roomReads,previousReads);assert.equal(finds,previousFinds);sessionValid=true;
});
test("authenticated non-owner may read visible public performance, never hidden users or private fields",async()=>{
 const member=room.members[0],at=40*86400_000;
 member.holdings=[];member.positions=[];member.closedPositions=[];member.realizedSpotPnl=100;
 member.settings={triggerInputMode:"price",hideFromLeaderboard:false};
 samples=Array.from({length:61},(_,i)=>({publicId:member.publicId,at:at-3600_000+i*60_000,bucket:0,expiresAt:new Date(at+86400_000),pnl:0,capital:1000}));
 const result=await store.getTradingPerformance(member.publicId,at);
 assert.deepEqual(result.periods[0],{period:"1h",pnl:100,percent:10});
 assert.ok(result.periods.slice(1).every(p=>p.pnl===null&&p.reason==="baseline_unavailable"));
 for(const value of ["secret","private@test","wallet","holdings","positions","viewer-not-target"])assert.ok(!JSON.stringify(result).includes(value));
 assert.deepEqual(Object.keys(result).sort(),["asOf","periods"]);
});
