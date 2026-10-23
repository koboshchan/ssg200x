import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {freshRoom,register,assertRoom} from "./helpers/crypto-room";
import {openPosition,closePosition} from "../lib/finance";
import {closeAllPerps} from "../lib/perps-close-all";
import {publicRoom} from "../lib/public";
import {financeSchema} from "../lib/finance-input";
import {checkFinanceRequest,recordFinanceRequest} from "../lib/finance-requests";
const who={id:"a",name:"A",email:"a@example.test",admin:true},other={...who,id:"b"};
function setup(){
 const r=freshRoom();register(r,who);register(r,other);
 r.quotes={BTC:{cryptoGeneration:"fixture",micro:100_000_000_000,at:1000},ETH:{cryptoGeneration:"fixture",micro:3_000_000_000,at:1000}};
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
test("profiting/losing classification uses fee-aware current server mark, not raw gains",()=>{
 for(const mode of ["profiting","losing"] as const){
  const {r,ids}=setup();
  // Tiny BTC gain is less than its locked opening + closing fees.
  r.quotes!.BTC!.micro+=10_000_000;
  r.quotes!.ETH!.micro=3_100_000_000;
  const out=closeAllPerps(r,who,ids,"fees",1000,mode);
  assert.deepEqual(out.closed,mode==="losing"?ids:[]);
  assert.deepEqual(out.skipped,mode==="profiting"?ids:[]);
  assertRoom(r);
 }
});
test("both strict sign modes exclude exact zero; all includes zero",()=>{
 for(const mode of ["all","profiting","losing"] as const){
  const {r,ids}=setup();for(const p of r.members[0].positions!){
   p.openingFee=0;p.openingFeePpm=0;p.closingFeePpm=0;p.feePpm=0;p.postedMargin=p.margin;p.collateral=p.margin;
  }
  const result=closeAllPerps(r,who,ids,"zero",1000,mode);
  assert.deepEqual(result.closed,mode==="all"?ids:[]);
  assert.deepEqual(result.skipped,mode==="all"?[]:ids);assertRoom(r);
 }
});
test("profiting uses current net P/L with profit-based closing fee and locked position rates",()=>{
 const {r,ids}=setup();
 for(const p of r.members[0].positions!){p.closingFeeMode="profit";p.closingFeePpm=500000;}
 r.quotes!.BTC!.micro=101_000_000_000;r.quotes!.ETH!.micro=3_100_000_000;
 const visible=publicRoom(r,who).positions;
 assert.ok(visible.find(p=>p.id===ids[0])!.pnl>0);assert.ok(visible.find(p=>p.id===ids[1])!.pnl<0);
 r.perpClosingFeePpm=0; // Changing room fees cannot change an existing position's contract.
 const out=closeAllPerps(r,who,ids,"profit",1000,"profiting");
 assert.deepEqual(out.closed,[ids[0]]);assert.deepEqual(out.skipped,[ids[1]]);
 assert.ok(r.members[0].closedPositions![0].closingFee!>0);assertRoom(r);
});
test("filtered stale quotes fail before sign classification and snapshot omits new positions",()=>{
 const {r,ids}=setup();r.quotes!.BTC!.micro=110_000_000_000;r.quotes!.ETH!.at=-20000;
 const later=randomUUID();openPosition(r,who,"BTC","long",1000,5,later,1000);
 const out=closeAllPerps(r,who,ids,"snapshot",1000,"profiting");
 assert.deepEqual(out.closed,[ids[0]]);assert.equal(out.failed[0].id,ids[1]);assert.deepEqual(out.skipped,[]);
 assert.ok(r.members[0].positions!.some(p=>p.id===later));assertRoom(r);
});
test("mode is validated and bound to finance request replay",()=>{
 const {r,ids}=setup();const base={type:"close-all",requestId:randomUUID(),requestAt:1000,positionIds:ids,mode:"losing"};
 assert.ok(financeSchema.safeParse(base).success);assert.equal(financeSchema.safeParse({...base,mode:"positive"}).success,false);
 recordFinanceRequest(r,who.id,base,"committed",1000);
 assert.equal(checkFinanceRequest(r,who.id,base,1000),true);
 assert.throws(()=>checkFinanceRequest(r,who.id,{...base,mode:"all"},1000));
 assert.throws(()=>closeAllPerps(r,who,ids,"bad",1000,"bad" as any));
});
