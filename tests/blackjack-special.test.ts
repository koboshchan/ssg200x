import test from 'node:test';
import assert from 'node:assert/strict';
import {freshRoom,register} from '../lib/poker';
import {blackjackAction as act,blackjackTick as tick,blackjackAssets as assets,blackjackPublic as pub,blackjackTier,type BlackjackState} from '../lib/blackjack';
import type {Identity,Room} from '../lib/types';
const ids:Identity[]=Array.from({length:6},(_,i)=>({id:'special-'+i,name:'Player '+i,email:i+'@test',admin:false}));
type Game=Room&{blackjack:BlackjackState};
function setup(hands:string[][],dealer:string[],tail:string[]=[],bet=102){
 const r=freshRoom() as Game;
 for(let i=0;i<hands.length;i++){register(r,ids[i],0);act(r,ids[i],{type:'join',seat:i},0);act(r,ids[i],{type:'bet',amount:100},0);
  // Historical fractional wagers must still settle exactly after the input restriction.
  r.members[i].wallet-=bet-100;r.blackjack.seats[i]!.bet=bet;}
 const order=[...hands.map(h=>h[0]),dealer[0],...hands.map(h=>h[1]),dealer[1],...tail];
 r.blackjack.shoe=[...Array(180).fill('2s'),...order.reverse()];
 return r;
}
function bank(r:Room){return r.members.reduce((n,m)=>n+m.wallet,0)+assets(r)+(r.house??0);}
function finish(r:Game){let at=10001;while(r.blackjack.phase==='playing'){act(r,ids[r.blackjack.turn!],{type:'stand'},at++);}}
const tiers=[['Ts','9h'],['As','Kh'],['7c','8s']];
for(let player=0;player<3;player++)for(let dealer=0;dealer<3;dealer++){
 test('initial tier '+player+' vs dealer '+dealer+' exact 102-cent payout and ledger',()=>{
  const r=setup([tiers[player]],tiers[dealer]),n=bank(r);
  tick(r,10000);
  if(player||dealer)assert.equal(r.blackjack.phase,'settled');
  finish(r);
  const payout=player===dealer?102:player>dealer?255:0;
  const h=r.blackjack.seats[0]!.hands[0];
  assert.equal(h.payout,payout);assert.equal(h.result,player===dealer?'push':player>dealer?(player===1?'blackjack':'special'):'lose');
  assert.equal(r.members[0].wallet,100000-102+payout);
  assert.equal(r.house,102-payout);assert.equal(assets(r),0);assert.equal(bank(r),n);
  assert.equal(r.blackjack.dealer.length,2);
  tick(r,10001);assert.equal(r.members[0].wallet,100000-102+payout);assert.equal(bank(r),n);
 });
}
test('only both-black 78 is special in either order across all suits; 9Ace always normal',()=>{
 for(const s of 'shcd')for(const t of 'shcd'){
  const expected='sc'.includes(s)&&'sc'.includes(t)?2:0;
  for(const cards of [['7'+s,'8'+t],['8'+t,'7'+s]]){
   assert.equal(blackjackTier(cards),expected);assert.equal(blackjackTier(cards,true),0);
  }
  for(const cards of [['9'+s,'A'+t],['A'+t,'9'+s]]){
   assert.equal(blackjackTier(cards),0);assert.equal(blackjackTier(cards,true),0);
  }
  assert.equal(blackjackTier(['A'+s,'K'+t],true),0);
 }
 assert.equal(blackjackTier(['7s','8c','2h']),0);assert.equal(blackjackTier(['9s','Ad','Ac']),0);
});
test('six seats settle only after complete dealer deal and compare against same dealer',()=>{
 const hands=[tiers[2],tiers[1],['9d','Ac'],['7h','8s'],tiers[0],['2s','3h']];
 for(let dealer=0;dealer<3;dealer++){
  const r=setup(hands,tiers[dealer]),n=bank(r);tick(r,10000);
  if(!dealer){
   assert.equal(r.blackjack.turn,2);assert.equal(r.members[0].wallet,99898);assert.equal(assets(r),612);
   assert.deepEqual(pub(r,ids[0])!.dealer,['Ts','??']);assert.equal(pub(r,ids[0])!.dealerHandName,null);
   assert.equal(pub(r,ids[0])!.seats[0]!.hands[0].handName,'Black 78');
  }
  finish(r);
  const expected=dealer===0?[255,255,204,0,102,0]:dealer===1?[255,102,0,0,0,0]:[102,0,0,0,0,0];
  for(let i=0;i<6;i++)assert.equal(r.blackjack.seats[i]!.hands[0].payout,expected[i]);
  assert.equal(pub(r,ids[0])!.dealerHandName,[null,'Blackjack','Black 78'][dealer]);assert.equal(bank(r),n);
 }
});
test('nonblack 78 is ordinary 15 and 9Ace is ordinary soft20, with normal dealer S17 play',()=>{
 for(const cards of [['7h','8s'],['9d','Ac']]){
  const r=setup([cards],['Ts','9h']),n=bank(r);tick(r,10000);
  assert.equal(r.blackjack.phase,'playing');assert.equal(r.blackjack.turn,0);
  assert.equal(pub(r,ids[0])!.seats[0]!.hands[0].handName,null);finish(r);
  assert.equal(r.blackjack.seats[0]!.hands[0].payout,cards[0][0]==='9'?204:0);assert.equal(bank(r),n);
 }
 const r=setup([['Ts','9h']],['7h','8s'],['2c']);tick(r,10000);finish(r);
 assert.equal(r.blackjack.dealer.length,3);assert.equal(r.blackjack.seats[0]!.hands[0].payout,204);
});
test('specials beat normal dealer 21/bust without losing their original tier or taking turns',()=>{
 for(const cards of tiers.slice(1)){
  const r=setup([cards,['Ts','9h']],['6h','5s'],['Ks']),n=bank(r);
  tick(r,10000);assert.equal(r.blackjack.turn,1);finish(r);
  assert.equal(r.blackjack.dealer.length,3);assert.equal(r.blackjack.seats[0]!.hands[0].payout,255);
  assert.equal(bank(r),n);
 }
});
for(const pair of [['7s','7c'],['7h','7d'],['9s','9h'],['As','Ah']]){
 test('actual split '+pair[0][0]+' never gains initial special or natural payout',()=>{
  const draw=pair[0][0]==='7'?'8c':pair[0][0]==='9'?'Ac':'Ks';
  const r=setup([pair],['Ts','7h'],[draw,draw]),n=bank(r);
  tick(r,10000);act(r,ids[0],{type:'split'},10001);finish(r);
  for(const h of r.blackjack.seats[0]!.hands){assert.equal(h.split,true);assert.notEqual(h.result,'special');assert.notEqual(h.result,'blackjack');assert.equal(h.payout,pair[0][0]==='A'||pair[0][0]==='9'?204:0);}
  assert.ok(pub(r,ids[0])!.seats[0]!.hands.every(h=>h.handName===null));assert.equal(bank(r),n);
 });
}
test('fifth nonbust card auto wins 1:1, no dealer draw, exact wallet and idempotent payment',()=>{
 const r=setup([['2s','3c']],['Ts','9h'],['2h','3h','4s']),n=bank(r);
 tick(r,10000);for(let i=0;i<3;i++)act(r,ids[0],{type:'hit'},10001+i);
 const h=r.blackjack.seats[0]!.hands[0];
 assert.equal(h.cards.length,5);assert.equal(h.done,true);assert.equal(h.result,'charlie');assert.equal(h.payout,204);
 assert.equal(r.blackjack.phase,'settled');assert.equal(r.members[0].wallet,100102);assert.equal(r.house,-102);
 assert.equal(pub(r,ids[0])!.seats[0]!.hands[0].handName,'Charlie');assert.equal(r.blackjack.dealer.length,2);
 assert.throws(()=>act(r,ids[0],{type:'hit'},10004));tick(r,10005);assert.equal(bank(r),n);assert.equal(r.members[0].wallet,100102);
});
test('Charlie exactly 21 qualifies; fifth-card bust loses and is never named Charlie',()=>{
 for(const fifth of ['Ks','Qh']){
  const r=setup([['2s','3c']],['Ts','9h'],['2h',fifth==='Ks'?'4h':'5h',fifth]),n=bank(r);
  tick(r,10000);for(let i=0;i<3;i++)act(r,ids[0],{type:'hit'},10001+i);
  const h=r.blackjack.seats[0]!.hands[0],win=fifth==='Ks';
  assert.equal(h.result,win?'charlie':'bust');assert.equal(h.payout,win?204:0);
  assert.equal(pub(r,ids[0])!.seats[0]!.hands[0].handName,win?'Charlie':null);
  assert.equal(bank(r),n);
 }
});
test('Charlie skips its turn while another player acts and cannot take a sixth card',()=>{
 const r=setup([['2s','3c'],['Ts','8h']],['Ts','9h'],['2h','3h','4s']),n=bank(r);
 tick(r,10000);for(let i=0;i<3;i++)act(r,ids[0],{type:'hit'},10001+i);
 assert.equal(r.blackjack.turn,1);assert.equal(r.blackjack.seats[0]!.hands[0].done,true);
 assert.equal(pub(r,ids[0])!.seats[0]!.hands[0].handName,'Charlie');
 assert.throws(()=>act(r,ids[0],{type:'hit'},10004));finish(r);
 assert.equal(r.blackjack.seats[0]!.hands[0].payout,204);assert.equal(bank(r),n);
});
test('split hands both qualify for Charlie and return each doubled stake exactly once',()=>{
 const r=setup([['2s','2c']],['Ts','9h'],['3h','3s','2h','3h','4s','2d','3d','4c']),n=bank(r);
 tick(r,10000);act(r,ids[0],{type:'split'},10001);
 for(let i=0;i<6;i++)act(r,ids[0],{type:'hit'},10002+i);
 assert.equal(r.blackjack.phase,'settled');
 for(const h of r.blackjack.seats[0]!.hands){assert.equal(h.split,true);assert.equal(h.result,'charlie');assert.equal(h.payout,204);}
 assert.equal(r.members[0].wallet,100204);assert.equal(r.house,-204);assert.equal(bank(r),n);
});
for(let dealer=1;dealer<3;dealer++)test('dealer initial tier '+dealer+' beats Charlie even on restored split hands',()=>{
 // Initial dealer tiers close the real deal before any player can draw.
 const dealt=setup([['2s','3c']],tiers[dealer]);tick(dealt,10000);
 assert.equal(dealt.blackjack.phase,'settled');assert.throws(()=>act(dealt,ids[0],{type:'hit'},10001));
 // Also guard settlement of persisted/imported hand states, split or otherwise.
 for(const split of [false,true]){
  const r=setup([['2s','3c']],['Ts','8h']),n=bank(r);tick(r,10000);
  const h=r.blackjack.seats[0]!.hands[0];h.cards=['2s','3c','2h','3d','4s'];h.split=split;
  r.blackjack.dealer=[...tiers[dealer]];act(r,ids[0],{type:'stand'},10001);
  assert.equal(h.payout,0);assert.equal(h.result,'lose');assert.equal(r.members[0].wallet,99898);assert.equal(bank(r),n);
 }
});
test('normal soft20 dealer does not stop play; nonblack78 dealer draws, and Charlie beats both',()=>{
 for(const dealer of [['9s','Ac'],['7h','8s']]){
  const r=setup([['2s','3c']],dealer,['2h','3h','4s']),n=bank(r);tick(r,10000);
  assert.equal(r.blackjack.phase,'playing');assert.equal(pub(r,ids[0])!.dealerHandName,null);
  for(let i=0;i<3;i++)act(r,ids[0],{type:'hit'},10001+i);
  assert.equal(r.blackjack.seats[0]!.hands[0].result,'charlie');assert.equal(r.blackjack.seats[0]!.hands[0].payout,204);
  assert.equal(r.blackjack.dealer.length,2);assert.equal(pub(r,ids[0])!.dealerHandName,null);assert.equal(bank(r),n);
 }
});
test('Black 78 pays 3:2 against dealer nonblack78 and soft20, while neither gains a special tier',()=>{
 for(const dealer of [['7h','8s'],['9s','Ac']]){
  const r=setup([['7s','8c']],dealer),n=bank(r);tick(r,10000);
  assert.equal(r.blackjack.phase,'settled');assert.equal(r.blackjack.seats[0]!.hands[0].payout,255);
  assert.equal(pub(r,ids[0])!.dealerHandName,null);assert.equal(bank(r),n);
 }
});
test('Black 78 and Charlie remain winners when normal dealer draws bust for another seat',()=>{
 for(const first of [['7s','8c'],['2s','3c']]){
  const isCharlie=first[0]==='2s',tail=isCharlie?['2h','3h','4s','Kh']:['Kh'];
  const r=setup([first,['Ts','8h']],['6h','6s'],tail),n=bank(r);tick(r,10000);
  if(isCharlie)for(let i=0;i<3;i++)act(r,ids[0],{type:'hit'},10001+i);
  finish(r);
  assert.equal(r.blackjack.dealer.length,3);assert.equal(r.blackjack.seats[0]!.hands[0].payout,isCharlie?204:255);
  assert.equal(r.blackjack.seats[1]!.hands[0].payout,204);assert.equal(bank(r),n);
 }
});
