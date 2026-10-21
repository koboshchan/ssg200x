import {test} from "node:test";
import assert from "node:assert/strict";
import {freshRoom,register,assertRoom} from "../lib/poker";
import {casinoLimits,CASINO_LIMIT_MAX_CENTS} from "../lib/casino-limits";
import {adminCasinoSnapshot,changeCasinoLimits} from "../lib/admin-casino-limits";
import {rouletteAction,rouletteState,rouletteTick,rouletteAssets} from "../lib/roulette";
import {blackjackTablesAction as act,blackjackTablesPublic,blackjackTablesTick} from "../lib/blackjack";
const admin={id:"a",name:"Admin",email:"a@test",admin:true},user={id:"u",name:"User",email:"u@test",admin:false};
function setup(){const r=freshRoom();register(r,admin,0);register(r,user,0);return r;}
function limits(r:ReturnType<typeof freshRoom>,rouletteMaxTotal=10000,blackjackMaxHand=10000){changeCasinoLimits(r,admin,{rouletteMaxTotal,blackjackMaxHand,expectedVersion:casinoLimits(r).revision});}
test("existing rooms retain $1,000 defaults; admin access is required; persisted revision guards stale edits",()=>{
 const r=setup();assert.deepEqual(casinoLimits(r),{rouletteMaxTotal:100000,blackjackMaxHand:100000,pokerMaxBuyIn:100000,gamesMaxBet:100000,revision:0});
 assert.throws(()=>adminCasinoSnapshot(r,user),/Administrator/);
 assert.throws(()=>changeCasinoLimits(r,user,{rouletteMaxTotal:100,blackjackMaxHand:100,expectedVersion:0}),/Administrator/);
 limits(r);assert.deepEqual(casinoLimits(structuredClone(r)),{rouletteMaxTotal:10000,blackjackMaxHand:10000,pokerMaxBuyIn:100000,gamesMaxBet:100000,revision:1});
 assert.equal(r.auditPending!.at(-1)!.what,"casino-limits");
 assert.throws(()=>changeCasinoLimits(r,admin,{rouletteMaxTotal:100,blackjackMaxHand:100,expectedVersion:0}),/changed/);
});
test("limits reject fractional cents, fractional dollars, zero, negatives, unsafe and excessive amounts",()=>{
 for(const amount of [0,-100,100.5,101,NaN,Infinity,"100",CASINO_LIMIT_MAX_CENTS+100,Number.MAX_SAFE_INTEGER]){
  const r=setup(),before=structuredClone(r);
  assert.throws(()=>changeCasinoLimits(r,admin,{rouletteMaxTotal:amount as number,blackjackMaxHand:100,expectedVersion:0}),/whole dollars/);
  assert.deepEqual(r,before);
  assert.throws(()=>changeCasinoLimits(r,admin,{rouletteMaxTotal:100,blackjackMaxHand:amount as number,expectedVersion:0}),/whole dollars/);
 }
});
test("roulette aggregate cap governs placements, changes and repeat; lower limits preserve escrow and cancellation",()=>{
 const r=setup();limits(r,600);rouletteState(r,0);
 rouletteAction(r,user,{type:"bet",bet:{kind:"red",amount:500}},1,"one",0);
 assert.throws(()=>rouletteAction(r,user,{type:"bet",bet:{kind:"red",amount:500}},1,"two",0),/limit/);
 assert.throws(()=>rouletteAction(r,user,{type:"change",betId:"one",bet:{kind:"red",amount:700}},1,"two",0),/limit/);
 limits(r,100);assert.equal(rouletteAssets(r),500);
 rouletteAction(r,user,{type:"cancel",betId:"one"},1,"cancel",0);assert.equal(rouletteAssets(r),0);
 limits(r,10000);rouletteAction(r,user,{type:"bet",bet:{kind:"red",amount:500}},1,"last",0);
 rouletteTick(r,60000,()=>1);rouletteTick(r,77000,()=>1);limits(r,100);
 const before=structuredClone(r);assert.throws(()=>rouletteAction(r,user,{type:"rebet"},2,"repeat",77000),/limit/);assert.deepEqual(r,before);assertRoom(r);
});
test("raised roulette cap allows aggregate above previous maximum without changing chip rules",()=>{
 const r=setup();limits(r,200000);r.members[1].wallet+=10000;r.issuance=(r.issuance??0)+10000;rouletteState(r,0);
 for(let i=0;i<11;i++)rouletteAction(r,user,{type:"bet",bet:{kind:"red",amount:10000}},1,String(i),0);
 assert.equal(rouletteAssets(r),110000);assertRoom(r);rouletteTick(r,60000,()=>1);assertRoom(r);
});
function playing(amount:number,max:number,cards=["8s","Th","8h","7d","2c","3c"]){
 const r=setup();limits(r,100000,max);
 act(r,user,{tableId:"lounge",type:"join",seat:0},0);
 act(r,user,{tableId:"lounge",type:"bet",amount,chips:[amount]},0);
 const b=r.blackjackTables!.tables.lounge!;b.shoe=[...Array(180).fill("2s"),...cards.slice().reverse()];
 blackjackTablesTick(r,10000);return r;
}
test("blackjack initial bet enforces saved hand cap across all tables",()=>{
 const r=setup();limits(r,100000,500);
 for(const tableId of ["lounge","salon","terrace"] as const){
  act(r,user,{tableId,type:"join",seat:0},0);
  assert.throws(()=>act(r,user,{tableId,type:"bet",amount:600},0),/limit/);
  act(r,user,{tableId,type:"bet",amount:500},0);
  assert.equal(blackjackTablesPublic(r,user).tables.find(t=>t.id===tableId)!.maxBet,500);
  act(r,user,{tableId,type:"leave"},0);
 }assertRoom(r);
});
test("blackjack double stays within per-hand cap; split creates independently limited hands",()=>{
 const r=playing(500,1000);
 assert.equal(blackjackTablesPublic(r,user).tables[0].legal.split,true);
 act(r,user,{tableId:"lounge",type:"split"},10001);
 assert.equal(r.blackjackTables!.tables.lounge!.seats[0]!.hands.length,2);
 act(r,user,{tableId:"lounge",type:"double"},10002);
 assert.equal(r.blackjackTables!.tables.lounge!.seats[0]!.hands[0].bet,1000);assertRoom(r);
 const capped=playing(500,500);
 assert.equal(blackjackTablesPublic(capped,user).tables[0].legal.double,false);
 const before=structuredClone(capped);assert.throws(()=>act(capped,user,{tableId:"lounge",type:"double"},10001),/limit/);assert.deepEqual(capped,before);
});
test("lowering blackjack cap blocks added split/double exposure but keeps stand and settlement working",()=>{
 const r=playing(500,1000);limits(r,100000,100);
 const p=blackjackTablesPublic(r,user).tables[0];assert.equal(p.legal.split,false);assert.equal(p.legal.double,false);
 assert.throws(()=>act(r,user,{tableId:"lounge",type:"split"},10001),/limit/);
 act(r,user,{tableId:"lounge",type:"stand"},10002);assert.equal(r.blackjackTables!.tables.lounge!.phase,"settled");assertRoom(r);
});
