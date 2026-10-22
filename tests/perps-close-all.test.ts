import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {freshRoom,register,assertRoom} from "../lib/poker";
import {openPosition,closePosition} from "../lib/finance";
import {closeAllPerps} from "../lib/perps-close-all";
import {financeSchema} from "../lib/finance-input";
import {checkFinanceRequest,recordFinanceRequest} from "../lib/finance-requests";
const who={id:"a",name:"A",email:"a@example.test",admin:true},other={...who,id:"b"};
function setup(){
 const r=freshRoom();register(r,who);register(r,other);
 r.quotes={BTC:{micro:100_000_000_000,at:1000},ETH:{micro:3_000_000_000,at:1000}};
 const ids=[randomUUID(),randomUUID()];
 openPosition(r,who,"BTC","long",10000,5,ids[0],1000);
 openPosition(r,who,"ETH","short",10000,5,ids[1],1000);
 return {r,ids};
}
test("all closes match individual settlement, fees, history and invariant",()=>{
 const {r,ids}=setup(),expected=structuredClone(r);
 for(const id of ids)closePosition(expected,who,id,1000);
 const result=closeAllPerps(r,who,ids,"request",1000);
 assert.deepEqual(result.closed,ids);assert.equal(result.failed.length,0);
 assert.equal(r.members[0].wallet,expected.members[0].wallet);
 assert.deepEqual(r.members[0].closedPositions,expected.members[0].closedPositions);
 assert.ok(r.members[0].closedPositions!.every(p=>p.closingFee!>0));
 assertRoom(r);
});
test("stale price failure does not prevent another close or alter failed position",()=>{
 const {r,ids}=setup();r.quotes!.ETH!.at=-20000;
 const old=structuredClone(r.members[0].positions![1]);
 const result=closeAllPerps(r,who,ids,"partial",1000);
 assert.deepEqual(result.closed,[ids[0]]);assert.equal(result.failed[0].id,ids[1]);
 assert.deepEqual(r.members[0].positions,[old]);assertRoom(r);
 r.quotes!.ETH!.at=1000;const retry=closeAllPerps(r,who,ids,"retry",1000);
 assert.deepEqual(retry.alreadyClosed,[ids[0]]);assert.deepEqual(retry.closed,[ids[1]]);
 assert.equal(r.members[0].closedPositions!.length,2);assertRoom(r);
});
test("foreign, duplicate and missing IDs cannot double-credit; snapshot excludes new opens",()=>{
 const {r,ids}=setup(),foreign=randomUUID(),newId=randomUUID();
 openPosition(r,other,"BTC","long",1000,5,foreign,1000);
 openPosition(r,who,"BTC","long",1000,5,newId,1000);
 const result=closeAllPerps(r,who,[ids[0],ids[0],foreign,randomUUID()],"owner",1000);
 assert.deepEqual(result.closed,[ids[0]]);assert.equal(result.failed.length,2);
 assert.ok(r.members[0].positions!.some(p=>p.id===newId));assert.equal(r.members[1].positions!.length,1);
 const cash=r.members[0].wallet;closeAllPerps(r,who,[ids[0]],"repeat",1000);assert.equal(r.members[0].wallet,cash);assertRoom(r);
});
test("request receipt makes full/partial replay a no-op and rejects changed payload",()=>{
 const {r,ids}=setup(),input={type:"close-all",positionIds:ids,requestId:randomUUID(),requestAt:1000};
 assert.equal(checkFinanceRequest(r,who.id,input,1000),false);
 closeAllPerps(r,who,ids,input.requestId,1000);recordFinanceRequest(r,who.id,input,"committed",1000);
 assert.equal(checkFinanceRequest(r,who.id,input,1000),true);
 assert.throws(()=>checkFinanceRequest(r,who.id,{...input,positionIds:[ids[0]]},1000));assertRoom(r);
});
test("strict bounded UUID snapshot input",()=>{
 const input={type:"close-all",requestId:randomUUID(),requestAt:1000,positionIds:[randomUUID()]};
 assert.ok(financeSchema.safeParse(input).success);
 for(const positionIds of [[],["bad"],Array(1001).fill(randomUUID()),[input.positionIds[0],input.positionIds[0]]])assert.equal(financeSchema.safeParse({...input,positionIds}).success,false);
 assert.equal(financeSchema.safeParse({...input,userId:"b"}).success,false);
});
