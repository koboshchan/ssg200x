import {test} from 'node:test';
import assert from 'node:assert/strict';
import {freshRoom,register,assertRoom,totalChips} from '../lib/poker';
import {payout,spin} from '../lib/finance';
import {rouletteAction,rouletteState,rouletteTick,roulettePublic} from '../lib/roulette';
import type {Bet} from '../lib/market-shared';
import {casinoLimits,CASINO_LIMIT_MAX_CENTS} from '../lib/casino-limits';

const who={id:'fair-a',name:'Alice',email:'a@example.invalid',admin:true};
function setup(edge=0){
 const r=freshRoom();register(r,who);
 r.casinoLimits={...casinoLimits(r),houseEdgeBps:edge};
 rouletteState(r,1000);return r;
}
const kinds=['straight','dozen','column','red','black','odd','even','low','high'] as const;

test('all roulette selections have exact configured RTP on a 37-pocket wheel at -10%, zero, +2%',()=>{
 for(const edge of [-1000,0,200])for(const kind of kinds){
  const picks=kind==='straight'?Array.from({length:37},(_,n)=>n):kind==='column'||kind==='dozen'?[1,2,3]:[undefined];
  for(const pick of picks){
   const bet:Bet={kind,...(pick===undefined?{}:{pick}),amount:180000};
   let gross=0;
   for(let n=0;n<37;n++)gross+=payout(bet,n,CASINO_LIMIT_MAX_CENTS,edge,()=>{throw Error('Exact fraction must not round');});
   assert.equal(BigInt(gross)*10000n,BigInt(bet.amount)*37n*BigInt(10000-edge),kind+' '+edge);
  }
 }
});

test('new custom denomination wagers remain payable and settings are snapshotted per acceptance',()=>{
 const r=setup(-1000),bank=totalChips(r);
 rouletteAction(r,who,{type:'bet',bet:{kind:'red',amount:300}},1,'custom',1000);
 const b=rouletteState(r,1000);
 assert.equal(b.bets[0].houseEdgeBps,-1000);assert.equal(b.bets[0].dead,undefined);
 r.casinoLimits!.houseEdgeBps=200;
 rouletteAction(r,who,{type:'bet',bet:{kind:'straight',pick:1,amount:100}},1,'straight',1001);
 assert.equal(b.bets[1].houseEdgeBps,200);
 r.casinoLimits!.houseEdgeBps=0;
 let rounds=0;
 rouletteTick(r,61000,max=>{if(max===37){rounds++;return 1;}return 0;});
 const expected=679+3626; // red ceil(300 * 37/18 * 1.1), straight exact(100 * 37 * .98)
 assert.equal(r.members[0].wallet,100000-400+expected);
 assert.equal(r.members[0].spins![0].returned,expected);
 assert.equal(b.settledBets![0].returned,679);assert.equal(b.settledBets![1].returned,3626);
 assert.equal(b.history[0].winners![0].returned,expected);
 assert.equal(totalChips(r),bank);assertRoom(r);assert.equal(rounds,1);
 const saved=structuredClone(r);
 rouletteTick(r,61001,()=>{throw Error('Replay consumed randomness');});
 assert.deepEqual(r,saved);
 assert.doesNotMatch(JSON.stringify(roulettePublic(r,who,73000)),/houseEdgeBps|"returned":679/);
});

test('fractional-cent settlement realizes rounding only once for wallet, settled wager and all history',()=>{
 for(const high of [false,true]){
  const r=setup(),bank=totalChips(r);
  rouletteAction(r,who,{type:'bet',bet:{kind:'red',amount:100}},1,'red',1000);
  // Fair red is 205 + 5/9 cents. The helper samples below denominator 180000.
  const bytes=high?[2,191,31]:[0,0,0];
  let calls=0;
  rouletteTick(r,61000,max=>{if(max===37)return 1;assert.equal(max,256);return bytes[calls++%3];});
  const returned=high?205:206,b=rouletteState(r,0);
  assert.equal(calls,3);
  assert.equal(b.settledBets![0].returned,returned);
  assert.equal(r.members[0].wallet,99900+returned);
  assert.equal(r.members[0].spins![0].returned,returned);
  assert.equal(b.history[0].winners![0].returned,returned);
  assert.equal(r.house,100-returned);assert.equal(totalChips(r),bank);assertRoom(r);
 }
});

test('untagged legacy wagers retain 36-factor and dead historical wagers remain unpayable and immutable',()=>{
 const r=setup(-1000),b=rouletteState(r,1000);
 b.bets=[{id:'legacy',userId:who.id,bet:{kind:'red',amount:300}},
  {id:'dead',userId:who.id,bet:{kind:'straight',pick:1,amount:100},dead:true}];
 r.members[0].wallet-=400;
 const before=structuredClone(r);
 assert.throws(()=>rouletteAction(r,who,{type:'change',betId:'dead',bet:{kind:'red',amount:100}},1,'edit',1001));
 assert.throws(()=>rouletteAction(r,who,{type:'cancel',betId:'dead'},1,'cancel',1001));
 assert.deepEqual(r,before);
 rouletteTick(r,61000,()=>1);
 assert.equal(r.members[0].spins![0].returned,600);
 assert.equal(b.settledBets![0].returned,600);assert.equal(b.settledBets![1].returned,0);
 assert.equal(b.settledBets![1].dead,true);assertRoom(r);
 rouletteTick(r,78000,()=>1);
 assert.deepEqual(roulettePublic(r,who,78000)!.lastBets,[{kind:'red',amount:300}]);
 r.casinoLimits!.houseEdgeBps=200;
 rouletteAction(r,who,{type:'rebet'},2,'repeat',78000);
 assert.equal(b.bets[0].houseEdgeBps,200);assert.equal(b.bets[0].dead,undefined);
 assert.equal(b.bets[0].returned,undefined);
});

