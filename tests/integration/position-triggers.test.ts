import {test,after} from "node:test";
import assert from "node:assert/strict";
import {db,closeDatabase,readRoom} from "../../lib/db";
import {mutate} from "../../lib/store";
import {register,assertRoom} from "../../lib/poker";
import {openPosition} from "../../lib/finance";
import {editPositionTriggers,settleTriggers} from "../../lib/position-triggers";
import {publicRoom} from "../../lib/public";
if(!process.env.MONGODB_DB?.startsWith("fakebucks_test_"))throw new Error("Requires isolated test DB");
process.env.MONGODB_DB+="_position_triggers";
after(async()=>{await(await db()).dropDatabase();await closeDatabase();});
test("Mongo persisted TP/SL survive connection restart, tick without clients, CAS settles once and keeps activity private",async()=>{
 const who={id:"tp",name:"TP",email:"tp@test",admin:false},other={id:"other",name:"Other",email:"other@test",admin:false},now=Date.now();
 await mutate(r=>{register(r,who);register(r,other);r.quotes={BTC:{micro:100000000,at:now}};openPosition(r,who,"BTC","long",10000,10,"long",now);editPositionTriggers(r,who,"long",{takeProfit:105000000,stopLoss:95000000});});
 await closeDatabase();
 const restarted=await readRoom();assert.equal((restarted.members[0].positions![0] as {takeProfit?:number}).takeProfit,105000000);
 await Promise.all([mutate(r=>{r.quotes={BTC:{micro:106000000,at:now+1}};settleTriggers(r,now+1);}),mutate(r=>{r.quotes={BTC:{micro:106000000,at:now+1}};settleTriggers(r,now+1);})]);
 const settled=await readRoom();assert.equal(settled.members[0].positions!.length,0);assert.equal(settled.members[0].wallet,106000);assert.equal(settled.house,-6000);assert.equal(settled.members[0].activity!.length,1);assert.match(publicRoom(settled,who).activity[0],/Take-profit/);assert.deepEqual(publicRoom(settled,other).activity,[]);assertRoom(settled);
});
