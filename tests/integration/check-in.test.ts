import {test,before,after} from "node:test";
import assert from "node:assert/strict";
import {db,readRoom,closeDatabase} from "../../lib/db";
import {mutate} from "../../lib/store";
import {register,assertRoom} from "../../lib/poker";
import {claimCheckIn,markCheckInBanner} from "../../lib/check-in";
if(!process.env.MONGODB_DB?.startsWith("fakebucks_test_"))throw Error("Refusing non-test database");
process.env.MONGODB_DB+="_checkin";
const now=Date.parse("2026-10-20T20:00:00Z");
before(async()=>{await(await db()).dropDatabase();await mutate(r=>register(r,{id:"a",name:"A",email:"a@test.invalid",admin:false}));});
after(async()=>{await(await db()).dropDatabase();await closeDatabase();});
test("concurrent daily claims and banners persist exactly once with one durable audit",async()=>{
 const banners=await Promise.all(Array.from({length:8},()=>mutate(r=>markCheckInBanner(r.members[0],now))));
 assert.equal(banners.filter(b=>b.result).length,1);
 await Promise.all(Array.from({length:8},()=>mutate(r=>claimCheckIn(r,r.members[0],now))));
 await closeDatabase();let r=await readRoom();assert.equal(r.members[0].wallet,105000);assert.equal(r.members[0].checkIn!.streak,1);assert.equal(await(await db()).collection("audit").countDocuments({what:"daily-check-in"}),1);assertRoom(r);
 await Promise.all(Array.from({length:8},()=>mutate(r=>claimCheckIn(r,r.members[0],now+86400000))));
 r=await readRoom();assert.equal(r.members[0].wallet,110000);assert.equal(r.members[0].checkIn!.streak,2);assert.equal(await(await db()).collection("audit").countDocuments({what:"daily-check-in"}),2);assertRoom(r);
});
