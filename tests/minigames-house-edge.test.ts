import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {freshRoom,register,assertRoom,totalChips} from '../lib/poker';
import {miniAction,miniSnapshot,settleMiniGame,miniPayout,type MiniGame,type MiniKind} from '../lib/minigames';
import {PLINKO_RISKS,PLINKO_BINOMIAL,plinkoRiskTable,LEGACY_PLINKO_TABLE} from '../lib/plinko-risk';
import type {Room} from '../lib/types';
import {casinoLimits} from '../lib/casino-limits';
const who={id:'edge-test',email:'edge@example.test',name:'Edge',admin:false};
const meta=()=>({requestId:randomUUID(),requestAt:Date.now()});
function room(bps:number){const r=freshRoom();register(r,who);r.casinoLimits={...casinoLimits(r),houseEdgeBps:bps};return r;}
function start(r:Room,kind:MiniKind,extra={},rng:(max:number)=>number=()=>0){const input={...meta(),type:'start' as const,game:kind,amount:1000,...extra};miniAction(r,who,input,rng);return {g:r.miniGames![0],input};}
function step(r:Room,g:MiniGame,extra={},rng:(max:number)=>number=()=>1){miniAction(r,who,{...meta(),type:'step',id:g.id,revision:g.revision,...extra},rng);}
function eqRatio(g:MiniGame,n:bigint,d:bigint){assert.equal(BigInt(g.num)*d,BigInt(g.den)*n);}
function ticketRng(d:bigint,ticket:bigint){let bytes=1,range=256n;while(range<d){bytes++;range*=256n;}const values=Array.from({length:bytes},(_,i)=>Number((ticket>>BigInt((bytes-i-1)*8))&255n));let i=0;return (max:number)=>{assert.equal(max,256);assert.ok(i<values.length,'one rounding draw only');return values[i++];};}
// Exhaust the two rounding classes algebraically, not with Monte Carlo tolerance.
function exactSettlementEV(r:Room,g:MiniGame){
 const n=BigInt(g.bet)*BigInt(g.num),d=BigInt(g.den),rem=n%d;
 const down=structuredClone(r),up=structuredClone(r),gd=down.miniGames!.find(x=>x.id===g.id)!,gu=up.miniGames!.find(x=>x.id===g.id)!;
 if(g.kind==='plinko'){gd.landAt=gu.landAt=0;}
 settleMiniGame(down,gd,'cashed',ticketRng(d,rem));
 settleMiniGame(up,gu,'cashed',ticketRng(d,0n));
 assert.equal(BigInt(gd.payout)*(d-rem)+BigInt(gu.payout)*rem,n);
 assertRoom(down);assertRoom(up);assert.equal(totalChips(down),totalChips(r));assert.equal(totalChips(up),totalChips(r));
 assert.throws(()=>settleMiniGame(up,gu,'cashed',()=>{throw Error('rerolled');}),/already settled/);
 return {n,d};
}
for(const bps of [-1000,0,200]){
 test(`plinko all risks have exact ${bps}bps EV including stochastic cents`,()=>{
  for(const risk of PLINKO_RISKS){let n=0n,d=1n;
   for(let slot=0;slot<9;slot++){
    const r=room(bps);let i=0;const {g}=start(r,'plinko',{risk},()=>i++<slot?1:0);
    assert.equal(g.houseEdgeBps,bps);assert.equal(g.result!.slot,slot);
    const e=exactSettlementEV(r,g);n=n*e.d+e.n*BigInt(PLINKO_BINOMIAL[slot])*d;d*=e.d;
   }
   assert.equal(n*10000n,d*256n*1000n*BigInt(10000-bps));
   assert.deepEqual(plinkoRiskTable(risk,bps),plinkoRiskTable(risk,bps).slice().reverse());
  }
 });
 test(`dice strict odds and exact ${bps}bps EV for all targets`,()=>{
  for(const direction of ['over','under'] as const)for(let target=2;target<=98;target++){
   const wins=direction==='over'?100-target:target-1;
   const r=room(bps);start(r,'dice',{direction,target},max=>max===100?(direction==='over'?99:0):0);
   const g=r.miniGames![0];assert.equal(g.status,'won');eqRatio(g,BigInt(10000-bps)*100n,10000n*BigInt(wins));
   // Restore the escrow state to exercise both stochastic cent endpoints.
   r.members[0].wallet-=g.payout;r.house=(r.house??0)-g.bet+g.payout;g.status='active';g.payout=0;
   const e=exactSettlementEV(r,g);assert.equal(e.n*BigInt(wins)*10000n,e.d*100n*1000n*BigInt(10000-bps));
  }
 });
 test(`chicken applies ${bps}bps once through 15 steps`,()=>{
  const r=room(bps),{g}=start(r,'chicken',{},()=>1);
  for(let lane=1;lane<=15;lane++){
   if(lane>1)step(r,g,{},()=>1);
   eqRatio(g,BigInt(10000-bps)*5n**BigInt(lane),10000n*4n**BigInt(lane));
   if(lane<15)exactSettlementEV(r,g);
   assertRoom(r);
  }
  assert.equal(g.status,'won');
 });
 test(`mines and hilo retain ${bps}bps EV with reduced BigInt fractions`,()=>{
  for(let mines=1;mines<=10;mines++){
   const r=room(bps),{g}=start(r,'mines',{mines});let n=BigInt(10000-bps),d=10000n;
   const safe=Array.from({length:25},(_,i)=>i).filter(i=>!g.bombs!.includes(i));
   for(const [index,cell] of safe.entries()){
    n*=BigInt(25-index);d*=BigInt(25-mines-index);step(r,g,{cell},()=>0);eqRatio(g,n,d);
    if(g.status==='active')exactSettlementEV(r,g);assertRoom(r);
   }
   assert.equal(g.status,'won');
  }
  const r=room(bps),{g}=start(r,'hilo');let n=BigInt(10000-bps),d=10000n;
  for(let i=0;i<6;i++){
   const high=i%2===0,wins=high?14-g.card!:g.card!-2;n*=13n;d*=BigInt(wins);
   step(r,g,{choice:high?'high':'low'},()=>high?12:0);eqRatio(g,n,d);
   if(g.status==='active')exactSettlementEV(r,g);assertRoom(r);
  }
  assert.equal(g.status,'won');
 });
}
test('edge snapshots survive config changes and action receipt replays without RNG',()=>{
 for(const kind of ['chicken','hilo','mines','plinko'] as const){
  const r=room(-1000),{g,input}=start(r,kind,{mines:3},()=>1);const before=structuredClone(r);
  miniAction(r,who,input,()=>{throw Error('replay randomness');});assert.deepEqual(r,before);
  r.casinoLimits={...casinoLimits(r),houseEdgeBps:1000};
  const s=miniSnapshot(r,who);assert.equal(s.houseEdgeBps,1000);assert.equal(s.games[0].houseEdgeBps,-1000);assert.equal(g.houseEdgeBps,-1000);
  if(kind==='chicken'){
   step(r,g,{},()=>1);eqRatio(g,11000n*25n,10000n*16n);
   const cash={...meta(),type:'cashout' as const,id:g.id,revision:g.revision};miniAction(r,who,cash,()=>0);
   const settled=structuredClone(r);miniAction(r,who,cash,()=>{throw Error('settlement replay randomness');});assert.deepEqual(r,settled);
  }
 }
});
test('preview is deterministic expected value with cent bounds, settlement reports actual return',()=>{
 const r=room(0),{g}=start(r,'mines',{mines:3});const cell=Array.from({length:25},(_,i)=>i).find(i=>!g.bombs!.includes(i))!;step(r,g,{cell});
 const a=miniSnapshot(r,who).games[0],b=miniSnapshot(r,who).games[0];assert.deepEqual(a,b);
 assert.equal(a.payoutRounding,'stochastic');assert.equal(a.payout,miniPayout(g));assert.deepEqual(a.payoutRange,[1136,1137]);assert.ok(a.expectedPayout>1136&&a.expectedPayout<1137);
 miniAction(r,who,{...meta(),type:'cashout',id:g.id,revision:g.revision},()=>0);
 const view=miniSnapshot(r,who).games[0];assert.equal(view.payout,1137);assert.equal(view.realizedMultiplier,1.137);
});
test('absent game snapshot preserves legacy 98% odds, floors and legacy table',()=>{
 const r=room(-1000),{g}=start(r,'chicken',{},()=>1);delete g.houseEdgeBps;g.num=49;g.den=40;
 r.casinoLimits={...casinoLimits(r),houseEdgeBps:1000};step(r,g,{},()=>1);eqRatio(g,98n*25n,100n*16n);
 const s=miniSnapshot(r,who).games[0];assert.equal(s.houseEdgeBps,200);assert.equal(s.payoutRounding,'floor');assert.deepEqual(s.payoutRange,[1531,1531]);
 miniAction(r,who,{...meta(),type:'cashout',id:g.id,revision:g.revision},()=>{throw Error('legacy must not reroll');});assert.equal(g.payout,1531);assertRoom(r);
 const p=room(0),{g:pg}=start(p,'plinko');delete pg.houseEdgeBps;delete pg.plinkoTable;pg.num=LEGACY_PLINKO_TABLE[0].numerator;pg.den=LEGACY_PLINKO_TABLE[0].denominator;pg.landAt=0;
 assert.deepEqual(miniSnapshot(p,who).games[0].plinkoTable,LEGACY_PLINKO_TABLE);settleMiniGame(p,pg,'won',()=>{throw Error('legacy RNG');});assert.equal(pg.payout,miniPayout(pg));assertRoom(p);
});
test('new rounds without a saved edge default to fair, and all loss paths conserve chips',()=>{
 const fresh=freshRoom();register(fresh,who);const {g:newGame}=start(fresh,'chicken',{},()=>1);assert.equal(newGame.houseEdgeBps,0);eqRatio(newGame,5n,4n);
 for(const bps of [-1000,0,200]){
  for(const direction of ['over','under'] as const)for(let roll=1;roll<=100;roll++){
   const r=room(bps);let outcome=true;const {g}=start(r,'dice',{target:50,direction},()=>{if(outcome){outcome=false;return roll-1;}return 0;});
   assert.equal(g.status,(direction==='over'?roll>50:roll<50)?'won':'lost');assertRoom(r);assert.equal(totalChips(r),100000);
   const view=miniSnapshot(r,who).games[0];assert.deepEqual(view.payoutRange,[g.payout,g.payout]);assert.equal(view.expectedPayout,g.payout);
  }
  for(const kind of ['chicken','hilo','mines'] as const){
   const r=room(bps),{g}=start(r,kind,{mines:3},()=>0);
   if(kind==='hilo')step(r,g,{choice:'high'},()=>0);
   if(kind==='mines')step(r,g,{cell:g.bombs![0]},()=>0);
   assert.equal(g.status,'lost');assert.equal(g.payout,0);assertRoom(r);assert.equal(totalChips(r),100000);
  }
 }
});
test('browser-safe plinko table rejects invalid edge values',()=>{
 for(const bps of [NaN,Infinity,0.5,-1001,1001])assert.throws(()=>plinkoRiskTable('medium',bps),/Invalid house edge/);
});
