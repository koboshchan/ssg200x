import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {freshRoom,register} from '../lib/poker';
import {blackjackAction as act,blackjackTick as tick,blackjackAssets as assets,blackjackPublic as pub,type BlackjackState,type BlackjackAction} from '../lib/blackjack';
import {casinoLimits} from '../lib/casino-limits';
import {privateBlackjackShoe} from '../lib/blackjack-private-draw';
const who={id:'bj-edge',name:'Edge',email:'bj@example.test',admin:false};
type Game=ReturnType<typeof freshRoom>&{blackjack:BlackjackState};
function room(bps:number,amount=101,chips?:unknown){
 const r=freshRoom() as Game;register(r,who,0);
 r.casinoLimits={...casinoLimits(r),houseEdgeBps:bps};
 act(r,who,{type:'join',seat:0},0);act(r,who,{type:'bet',amount,chips},0);return r;
}
function rig(r:Game,cards:string[]){r.blackjack.shoe=[...Array(180).fill('2s'),...cards.slice().reverse()];}
function bank(r:Game){return r.members.reduce((n,m)=>n+m.wallet,0)+assets(r)+(r.house??0);}
function ticketRng(d:number,ticket:number){
 const bytes=d<=256?1:2;let i=0;
 return (max:number)=>{assert.equal(max,256);const shift=(bytes-1-i++%bytes)*8;return (ticket>>>shift)&255;};
}
const scenarios:{name:string;cards:string[];actions?:BlackjackAction[];baseNum:number;baseDen:number;result:string}[]=[
 {name:'natural',cards:['As','Ts','Kh','7h'],baseNum:5,baseDen:2,result:'blackjack'},
 {name:'Black 78',cards:['7s','Ts','8c','7h'],baseNum:5,baseDen:2,result:'special'},
 {name:'natural push',cards:['As','Ah','Kh','Ks'],baseNum:1,baseDen:1,result:'push'},
 {name:'win',cards:['Ts','Ts','Qh','7h'],actions:[{type:'stand'}],baseNum:2,baseDen:1,result:'win'},
 {name:'push',cards:['Ts','Ts','7h','7h'],actions:[{type:'stand'}],baseNum:1,baseDen:1,result:'push'},
 {name:'loss',cards:['Ts','Ts','6h','7h'],actions:[{type:'stand'}],baseNum:0,baseDen:1,result:'lose'},
 {name:'bust',cards:['Ts','Ts','6h','7h','Ks'],actions:[{type:'hit'}],baseNum:0,baseDen:1,result:'bust'},
 {name:'dealer natural loss',cards:['Ts','As','6h','Kh'],baseNum:0,baseDen:1,result:'lose'},
 {name:'Charlie',cards:['2s','Ts','2h','7h','3h','3c','4d'],actions:[{type:'hit'},{type:'hit'},{type:'hit'}],baseNum:2,baseDen:1,result:'charlie'},
 {name:'double',cards:['5s','Ts','6h','7h','Ks'],actions:[{type:'double'}],baseNum:2,baseDen:1,result:'win'},
 {name:'split',cards:['As','Ts','Ah','7h','Ks','Qh'],actions:[{type:'split'}],baseNum:2,baseDen:1,result:'win'},
 {name:'split double',cards:['5s','Ts','5h','7h','6s','6h','Ks','Qh'],actions:[{type:'split'},{type:'double'},{type:'double'}],baseNum:2,baseDen:1,result:'win'},
];
for(const bps of [-1000,0,200])for(const scenario of scenarios){
 test(`${scenario.name} gross returns at ${bps}bps have exact rational expectation and conserve chips`,()=>{
  const original=room(bps),initial=bank(original);
  rig(original,scenario.cards);
  // A later settings change cannot reprice an accepted bet, double or split.
  original.casinoLimits={...casinoLimits(original),houseEdgeBps:1000};
  const d=10000*scenario.baseDen,down=structuredClone(original),up=structuredClone(original);
  for(const [r,ticket] of [[down,d-1],[up,0]] as const){
   const rng=ticketRng(d,ticket);tick(r,10000,rng);
   for(const [i,action] of (scenario.actions??[]).entries())act(r,who,action,10001+i,rng);
   assert.equal(r.blackjack.phase,'settled');assert.equal(bank(r),initial);
   assert.equal(assets(r),0);
   assert.equal(pub(r,who)!.seats[0]!.houseEdgeBps,bps);
   for(const hand of r.blackjack.seats[0]!.hands){
    assert.equal(hand.houseEdgeBps,bps);assert.equal(hand.result,scenario.result);
    assert.equal(Number.isSafeInteger(hand.payout),true);
   }
   const settled=structuredClone(r);tick(r,10010,()=>{throw Error('duplicate payout');});assert.deepEqual(r,settled);
  }
  const lo=down.blackjack.seats[0]!.hands,hi=up.blackjack.seats[0]!.hands;
  assert.equal(lo.length,scenario.name.startsWith('split')?2:1);
  for(let i=0;i<lo.length;i++){
   const n=BigInt(lo[i].bet)*BigInt(scenario.baseNum)*BigInt(10000-bps),den=BigInt(d),rem=n%den;
   assert.equal(BigInt(lo[i].payout)*(den-rem)+BigInt(hi[i].payout)*rem,n);
   assert.equal(lo[i].payout,Number(n/den));assert.equal(hi[i].payout,Number((n+den-1n)/den));
  }
 });
}
test('new accepted noncanonical compositions always consume the shared shoe and never audit private draws',()=>{
 for(const [amount,chips] of [[101,undefined],[600,undefined],[600,[600]],[600,null],[600,[100]],[600,[100,'500']],[600,[100,500]]] as [number,unknown][]){
  const r=room(0,amount,chips),s=r.blackjack.seats[0]!;
  assert.equal(s.privatePolicy,undefined);assert.equal(s.privateCards,undefined);
  rig(r,['5s','Ts','6h','7h','Ks']);const count=r.blackjack.shoe.length;
  tick(r,10000);assert.deepEqual(s.hands[0].cards,['5s','6h']);assert.equal(r.blackjack.shoe.length,count-4);
  act(r,who,{type:'double'},10001);assert.equal(r.blackjack.shoe.length,count-5);
  assert.equal(s.privateCards,undefined);assert.equal((r.auditPending??[]).length,0);
  assert.doesNotMatch(JSON.stringify(pub(r,who)),/private|policy|weighted|shoe/i);
 }
});
test('replacement acceptance refreshes snapshot and clears stale policy and cards, but rejected replacement changes nothing',()=>{
 const r=room(-1000),s=r.blackjack.seats[0]!;s.privatePolicy=true;s.privateCards=['Ks'];
 const old=structuredClone(r);
 assert.throws(()=>act(r,who,{type:'bet',amount:100.5},0));assert.deepEqual(r,old);
 r.casinoLimits={...casinoLimits(r),houseEdgeBps:200};
 act(r,who,{type:'bet',amount:103,chips:[103]},0);
 assert.equal(s.houseEdgeBps,200);assert.equal(s.privatePolicy,undefined);assert.equal(s.privateCards,undefined);
 rig(r,['As','Ts','Kh','7h']);tick(r,10000,()=>0);
 assert.equal(s.hands[0].houseEdgeBps,200);
 tick(r,15000);assert.equal(s.houseEdgeBps,undefined);
});
test('restored legacy hands keep original payouts including historical half cents, never use payout randomness',()=>{
 for(const [cards,amount,expected] of [[['As','Kh'],101,252.5],[['Ts','Kh'],101,202],[['Ts','7h'],101,101],[['Ts','6h'],101,0]] as [string[],number,number][]){
  const r=room(200,amount);rig(r,['5s','Ts','6h','7h']);tick(r,10000);
  const s=r.blackjack.seats[0]!,h=s.hands[0];delete h.houseEdgeBps;delete s.houseEdgeBps;h.cards=cards;
  const initial=bank(r);act(r,who,{type:'stand'},10001,()=>{throw Error('legacy rounding');});
  assert.equal(h.payout,expected);assert.equal(bank(r),initial);
 }
});
test('restored legacy private stream survives JSON restart, split and double, then clears next betting round',()=>{
 const r=room(200);rig(r,['5s','Ts','5h','7h']);tick(r,10000);
 const s=r.blackjack.seats[0]!;delete s.houseEdgeBps;delete s.hands[0].houseEdgeBps;
 s.privatePolicy=true;s.privateCards=privateBlackjackShoe();
 const restored=JSON.parse(JSON.stringify(r)) as Game,rs=restored.blackjack.seats[0]!,count=restored.blackjack.shoe.length;
 const initial=bank(restored);act(restored,who,{type:'split'},10001);act(restored,who,{type:'double'},10002);
 assert.equal(restored.blackjack.shoe.length,count);assert.ok(rs.privateCards);
 assert.ok(rs.hands.every(h=>h.houseEdgeBps===undefined));
 if(restored.blackjack.phase==='playing')act(restored,who,{type:'stand'},10003);
 assert.equal(bank(restored),initial);tick(restored,15003);
 assert.equal(rs.privatePolicy,undefined);assert.equal(rs.privateCards,undefined);
});
test('legacy accepted waiting bets still initialize their saved private policy',()=>{
 const r=room(0);const s=r.blackjack.seats[0]!;delete s.houseEdgeBps;s.privatePolicy=true;
 rig(r,['Ts','7h']);const count=r.blackjack.shoe.length;tick(r,10000);
 assert.ok(s.privateCards);assert.equal(r.blackjack.shoe.length,count-2);assert.equal(s.hands[0].houseEdgeBps,undefined);
});
test('safe ledger checks reject debit, settlement, refund and timeout overflow before financial mutations',()=>{
 const r=room(0);r.members[0].wallet=Infinity;const old=structuredClone(r);
 assert.throws(()=>act(r,who,{type:'bet',amount:102},0),/safe ledger/);assert.deepEqual(r,old);
 for(const overflow of ['wallet','house'] as const){
  const r=room(0,100);rig(r,overflow==='wallet'?['Ts','Ts','Kh','7h']:['Ts','Ts','6h','7h']);tick(r,10000);
  if(overflow==='wallet')r.members[0].wallet=Number.MAX_SAFE_INTEGER;else r.house=Number.MAX_SAFE_INTEGER;
  const wallet=r.members[0].wallet,house=r.house;
  assert.throws(()=>act(r,who,{type:'stand'},10001),/safe ledger/);
  assert.equal(r.members[0].wallet,wallet);assert.equal(r.house,house);assert.equal(r.blackjack.phase,'playing');assert.equal(r.blackjack.seats[0]!.hands[0].payout,0);
 }
 const refund=room(0);refund.members[0].wallet=Number.MAX_SAFE_INTEGER;
 assert.throws(()=>act(refund,who,{type:'leave'},1),/safe ledger/);assert.ok(refund.blackjack.seats[0]);
 const timeout=room(0);rig(timeout,['5s','Ts','6h','7h']);tick(timeout,10000);timeout.house=Number.MAX_SAFE_INTEGER;
 assert.throws(()=>tick(timeout,110000),/safe ledger/);assert.ok(timeout.blackjack.seats[0]);
});
test('zero adjustment is not calibrated fair blackjack RTP, baseline remains strategy-dependent',()=>{
 const source=readFileSync('lib/blackjack.ts','utf8');
 assert.match(source,/strategy-dependent/);assert.match(source,/zero adjustment does NOT promise 100% RTP/);
});
