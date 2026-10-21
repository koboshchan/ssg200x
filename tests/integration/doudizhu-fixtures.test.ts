import {test,after} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {seedVideoFixture,scenarios,requireFixtureDatabase} from "../doudizhu-video-fixture";
import {doudizhuMove} from "../../lib/doudizhu-store";
import {readRoom,db,closeDatabase} from "../../lib/db";
import {assertRoom} from "../../lib/poker";
if(!/^fakebucks_test_[a-zA-Z0-9_]+$/.test(process.env.MONGODB_DB??""))throw Error("Isolated test DB required");
process.env.MONGODB_DB+="_video_fixtures";
after(async()=>{await(await db()).dropDatabase();await closeDatabase();});
test("fixtures reject production databases and non-loopback Mongo",()=>{
 const database=process.env.MONGODB_DB,uri=process.env.MONGODB_URI;
 try{
 process.env.MONGODB_DB="production";assert.throws(requireFixtureDatabase,/isolated/);
 process.env.MONGODB_DB=database;process.env.MONGODB_URI="mongodb://production.invalid:27017";assert.throws(requireFixtureDatabase,/loopback/);
 }finally{process.env.MONGODB_DB=database;process.env.MONGODB_URI=uri;}
});
test("all five isolated video scenarios drive real card rules and conserved Mongo settlement",async()=>{
 for(const scenario of ["bomb","rocket","airplane","spring","settlement"] as (keyof typeof scenarios)[]){
  const fixture=await seedVideoFixture(scenario);
  const view=await doudizhuMove({id:"demo-dd-0",name:"You",email:"demo0@invalid.test",admin:true},{type:"play",cards:fixture.play,version:fixture.view.room!.version,requestId:randomUUID(),requestAt:Date.now()});
  const g=view.room!;
  if(scenario==="spring"||scenario==="settlement"){assert(g.settled);assert.equal(g.result!.spring,scenario==="spring");}
  else{assert.equal(g.trick!.combo.kind,scenario==="airplane"?"airplane-single":scenario);assert.equal(g.multiplier,scenario==="airplane"?1:2);}
  assertRoom(await readRoom());
 }
});

test("deal, landlord reveal and losing-seat fixtures transition through genuine engine moves",async()=>{
 for(const scenario of ["deal","reveal","loss"] as const){
 const fixture=await seedVideoFixture(scenario),next=fixture.nextAction;
 const who={id:"demo-dd-"+next.seat,name:"Demo",email:"demo@invalid.test",admin:next.seat===0};
 const r=await readRoom();
 const input={...next,version:r.doudizhu![0].version,requestId:randomUUID(),requestAt:Date.now()};
 const view=await doudizhuMove(who,input as import("../../lib/doudizhu").DoudizhuInput);
 if(scenario==="deal")assert.equal(view.room!.phase,"bidding");
 if(scenario==="reveal"){assert.equal(view.room!.landlord,0);assert.equal(view.room!.players[0].count,20);}
 if(scenario==="loss"){assert(view.room!.settled);assert(view.room!.result!.deltas[0]<0);}
 assertRoom(await readRoom());
 }
});
