import {test} from 'node:test';
import assert from 'node:assert/strict';
import {freshRoom,register,assertRoom} from '../lib/poker';
import {openPosition,closePosition,liqPrice,liquidatable,pnl,equity,assetsBook,portfolio,netPnl} from '../lib/finance';
import {setPerpFees} from '../lib/admin';
import {publicRoom} from '../lib/public';
// @ts-expect-error runtime module
import {marketPayload} from '../runtime/market-payload.mjs';
const who={id:'collateral',name:'Collateral',email:'c@test',admin:true};
function setup(){const r=freshRoom();portfolio(register(r,who));r.quotes={BTC:{micro:100000000,at:1000}};return r;}
for(const side of ['long','short'] as const)test(`${side} opening fee is withheld from posted margin, not charged in addition, with net-margin notional`,()=>{
 const r=setup();setPerpFees(r,who,0.03,0.03);openPosition(r,who,'BTC',side,10000,200,'p',1000);
 const p=r.members[0].positions![0];
 assert.equal(r.members[0].wallet,90000);assert.equal(p.margin,9400);assert.equal(p.collateral,9400);assert.equal(p.openingFee,600);
 assert.equal(equity(p,p.entry),9400);assert.equal(assetsBook(r.members[0]),9400);assert.equal(r.house,600);assertRoom(r);
 const free={...p,collateral:10000};
 assert.ok(side==='long'?liqPrice(p)>liqPrice(free):liqPrice(p)<liqPrice(free));
 const threshold=liqPrice(p);assert.ok(side==='long'?threshold<p.entry:threshold>p.entry);assert.equal(liquidatable(p,p.entry),false);
 const mark=side==='long'?101000000:99000000;
 assert.equal(pnl(p,mark),18800);
 r.quotes!.BTC!.micro=mark;
 const full=publicRoom(r,who),wire=marketPayload(r,who.id,1000);
 assert.equal(full.positions[0].equity,28200);assert.equal(wire.positions[0].equity,28200);
 assert.equal(wire.positions[0].collateral,9400);assert.equal(wire.positions[0].margin,9400);assert.equal(wire.positions[0].postedMargin,10000);assert.equal(wire.positions[0].pnl,netPnl(p,mark));assert.equal(full.positions[0].pnl,netPnl(p,mark));assert.equal(wire.positions[0].liquidation,full.positions[0].liquidation);
 assert.equal(full.adminUsers[0].netWorth,wire.netWorth);assert.equal(full.leaderboard[0].netWorth,wire.leaderboard[0].netWorth);
 closePosition(r,who,'p',1000);const c=r.members[0].closedPositions![0];
 assert.equal(c.realizedPnl,18800-600-c.closingFee!);assert.equal(r.members[0].wallet,100000+c.realizedPnl);assertRoom(r);
});
test('fees do not consume a cent beyond posted margin when the wallet contains exactly the margin',()=>{
 const r=setup();setPerpFees(r,who,0.1,0.1);r.members[0].wallet=10000;openPosition(r,who,'BTC','long',10000,200,'p',1000);
 assert.equal(r.members[0].wallet,0);assert.equal(r.members[0].positions![0].collateral,8000);
 closePosition(r,who,'p',1000);assert.equal(r.members[0].wallet,6400);assert.equal(r.members[0].closedPositions![0].realizedPnl,-3600);
});
test('insufficient collateral after opening plus closing reserve rejects before any money moves',()=>{
 const r=setup();setPerpFees(r,who,0.1,0.1);r.maintenance=0.0045;const before=structuredClone(r);
 assert.throws(()=>openPosition(r,who,'BTC','long',10000,200,'p',1000),/closing fee reserve/);assert.deepEqual(r,before);
});
test('existing externally charged opening fees are not withheld again on restart or close',()=>{
 const r=setup();setPerpFees(r,who,0.05,0.05);openPosition(r,who,'BTC','long',10000,5,'old',1000);
 // Represent an old snapshot whose opening fee was charged separately to cash.
 const p=r.members[0].positions![0];delete p.collateral;delete p.postedMargin;p.margin=10000;r.members[0].wallet-=p.openingFee!;
 assert.equal(equity(p,p.entry),10000);assertRoom(r);
 const restored=JSON.parse(JSON.stringify(r));closePosition(restored,who,'old',1000);
 assert.equal(restored.members[0].wallet,99950);assert.equal(restored.members[0].closedPositions![0].realizedPnl,-50);assertRoom(restored);
});
test('opening-fee-reduced collateral survives BSON-style persistence and a liquidation gap loses at most the posted margin',()=>{
 const r=setup();setPerpFees(r,who,0.1,0.1);openPosition(r,who,'BTC','short',10000,200,'p',1000);
 const restored=JSON.parse(JSON.stringify(r));restored.quotes.BTC={micro:1000000000000,at:1001};
 closePosition(restored,who,'p',1001);const c=restored.members[0].closedPositions[0];
 assert.equal(restored.members[0].wallet,90000);assert.equal(c.realizedPnl,-10000);assert.equal(c.closingFee,8000);
 assert.ok(c.assessedClosingFee>c.closingFee);assertRoom(restored);
});
test('$100 posted at 200x and 0.05% opening leaves $90 collateral with only $100 wallet debit',()=>{
 const r=setup();setPerpFees(r,who,0.05,0.03);openPosition(r,who,'BTC','long',10000,200,'ninety',1000);
 const p=r.members[0].positions![0];assert.equal(r.members[0].wallet,90000);assert.equal(p.openingFee,1000);assert.equal(p.collateral,9000);
 assert.equal(equity(p,p.entry),9000);assert.equal(netPnl(p,p.entry),-1540);assert.equal(publicRoom(r,who).positions[0].pnl,-1540);assert.equal(p.margin*p.leverage,1800000);assertRoom(r);
 closePosition(r,who,'ninety',1000);const c=r.members[0].closedPositions![0];assert.equal(c.closingFee,540);assert.equal(c.realizedPnl,-1540);
 assert.equal(r.members[0].wallet,98460);assertRoom(r);
});
