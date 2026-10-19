import {test} from "node:test";
import assert from "node:assert/strict";
import {freshRoom,register,assertRoom} from "../lib/poker";
import {spin,payout,spot,openPosition,closePosition,liquidate,pnl,liqPrice,equity,unitsFor,value} from "../lib/finance";
import type {Identity} from "../lib/types";
const who:Identity={id:"a",name:"A",email:"a@a.test",admin:true};
function setup(){const r=freshRoom();register(r,who);r.quotes={BTC:{micro:100_000_000_000,at:1000},DOGE:{micro:123456,at:1000}};return r;}
test("European wheel straight and outside returns include stake",()=>{
 assert.equal(payout({kind:"straight",pick:0,amount:100},0),3600);
 for(const kind of ["red","black","odd","even","low","high","dozen","column"] as const)assert.equal(payout({kind,pick:1,amount:100},0),0);
 assert.equal(payout({kind:"red",amount:100},1),200);assert.equal(payout({kind:"black",amount:100},2),200);
 assert.equal(payout({kind:"low",amount:100},18),200);assert.equal(payout({kind:"high",amount:100},19),200);
 for(let p=1;p<=3;p++)for(let n=1;n<=36;n++){
 assert.equal(payout({kind:"column",pick:p,amount:100},n),((n-1)%3+1===p)?300:0);
 assert.equal(payout({kind:"dozen",pick:p,amount:100},n),(Math.ceil(n/12)===p)?300:0);
 }
});
test("all valid roulette bets have 36/37 expected gross return",()=>{
 for(const kind of ["red","black","odd","even","low","high","dozen","column","straight"] as const){
 const sum=Array.from({length:37},(_,n)=>payout({kind,pick:kind==="straight"?0:1,amount:100},n)).reduce((a,b)=>a+b,0);assert.equal(sum,3600);
 }
});
test("roulette updates wallet and house atomically in ledger",()=>{const r=setup();spin(r,who,[{kind:"red",amount:500}],1,"x",1000);assert.equal(r.members[0].wallet,100500);assert.equal(r.house,-500);assertRoom(r);assert.throws(()=>spin(r,who,[{kind:"red",amount:500}],2,"y",2000));spin(r,who,[{kind:"red",amount:500}],0,"z",3000);assertRoom(r);});
test("invalid roulette picks, negative stakes and overdraft fail",()=>{
 const r=setup();assert.throws(()=>payout({kind:"straight",pick:37,amount:100},1));assert.throws(()=>payout({kind:"column",pick:0,amount:100},1));assert.throws(()=>spin(r,who,[{kind:"red",amount:-100}],1));
 r.members[0].wallet=10;assert.throws(()=>spin(r,who,[{kind:"red",amount:100}],1));
});
test("spot buy and full sell round-trip conserves integer ledger",()=>{const r=setup();spot(r,who,"BTC","buy",10_000,1000);assert.equal(r.members[0].holdings![0].units,100_000);assert.equal(r.members[0].wallet,90_000);assertRoom(r);spot(r,who,"BTC","sell",10_000,1000);assert.equal(r.members[0].holdings!.length,0);assert.equal(r.members[0].wallet,100_000);assertRoom(r);});
test("sub-cent coin price and fractional units use bigint valuation",()=>{const r=setup();spot(r,who,"DOGE","buy",1234,1000);const h=r.members[0].holdings![0];assert.equal(h.units,unitsFor(1234,123456));assert.ok(value(h.units,123456)<=1234);assertRoom(r);});
test("spot gains enter house ledger and partial cost basis remains correct",()=>{const r=setup();spot(r,who,"BTC","buy",10_000,1000);r.quotes!.BTC!.micro*=2;spot(r,who,"BTC","sell",10_000,1000);assert.equal(r.members[0].holdings![0].cost,5000);assert.equal(r.members[0].wallet,100_000);assert.equal(r.house,-5000);assertRoom(r);});
test("stale quote, insufficient cash and missing holding fail closed",()=>{const r=setup();assert.throws(()=>spot(r,who,"BTC","buy",100,20_000));assert.throws(()=>spot(r,who,"BTC","buy",100_001,1000));assert.throws(()=>spot(r,who,"BTC","sell",100,1000));assertRoom(r);});
test("long and short isolated PnL, liquidation math, leverage boundaries",()=>{const r=setup();for(const side of ["long","short"] as const){openPosition(r,who,"BTC",side,10_000,10,side,1000);const p=r.members[0].positions!.at(-1)!;assert.equal(pnl(p,p.entry*(side==="long"?1.05:.95)),5000);assert.equal(liqPrice(p),p.entry*(side==="long"?.9:1.1));assert.equal(equity(p,p.entry),10_000);}assertRoom(r);assert.throws(()=>openPosition(r,who,"BTC","long",100,201,"x",1000));});
test("liquidation loses only isolated margin, never wallet or other position",()=>{const r=setup();openPosition(r,who,"BTC","long",10_000,10,"long",1000);openPosition(r,who,"BTC","short",10_000,10,"short",1000);r.quotes!.BTC!.micro*=.89;liquidate(r,1000);assert.equal(r.members[0].positions!.length,1);assert.equal(r.members[0].positions![0].id,"short");assert.equal(r.members[0].wallet,80_000);assert.equal(r.house,10_000);assertRoom(r);});
test("close realizes PnL once and enforces owner",()=>{const r=setup();openPosition(r,who,"BTC","long",10_000,5,"position",1000);r.quotes!.BTC!.micro=Math.round(r.quotes!.BTC!.micro*1.1);const other={...who,id:"b"};register(r,other);assert.throws(()=>closePosition(r,other,"position",1000));closePosition(r,who,"position",1000);assert.equal(r.members[0].wallet,105_000);assert.throws(()=>closePosition(r,who,"position",1000));assertRoom(r);});
test("stale marks cannot trigger liquidation",()=>{const r=setup();openPosition(r,who,"BTC","long",10_000,50,"position",1000);r.quotes!.BTC!.micro/=2;liquidate(r,20_000);assert.equal(r.members[0].positions!.length,1);assertRoom(r);});
test("maintenance margin moves long and short liquidation inward",()=>{const r=setup();r.maintenance=.005;for(const side of ["long","short"] as const){openPosition(r,who,"BTC",side,1000,10,side,1000);const p=r.members[0].positions!.at(-1)!;assert.equal(liqPrice(p),p.entry*(side==="long"?.9:1.1)/(side==="long"?.995:1.005));}r.maintenance=.1;assert.throws(()=>openPosition(r,who,"BTC","long",1000,10,"bad",1000));assertRoom(r);});
test("200x hard boundary and maintenance liquidation distance remain valid",()=>{const r=setup();r.maintenance=.001;for(const side of ["long","short"] as const){openPosition(r,who,"BTC",side,1000,200,side,1000);const p=r.members[0].positions!.at(-1)!;assert.equal(side==="long"?liqPrice(p)<p.entry:liqPrice(p)>p.entry,true);assert.ok(Math.abs(liqPrice(p)/p.entry-1)<.005);}assert.throws(()=>openPosition(r,who,"BTC","long",1000,201,"bad",1000));r.maintenance=.005;assert.throws(()=>openPosition(r,who,"BTC","long",1000,200,"bad",1000));assertRoom(r);});

test("legacy false approval cannot block non-admin trading or roulette",()=>{const r=setup(),player={...who,admin:false};r.members[0].approved=false;spot(r,player,"BTC","buy",1000,1000);r.members[0].approved=false;openPosition(r,player,"BTC","long",1000,5,"access",1000);r.members[0].approved=false;closePosition(r,player,"access",1000);r.members[0].approved=false;spin(r,player,[{kind:"red",amount:100}],1,"access",1000);assertRoom(r);});
