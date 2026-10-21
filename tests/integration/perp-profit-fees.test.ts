import {test,after} from "node:test";
import assert from "node:assert/strict";
import {db,readRoom,closeDatabase} from "../../lib/db";
import {mutate} from "../../lib/store";
import {register,assertRoom} from "../../lib/poker";
import {setPerpFees} from "../../lib/admin";
import {openPosition,closePosition,pnl,netPnl} from "../../lib/finance";
import {settleTriggers} from "../../lib/position-triggers";
import {closingFeeCents} from "../../runtime/perp-fee-policy.mjs";
if(!process.env.MONGODB_DB?.startsWith("fakebucks_test_"))throw Error("Requires isolated test DB");
process.env.MONGODB_DB+="_profit_fees";
after(async()=>{await(await db()).dropDatabase();await closeDatabase();});
test("Mongo restart preserves profit contract, concurrent open and TP/manual close debit/settle exactly once",async()=>{
 const who={id:"profit",name:"Profit",email:"profit@test",admin:true},now=Date.now();
 await mutate(r=>{register(r,who);setPerpFees(r,who,0.05,1,"profit");r.quotes={BTC:{micro:100000000,at:now}};});
 await Promise.all(Array.from({length:8},()=>mutate(r=>{
 if(r.receipts.some(x=>x.id==="open-profit"))return;
 openPosition(r,who,"BTC","long",10000,5,"profit",now,{takeProfit:110000000});r.receipts.push({id:"open-profit",userId:who.id,at:now});
 })));
 await closeDatabase();let r=await readRoom();const p=r.members[0].positions![0];
 assert.equal(r.members[0].wallet,90000);assert.equal(r.members[0].positions!.length,1);assert.equal(p.closingFeeMode,"profit");assert.equal(p.closingFeePpm,10000);assert.equal(p.openingFee,25);assertRoom(r);
 const mark=110000000,expectedFee=closingFeeCents(p,mark,pnl(p,mark)),expected=netPnl(p,mark);
 await mutate(r=>{setPerpFees(r,who,0.1,0.1,"notional");r.quotes!.BTC={micro:mark,at:now+1};});
 await Promise.all(Array.from({length:8},(_,i)=>mutate(r=>{
 if(i%2===0){if(r.members[0].positions?.some(p=>p.id==="profit"))closePosition(r,who,"profit",now+1);}else settleTriggers(r,now+1);
 })));
 await closeDatabase();r=await readRoom();const c=r.members[0].closedPositions![0];assert.equal(r.members[0].closedPositions!.length,1);assert.equal(c.closingFeeMode,"profit");assert.equal(c.closingFeePpm,10000);assert.equal(c.closingFee,expectedFee);assert.equal(c.realizedPnl,expected);assert.equal(r.members[0].wallet,100000+expected);assertRoom(r);
});
