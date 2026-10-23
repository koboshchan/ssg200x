import test from "node:test";
import assert from "node:assert/strict";
import {freshRoom,register,assertRoom} from "./helpers/crypto-room";
import {setPerpFees} from "../lib/admin";
import {openPosition,closePosition,netPnl,liqPrice,pnl,liquidate,type Position} from "../lib/finance";
import {closingFeeCents,closingFeeMode,closingFeeReserve} from "../runtime/perp-fee-policy.mjs";
import {publicRoom} from "../lib/public";
// @ts-expect-error runtime JavaScript transport
import {marketPayload} from "../runtime/market-payload.mjs";
import {mergeMarket} from "../lib/room-sync";
import {financeAuditSnapshot} from "../lib/finance-audit";
const who={id:"profit",name:"Profit",email:"profit@test",admin:true};
function setup(){const r=freshRoom();register(r,who);r.quotes={BTC:{cryptoGeneration:"fixture",micro:100000000,at:1000}};return r;}
for(const side of ["long","short"] as const)test(`${side} profit share takes 1% of $200 after opening fee, not $10k position`,()=>{
 const p:Position={id:"example",symbol:"BTC",side,margin:1000000,postedMargin:1001000,collateral:1000000,leverage:1,entry:100000000,opened:1000,openingFee:1000,closingFeePpm:10000,closingFeeMode:"profit"};
 const mark=side==="long"?102100000:97900000;
 assert.equal(pnl(p,mark),21000);assert.equal(closingFeeCents(p,mark,pnl(p,mark)),200);
 assert.equal(netPnl(p,mark),19800);
 for(const profit of [-5000,0,999,1000])assert.equal(closingFeeCents(p,mark,profit),0);
 assert.equal(closingFeeCents(p,mark,21000,true),0);
 assert.equal(closingFeeReserve(p),0);
 assert.equal(closingFeeCents({...p,openingFee:0},mark,50),1);
 assert.equal(closingFeeCents({...p,openingFee:0,closingFeePpm:1000000},mark,20000),20000);
 assert.throws(()=>closingFeeCents({...p,closingFeePpm:1000001},mark,20000));
});
test("admin access, precision, mode-specific limits, validation-before-write and audit",()=>{
 const r=setup();
 for(const mode of ["profit","notional"] as const)assert.throws(()=>setPerpFees(r,{...who,admin:false},0,0,mode));
 for(const [opening,closing,mode] of [[0,101,"profit"],[0,1,"notional"],[0.11,1,"profit"],[0,0.00001,"profit"],[0,NaN,"profit"],[0,1,"unknown"]] as const){
 const before=structuredClone(r);assert.throws(()=>setPerpFees(r,who,opening,closing,mode as "profit"));assert.deepEqual(r,before);
 }
 setPerpFees(r,who,0.03,1,"profit");assert.equal(r.perpClosingFeeMode,"profit");assert.equal(r.perpClosingFeePpm,10000);
 assert.deepEqual(r.auditPending!.at(-1)!.new,{openingFeePpm:300,closingFeePpm:10000,closingFeeMode:"profit"});
 setPerpFees(r,who,0,100);assert.equal(r.perpClosingFeeMode,"profit");assert.equal(r.perpClosingFeePpm,1000000);
});
for(const side of ["long","short"] as const)for(const reason of ["Manual","TP","SL","Liq"] as const)test(`${side} ${reason} persists mode/rate across restart and admin changes; HTTP/socket agree`,()=>{
 const r=setup();setPerpFees(r,who,0.05,1,"profit");openPosition(r,who,"BTC",side,10000,5,"p",1000);
 const stored=JSON.parse(JSON.stringify(r));const p=stored.members[0].positions[0] as Position;
 assert.equal(p.closingFeeMode,"profit");assert.equal(p.openingFee,25);
 setPerpFees(stored,who,0.1,0.1,"notional");
 stored.quotes.BTC.micro=side==="long"?110000000:90000000;
 const before=publicRoom(stored,who),wire=marketPayload(stored,who.id,1000)!;
 assert.equal(wire.positions[0].closingFeeMode,"profit");assert.equal(wire.positions[0].pnl,before.positions[0].pnl);assert.equal(wire.positions[0].liquidation,before.positions[0].liquidation);
 assert.equal(before.perpClosingFeeMode,"notional");assert.equal(mergeMarket(before,wire)!.perpClosingFeeMode,"notional");
 assert.equal(financeAuditSnapshot("test","Manual",p,stored.quotes.BTC.micro).closingFeeMode,"profit");
 const fee=reason==="Liq"?0:closingFeeCents(p,stored.quotes.BTC.micro,pnl(p,stored.quotes.BTC.micro));
 const expected=reason==="Liq"?-10000:netPnl(p,stored.quotes.BTC.micro);
 closePosition(stored,who,"p",1000,reason);
 const c=stored.members[0].closedPositions[0];assert.equal(c.closingFee,fee);assert.equal(c.realizedPnl,expected);assert.equal(c.closingFeeMode,"profit");assert.equal(c.closingFeePpm,10000);
 assert.equal(stored.members[0].wallet,100000+expected);assertRoom(stored);
 assert.equal(marketPayload(stored,who.id,1000)!.closedPositions[0].closingFeeMode,"profit");
 assert.equal(publicRoom(stored,who).closedPositions[0].closingFeeMode,"profit");
});
test("loss and liquidation never pay profit fee or reserve; old notional positions remain unchanged",()=>{
 const r=setup();setPerpFees(r,who,0,0.03);openPosition(r,who,"BTC","long",10000,200,"old",1000);
 const old=structuredClone(r.members[0].positions![0]);const oldLiq=liqPrice(old);
 setPerpFees(r,who,0,100,"profit");openPosition(r,who,"BTC","long",10000,200,"new",1000);
 const p=r.members[0].positions![1];assert.equal(closingFeeMode(p),"profit");assert.equal(liqPrice(p),99500000);assert.ok(oldLiq>liqPrice(p));
 assert.deepEqual(r.members[0].positions![0],old);
 r.quotes!.BTC!.micro=99900000;assert.equal(netPnl(p,99900000),-2000);
 closePosition(r,who,"new",1000);assert.equal(r.members[0].closedPositions![0].closingFee,0);assert.equal(r.members[0].closedPositions![0].realizedPnl,-2000);
 openPosition(r,who,"BTC","short",10000,200,"liq",1000);r.quotes!.BTC!.micro=110000000;liquidate(r,1000);
 const c=r.members[0].closedPositions!.find(x=>x.id==="liq")!;assert.equal(c.reason,"Liq");assert.equal(c.closingFee,0);assert.equal(c.realizedPnl,-10000);assertRoom(r);
});
