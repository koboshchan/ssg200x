import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {miniAction,miniSnapshot,settleMiniGame,type MiniInput} from '../lib/minigames';
import {PLINKO_RISKS,PLINKO_RISK_TABLES,LEGACY_PLINKO_TABLE} from '../lib/plinko-risk';
import {freshRoom,register,assertRoom} from '../lib/poker';
const who={id:'risk',email:'risk@test',name:'Risk',admin:false};
const wager=(extra={})=>({requestId:randomUUID(),requestAt:Date.now(),type:'start' as const,game:'plinko' as const,amount:1000,...extra});
test('all 27 fair risk buckets settle at the correct stochastic cent endpoint',t=>{
 for(const risk of PLINKO_RISKS)for(let slot=0;slot<9;slot++)for(const amount of [100,1000,99900])for(const ticket of ['up','down'] as const){
  const r=freshRoom();register(r,who);let i=0;
  miniAction(r,who,wager({risk,amount}),()=>i++<slot?1:0);
  const g=r.miniGames![0],b=PLINKO_RISK_TABLES[risk][slot];
  assert.equal(g.risk,risk);assert.equal(g.result?.slot,slot);
  assert.equal(g.payout,0);assert.throws(()=>settleMiniGame(r,g,"won"),/not landed/);
  const n=BigInt(amount)*BigInt(b.numerator),d=BigInt(b.denominator),rem=n%d;
  let bytes=1,range=256n;while(range<d){bytes++;range*=256n;}
  const value=ticket==='up'?0n:rem;
  const draw=Array.from({length:bytes},(_,i)=>Number(value>>BigInt((bytes-i-1)*8)&255n));let next=0;
  const clock=t.mock.method(Date,"now",()=>g.landAt!);
  settleMiniGame(r,g,"won",max=>{assert.equal(max,256);assert.ok(next<draw.length);return draw[next++];});clock.mock.restore();
  assert.equal(g.houseEdgeBps,0);assert.equal(g.payout,Number(n/d+(rem&&ticket==='up'?1n:0n)));
  assert.equal(g.num,b.numerator);assert.equal(g.den,b.denominator);assertRoom(r);
 }
});
test('invalid risk cannot register, charge, record a receipt or invoke RNG',()=>{
 for(const risk of ['bogus',null,42,{},'HIGH']){
  const r=freshRoom(),before=structuredClone(r);let rng=0;
  assert.throws(()=>miniAction(r,who,wager({risk}) as MiniInput,()=>{rng++;return 0;}));
  assert.deepEqual(r,before);assert.equal(rng,0);
 }
});
test('different risks remain immutable across out-of-order replays; changed envelope rejects',()=>{
 const r=freshRoom(),inputs=PLINKO_RISKS.map(risk=>({...wager(),risk}));
 for(const input of inputs)miniAction(r,who,input,()=>0);
 const saved=structuredClone(r);
 for(const input of [...inputs].reverse())miniAction(r,who,input,()=>{throw Error('reroll');});
 assert.deepEqual(r,saved);
 assert.throws(()=>miniAction(r,who,{...inputs[0],risk:'high'}),/different order/);
 for(const input of inputs){
  const g=miniSnapshot(r,who).games.find(g=>g.requestId===input.requestId)!;
  assert.equal(g.risk,input.risk);assert.deepEqual(g.plinkoTable,PLINKO_RISK_TABLES[input.risk]);
  g.plinkoTable![0].multiplier=999;
 }
 assert.deepEqual(r,saved);
});
test('omitted risk defaults medium, but legacy records retain historical table and no invented risk',()=>{
 const r=freshRoom();miniAction(r,who,wager(),()=>0);
 assert.equal(r.miniGames![0].risk,'medium');
 const g=r.miniGames![0];delete g.risk;delete g.plinkoTable;delete g.houseEdgeBps;
 // Explicit historical fixture: absent snapshot, old shape odds and old floor settlement.
 g.num=LEGACY_PLINKO_TABLE[0].numerator;g.den=LEGACY_PLINKO_TABLE[0].denominator;
 const view=miniSnapshot(r,who).games[0];
 assert.equal(view.risk,undefined);assert.deepEqual(view.plinkoTable,LEGACY_PLINKO_TABLE);
 assert.equal(view.houseEdgeBps,200);assert.equal(view.payoutRounding,'floor');
 g.landAt=0;settleMiniGame(r,g,'won',()=>{throw Error('legacy floor must not draw RNG');});
 assert.equal(g.payout,Number(BigInt(g.bet)*BigInt(g.num)/BigInt(g.den)));assertRoom(r);
});
