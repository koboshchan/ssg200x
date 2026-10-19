import {test,after} from "node:test";
import assert from "node:assert/strict";
import {db,closeDatabase,readRoom} from "../../lib/db";
import {mutate} from "../../lib/store";
import {register} from "../../lib/poker";
import {openPosition} from "../../lib/finance";
import {refreshPrices} from "../../lib/prices";
if(!process.env.MONGODB_DB?.startsWith("fakebucks_test_"))throw new Error("Requires isolated test DB");
process.env.MONGODB_DB+="_price_worker";
after(async()=>{await(await db()).dropDatabase();await closeDatabase();});
test("background refresh resumes persisted positions without sockets and retains 200ms active lease",async()=>{
 const who={id:"background",name:"Background",email:"background@test",admin:false},now=Date.now();
 await mutate(r=>{register(r,who);r.quotes={BTC:{micro:100_000_000_000,at:now}};openPosition(r,who,"BTC","long",1000,200,"background",now,{takeProfit:100_100_000_000});});
 await closeDatabase();
 const original=globalThis.fetch;let calls=0;
 // Controlled isolated QA only. This process never reads or writes the running app DB.
 globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({data:{currency:"USD",rates:{BTC:String(1/(calls===1?100050:100200))}}}),{status:200,headers:{"Content-Type":"application/json"}});};
 try{
  const before=Date.now();await refreshPrices();const after=Date.now();
  let room=await readRoom();assert.equal(calls,1);assert.equal(room.members[0].positions!.length,1);assert.equal(room.quotes!.BTC!.micro,100_050_000_000);
  const lease=await(await db()).collection("workers").findOne({_id:"coinbase"} as never);
  assert.ok(lease!.nextAt>=before+200&&lease!.nextAt<=after+200);
  await closeDatabase();
  // Restart connection and expire only the isolated QA lease, not production wall clock.
  await(await db()).collection("workers").updateOne({_id:"coinbase"} as never,{$set:{nextAt:0}});
  await refreshPrices();room=await readRoom();assert.equal(calls,2);assert.equal(room.members[0].positions!.length,0);assert.equal(room.members[0].wallet,100400);assert.match(room.members[0].activity![0],/^Take-profit/);
  await refreshPrices();assert.equal(calls,2);assert.equal((await readRoom()).members[0].activity!.length,1);
 }finally{globalThis.fetch=original;}
});