test('change snapshots new settings, rebet ignores old payout cache and settings do not change accepted wagers',()=>{
 const r=setup(-1000),b=rouletteState(r,0);
 rouletteAction(r,who,{type:'bet',bet:{kind:'straight',pick:0,amount:100}},1,'x',1000);
 r.casinoLimits!.houseEdgeBps=200;
 rouletteAction(r,who,{type:'change',betId:'x',bet:{kind:'straight',pick:0,amount:100}},1,'edit',1001);
 r.casinoLimits!.houseEdgeBps=-1000;rouletteTick(r,61000,()=>0);
 assert.equal(b.settledBets![0].returned,3626);
 rouletteTick(r,78000,()=>0);rouletteAction(r,who,{type:'rebet'},2,'again',78000);
 assert.equal(b.bets[0].houseEdgeBps,-1000);assert.equal(b.bets[0].returned,undefined);
 rouletteTick(r,138000,()=>0);assert.equal(b.settledBets![0].returned,4070);assertRoom(r);
});

test('direct legacy spin endpoint uses configured fair payout and rejects request replay',()=>{
 for(const edge of [-1000,0,200]){
  const r=setup(edge),bank=totalChips(r);
  spin(r,who,[{kind:'red',amount:1800}],1,'once',1000);
  const returned=1800*37/18*(10000-edge)/10000;
  assert.equal(r.members[0].spins![0].returned,returned);
  assert.equal(totalChips(r),bank);assertRoom(r);
  const saved=structuredClone(r);r.casinoLimits!.houseEdgeBps=0;
  assert.throws(()=>spin(r,who,[{kind:'red',amount:1800}],1,'once',5000));
  saved.casinoLimits!.houseEdgeBps=0;assert.deepEqual(r,saved);
 }
});

test('unsafe wallet or house settlement fails before any wager or balance writes',()=>{
 for(const field of ['wallet','house'] as const){
  const r=setup();rouletteAction(r,who,{type:'bet',bet:{kind:'straight',pick:0,amount:100}},1,'x',1000);
  if(field==='wallet')r.members[0].wallet=Number.MAX_SAFE_INTEGER;
  else r.house=-Number.MAX_SAFE_INTEGER;
  const before=structuredClone(r);
  assert.throws(()=>rouletteTick(r,61000,()=>0));
  assert.deepEqual(r,before);
 }
});

test('prepared outcomes separate payout rounding from forbidden second wheel draws',()=>{
 for(const edge of [-1000,0,200])for(const number of [18,28])for(const high of [false,true]){
  const r=setup(edge),bank=totalChips(r),b=rouletteState(r,1000);
  rouletteAction(r,who,{type:'bet',bet:{kind:'red',amount:500}},1,'prepared-red',1000);
  b.pending={id:'prepared-lock',lockedAt:56000,target:number,generatedAt:56001};
  r.casinoLimits!.houseEdgeBps=edge===200?0:200;
  const bytes=high?[2,191,31]:[0,0,0];let calls=0;
  const noWheelDraw=()=>{throw Error('Prepared spin must not draw a result');};
  const rounding=(max:number)=>{assert.equal(max,256);return bytes[calls++%bytes.length];};
  const prepared={round:1,number,startedAt:62000,resultAt:74000,nextAt:79000};
  assert.equal(rouletteTick(r,57000,noWheelDraw,prepared,rounding),true);
  const exact=500*37/18*(10000-edge)/10000;
  const returned=number===28?0:high?Math.floor(exact):Math.ceil(exact);
  assert.equal(calls,number===28?0:3);
  assert.equal(b.spin!.number,number);assert.equal(b.pending,undefined);
  assert.equal(b.settledBets![0].houseEdgeBps,edge);
  assert.equal(b.settledBets![0].returned,returned);
  assert.equal(r.members[0].wallet,99500+returned);
  assert.equal(r.members[0].spins![0].returned,returned);
  assert.equal(r.house,500-returned);assert.equal(totalChips(r),bank);assertRoom(r);
  const saved=structuredClone(r);
  assert.equal(rouletteTick(r,57001,noWheelDraw,prepared,()=>{throw Error('Rounded twice');}),false);
  assert.deepEqual(r,saved);
 }
});

test('production prepared-spin call permits secure default rounding without a second wheel draw',()=>{
 for(const number of [18,28]){
  const r=setup(200),b=rouletteState(r,1000);
  rouletteAction(r,who,{type:'bet',bet:{kind:'red',amount:500}},1,'production-red',1000);
  b.pending={id:'production-lock',lockedAt:56000,target:number,generatedAt:56001};
  rouletteTick(r,57000,()=>{throw Error('Prepared spin must not draw a result');},{round:1,number,startedAt:62000,resultAt:74000,nextAt:79000});
  assert.equal(b.spin!.number,number);
  const returned=b.settledBets![0].returned!;
  assert.ok(number===28?returned===0:returned===1007||returned===1008);
  assert.equal(r.members[0].spins![0].returned,returned);assertRoom(r);
 }
});
