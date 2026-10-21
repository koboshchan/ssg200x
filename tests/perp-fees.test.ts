import {test} from 'node:test';
import assert from 'node:assert/strict';
import {freshRoom,register,assertRoom} from '../lib/poker';
import {openPosition,closePosition,liquidate,liqPrice,spot,portfolio,pnl} from '../lib/finance';
import {setPerpFee} from '../lib/admin';
import {feeCents,validFeePercent} from '../lib/perp-fees';
import {settleTriggers} from '../lib/position-triggers';
import {publicRoom} from '../lib/public';
import {mergeMarket} from '../lib/room-sync';
// @ts-expect-error runtime JavaScript
import {marketPayload} from '../runtime/market-payload.mjs';
const who={id:'fee-user',name:'Fee',email:'fee@test',admin:true};
function setup(){const r=freshRoom();register(r,who);r.quotes={BTC:{micro:100000000,at:1000}};return r;}
test('fee setting defaults to approved 0.03%, validates precision and bounds, private admin gates and audits exact change',()=>{
 const r=setup();assert.equal(publicRoom(r,who).perpFeePpm,300);
 for(const v of [NaN,Infinity,-0.01,0.1001,0.00001]){assert.equal(validFeePercent(v),false);assert.throws(()=>setPerpFee(r,who,v));}
 assert.throws(()=>setPerpFee(r,{...who,admin:false},0.05));assert.equal(r.perpFeePpm,undefined);
 for(const v of [0,0.0001,0.05,0.1]){setPerpFee(r,who,v);assert.equal(r.perpFeePpm,Math.round(v*10000));}
 assert.equal(r.auditPending!.at(-1)!.what,'perpetual-trading-fee');assertRoom(r);
});
test('integer full-notional fee rounds once half up and exit notional varies with actual mark',()=>{
 assert.equal(feeCents(10000,200,100000000,100000000,500),1000);
 assert.equal(feeCents(10000,200,100000000,120000000,500),1200);
 assert.equal(feeCents(1000,1,100,100,500),1);
 assert.equal(feeCents(999,1,100,100,500),0);
 assert.equal(feeCents(100000000,200,100000000000,999999999999,1000),200000000);
 assert.throws(()=>feeCents(100,2,100,100,-1));
});
for(const side of ['long','short'] as const)for(const reason of ['Manual','TP','SL'] as const)test(`${side} ${reason} charges both actual notionals exactly once and realizes net of both fees`,()=>{
 const r=setup();setPerpFee(r,who,0.05);
 const favorable=reason!=='SL',direction=side==='long'?1:-1,exit=100000000+direction*(favorable?10000000:-5000000);
 openPosition(r,who,'BTC',side,10000,5,'p',1000,{takeProfit:side==='long'?110000000:90000000,stopLoss:side==='long'?95000000:105000000});
 assert.equal(r.members[0].wallet,90000);assert.equal(r.house,25);assertRoom(r);
 const position={...r.members[0].positions![0]};const before=JSON.stringify(r);assert.throws(()=>openPosition(r,who,'BTC',side,10000,5,'p',1000));assert.equal(JSON.stringify(r),before);
 setPerpFee(r,who,0.1); // Existing position keeps the disclosed rate on close.
 r.quotes!.BTC={micro:exit,at:1001};if(reason==='Manual')closePosition(r,who,'p',1001);else settleTriggers(r,1001);
 const c=r.members[0].closedPositions![0],fee=feeCents(position.margin,5,100000000,exit,500),gross=pnl(position,exit);
 assert.equal(c.openingFee,25);assert.equal(c.closingFee,fee);assert.equal(c.realizedPnl,gross-25-fee);assert.equal(c.reason,reason);
 assert.equal(r.members[0].wallet,100000+c.realizedPnl);assertRoom(r);
 const saved=JSON.stringify(r);settleTriggers(r,1001);liquidate(r,1001);assert.throws(()=>closePosition(r,who,'p',1001));assert.equal(JSON.stringify(r),saved);
});
test('wallet needs posted margin only; insufficient wallet and unsafe net collateral fail atomically',()=>{
 const r=setup();setPerpFee(r,who,0.1);
 portfolio(r.members[0]);r.members[0].wallet=9999;const before=JSON.stringify(r);
 assert.throws(()=>openPosition(r,who,'BTC','long',10000,5,'p',1000));assert.equal(JSON.stringify(r),before);
 r.members[0].wallet=10000;openPosition(r,who,'BTC','long',10000,5,'p',1000);
 assert.equal(r.members[0].wallet,0);assert.equal(r.members[0].positions![0].collateral,9950);
 r.maintenance=0.0045;const saved=JSON.stringify(r);assert.throws(()=>openPosition(r,who,'BTC','long',1000,200,'unsafe',1000));assert.equal(JSON.stringify(r),saved);
});
test('grandfathered and zero-rate positions stay fee-free at close, no spot fees',()=>{
 const r=setup();r.perpFeePpm=0;openPosition(r,who,'BTC','long',10000,5,'old',1000);
 delete r.members[0].positions![0].feePpm;delete r.members[0].positions![0].openingFee;
 setPerpFee(r,who,0.05);closePosition(r,who,'old',1000);assert.equal(r.members[0].wallet,100000);
 setPerpFee(r,who,0);openPosition(r,who,'BTC','long',10000,5,'zero',1000);setPerpFee(r,who,0.05);closePosition(r,who,'zero',1000);assert.equal(r.members[0].wallet,100000);
 spot(r,who,'BTC','buy',1000,1000);spot(r,who,'BTC','sell',1000,1000);assert.equal(r.members[0].wallet,100000);assertRoom(r);
});
for(const side of ['long','short'] as const)test(`${side} liquidation reserves closing fee and gaps never overdraft wallet`,()=>{
 const r=setup();setPerpFee(r,who,0.1);openPosition(r,who,'BTC',side,1000,200,'p',1000);
 const p=r.members[0].positions![0],threshold=liqPrice(p);assert.ok(side==='long'?threshold>99500000:threshold<100500000);
 const wallet=r.members[0].wallet;r.quotes!.BTC={micro:side==='long'?1:1000000000000,at:1001};liquidate(r,1001);
 const c=r.members[0].closedPositions![0];assert.equal(c.reason,'Liq');assert.equal(c.realizedPnl,-1000);assert.equal(r.members[0].wallet,wallet);
 assert.ok(c.closingFee!<=833);assert.equal(c.assessedClosingFee!-c.closingFee!,c.waivedClosingFee);assertRoom(r);
});
test('socket updates retain private fee history and current setting, liquidation math matches full view',()=>{
 const r=setup();setPerpFee(r,who,0.05);openPosition(r,who,'BTC','long',10000,5,'p',1000);
 const full=publicRoom(r,who),wire=marketPayload(r,who.id,1000);assert.equal(wire.positions[0].liquidation,full.positions[0].liquidation);assert.equal(wire.positions[0].openingFee,25);
 closePosition(r,who,'p',1000);const next=marketPayload(r,who.id,1000);assert.deepEqual(next.closedPositions,publicRoom(r,who).closedPositions);
 assert.equal(mergeMarket(full,next)!.perpFeePpm,500);
 const other={...who,id:'other',admin:false};register(r,other);assert.deepEqual(marketPayload(r,other.id).closedPositions,[]);
});

test('approved initial 0.03% charges both full notionals and preserves explicit zero override',()=>{
 const r=setup();assert.equal(marketPayload(r,who.id,1000).perpFeePpm,300);
 openPosition(r,who,'BTC','long',10000,200,'approved',1000);
 assert.equal(r.members[0].wallet,90000);assert.equal(r.members[0].positions![0].openingFee,566);
 setPerpFee(r,who,0);closePosition(r,who,'approved',1000);
 const c=r.members[0].closedPositions![0];assert.equal(c.closingFee,566);assert.equal(c.realizedPnl,-1132);
 assert.equal(publicRoom(r,who).perpFeePpm,0);assert.equal(marketPayload(r,who.id,1000).perpFeePpm,0);
 openPosition(r,who,'BTC','long',10000,200,'free',1000);assert.equal(r.members[0].positions![0].openingFee,0);assertRoom(r);
});
