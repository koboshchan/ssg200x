import {test,after} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {db,readRoom,closeDatabase} from "../../lib/db";
import {mutate} from "../../lib/store";
import {doudizhuMove,doudizhuRead} from "../../lib/doudizhu-store";
import type {DoudizhuInput} from "../../lib/doudizhu";
import {assertRoom,totalChips} from "../../lib/poker";
if(!/^fakebucks_test_/.test(process.env.MONGODB_DB??""))throw Error("Isolated test DB required");
process.env.MONGODB_DB+="_doubling_reactions";
after(async()=>{await(await db()).dropDatabase();await closeDatabase();});
const users=Array.from({length:3},(_,i)=>({id:"cas-double-"+i,name:"Player "+i,email:"qa@invalid.test",admin:false}));
const input=(p:Partial<DoudizhuInput>)=>({type:"ready",requestId:randomUUID(),requestAt:Date.now(),...p}) as DoudizhuInput;
test("Mongo double choices persist and simultaneous duplicate paid throws have one debit and event",async()=>{
 let v=await doudizhuMove(users[0],input({type:"create"}));const code=v.room!.code;
 for(const u of users.slice(1))await doudizhuMove(u,input({type:"join",code}));
 for(const u of users){v=await doudizhuRead(u);await doudizhuMove(u,input({type:"ready",version:v.room!.version}));}
 v=await doudizhuRead(users[0]);await doudizhuMove(users[0],input({type:"bid",bid:3,version:v.room!.version}));
 const first=input({type:"double",doubleMultiplier:4,version:(await doudizhuRead(users[0])).room!.version});
 await Promise.all(Array.from({length:6},()=>doudizhuMove(users[0],first)));
 let funded=await readRoom();assert.deepEqual(funded.doudizhu![0].players.map(p=>p.escrow),[40000,40000,40000]);
 const version=funded.doudizhu![0].version;
 const competing=[1,2].map(i=>input({type:"double",doubleMultiplier:i===1?2:1,version}));
 const results=await Promise.allSettled([1,2].map((i,n)=>doudizhuMove(users[i],competing[n])));
 assert.equal(results.filter(x=>x.status==="fulfilled").length,1);
 for(const [n,result] of results.entries())if(result.status==="rejected"){
  assert.match(result.reason.message,/changed/);const i=n+1;
  v=await doudizhuRead(users[i]);await doudizhuMove(users[i],input({type:"double",doubleMultiplier:i===1?2:1,version:v.room!.version}));
 }
 await closeDatabase();let r=await readRoom();assert.equal(r.doudizhu![0].phase,"playing");assert.deepEqual(r.doudizhu![0].players.map(p=>p.escrow),[80000,80000,40000]);assert.deepEqual(r.doudizhu![0].players.map(p=>p.doubleMultiplier),[4,2,1]);
 const targetId=r.members.find(m=>m.id===users[1].id)!.publicId;
 const req=input({type:"reaction",code,kind:"throw",value:"egg",target:1,targetId,expectedPrice:5000});
 const wallet=r.members.find(m=>m.id===users[0].id)!.wallet;
 await Promise.all(Array.from({length:6},()=>doudizhuMove(users[0],req)));
 await closeDatabase();r=await readRoom();
 assert.equal(r.members.find(m=>m.id===users[0].id)!.wallet,wallet-5000);assert.equal(r.house,5000);
 assert.equal(r.doudizhu![0].reactions!.filter(e=>e.id===req.requestId).length,1);
 assert.equal(await(await db()).collection("audit").countDocuments({what:"doudizhu.throw"}),1);
 assertRoom(r);assert.equal(totalChips(r),300000);
 await mutate(room=>{room.casinoLimits={rouletteMaxTotal:100000,blackjackMaxHand:100000,pokerMaxBuyIn:100000,pokerEggPrice:1000,pokerTomatoPrice:2000,gamesMaxBet:100000,revision:1};});
 await assert.rejects(()=>doudizhuMove(users[1],input({type:"reaction",code,kind:"throw",value:"egg",target:0,targetId:r.members[0].publicId,expectedPrice:5000})),/Price changed/);
 assertRoom(await readRoom());
});
