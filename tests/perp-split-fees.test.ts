import {test} from 'node:test';
import assert from 'node:assert/strict';
import {freshRoom,register,assertRoom} from '../lib/poker';
import {openPosition,closePosition,liqPrice} from '../lib/finance';
import {setPerpFees} from '../lib/admin';
import {publicRoom} from '../lib/public';
import {mergeMarket} from '../lib/room-sync';
import {roomFeeRates,positionFeeRates} from '../runtime/perp-fee-policy.mjs';
// @ts-expect-error runtime JavaScript
import {marketPayload} from '../runtime/market-payload.mjs';
const who={id:'split-user',name:'Split',email:'split@test',admin:true};
function setup(){const r=freshRoom();register(r,who);r.quotes={BTC:{micro:100000000,at:1000}};return r;}
test('room migration preserves configured single rate including zero, default and independent overrides',()=>{
 for(const ppm of [undefined,0,300,777]){
  const r=setup();r.perpFeePpm=ppm;
  assert.deepEqual(roomFeeRates(r),{openingFeePpm:ppm??300,closingFeePpm:ppm??300});
  const full=publicRoom(r,who),wire=marketPayload(r,who.id,1000);
  for(const view of [full,wire]){assert.equal(view.perpOpeningFeePpm,ppm??300);assert.equal(view.perpClosingFeePpm,ppm??300);}
  r.perpOpeningFeePpm=0;assert.equal(roomFeeRates(r).closingFeePpm,ppm??300);
 }
});
test('pair updates validate and authorize before changing either leg and audit both rates',()=>{
 const r=setup();r.perpFeePpm=123;
 for(const [open,close] of [[0.02,0.1001],[0.00001,0.03],[NaN,0],[0,Infinity],[-1,0]]){
  const before=JSON.stringify(r);assert.throws(()=>setPerpFees(r,who,open,close));assert.equal(JSON.stringify(r),before);
 }
 assert.throws(()=>setPerpFees(r,{...who,admin:false},0,0));
 setPerpFees(r,who,0,0.075);
 assert.deepEqual(roomFeeRates(r),{openingFeePpm:0,closingFeePpm:750});
 const event=r.auditPending!.at(-1)!;assert.equal(event.what,'perpetual-trading-fees');
 assertRoom(r);
});
for(const [opening,closing] of [[0,0.05],[0.05,0],[0.02,0.07]])for(const side of ['long','short'] as const)test(`asymmetric ${opening}/${closing} ${side} snapshots both rates and settles exact net`,()=>{
 const r=setup();setPerpFees(r,who,opening,closing);
 openPosition(r,who,'BTC',side,10000,5,'p',1000);
 const p=r.members[0].positions![0];assert.deepEqual(positionFeeRates(p),{openingFeePpm:Math.round(opening*10000),closingFeePpm:Math.round(closing*10000)});
 assert.equal(p.openingFee,Math.round(50000*opening/100));assert.equal(r.members[0].wallet,90000);
 const before=liqPrice(p);setPerpFees(r,who,0.1,0.1);assert.equal(liqPrice(p),before);
 r.quotes!.BTC={micro:side==='long'?110000000:90000000,at:1001};
 const wire=marketPayload(r,who.id,1001),full=publicRoom(r,who);
 assert.equal(wire.positions[0].liquidation,full.positions[0].liquidation);assert.equal(wire.positions[0].closingFeePpm,Math.round(closing*10000));
 closePosition(r,who,'p',1001);
 const c=r.members[0].closedPositions![0],closingFee=Math.round((side==='long'?55000:45000)*closing/100);
 assert.equal(c.closingFee,closingFee);assert.equal(c.openingFee,p.openingFee);
 assert.equal(c.realizedPnl,5000-p.openingFee!-closingFee);assert.equal(r.members[0].wallet,100000+c.realizedPnl);
 assert.equal(c.openingFeePpm,Math.round(opening*10000));assert.equal(c.closingFeePpm,Math.round(closing*10000));
 assert.deepEqual(marketPayload(r,who.id,1001).closedPositions,publicRoom(r,who).closedPositions);
 const merged=mergeMarket(full,marketPayload(r,who.id,1001))!;assert.equal(merged.perpOpeningFeePpm,1000);assert.equal(merged.perpClosingFeePpm,1000);assertRoom(r);
});
test('single-rate snapshot predating split retains rate; pre-fee legacy stays free',()=>{
 for(const ppm of [undefined,0,500]){
  const r=setup();setPerpFees(r,who,0,0);openPosition(r,who,'BTC','long',10000,5,'old',1000);
  const p=r.members[0].positions![0];delete p.openingFeePpm;delete p.closingFeePpm;delete p.openingFee;delete p.collateral;if(ppm!==undefined)p.feePpm=ppm;
  setPerpFees(r,who,0.1,0.1);assert.equal(positionFeeRates(p).closingFeePpm,ppm??0);
  closePosition(r,who,'old',1000);assert.equal(r.members[0].wallet,100000-Math.round(50000*(ppm??0)/1e6));assertRoom(r);
 }
});
test('opening fee reduces collateral before closing and maintenance reserves',()=>{
 const r=setup();setPerpFees(r,who,0.1,0);r.maintenance=0.0045;
 assert.throws(()=>openPosition(r,who,'BTC','long',1000,200,'high-open',1000));
 setPerpFees(r,who,0,0.1);assert.throws(()=>openPosition(r,who,'BTC','long',1000,200,'high-close',1000));
 assertRoom(r);
});
test('old persisted single-rate history is not rewritten or assigned invented split rates',()=>{
 const r=setup();r.members[0].closedPositions=[{id:'old',symbol:'BTC',side:'long',leverage:5,entry:100000000,exit:100000000,margin:10000,realizedPnl:-50,openingFee:25,closingFee:25,assessedClosingFee:25,waivedClosingFee:0,reason:'Manual',closedAt:900}];
 assert.deepEqual(marketPayload(r,who.id,1000).closedPositions,publicRoom(r,who).closedPositions);
 assert.equal(marketPayload(r,who.id,1000).closedPositions[0].openingFeePpm,undefined);
});
