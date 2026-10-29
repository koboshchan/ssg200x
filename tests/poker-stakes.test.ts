import test from 'node:test';
import assert from 'node:assert/strict';
import {freshRoom,register,assertRoom,totalChips,applyAction} from '../lib/poker';
import {applyPokerTableAction,pokerTableRoom} from '../lib/poker-tables';
import {pokerStakes,pokerStakesRules} from '../lib/poker-stakes';
import {readFileSync} from 'node:fs';
const who=(i:number)=>({id:'stakes-'+i,name:'Player '+i,email:'stakes@invalid',admin:false});
for(const id of ['01','02','03'] as const)for(const count of [2,3,4]){
 test(id+' posts correct forced bets with '+count+' players and resets flop minimum',()=>{
  const r=freshRoom(),now=Date.now();
  const act=(i:number,a:any)=>{const t=pokerTableRoom(r,id);applyPokerTableAction(r,id,who(i),a,t.handNumber,t.deadline,now);assertRoom(r);};
  for(let i=0;i<count;i++){register(r,who(i),now);act(i,{type:'join',seat:i,buyIn:90000});}
  for(let i=0;i<count;i++)act(i,{type:'ready'});
  let t=pokerTableRoom(r,id);const stakes=pokerStakes(id);
  assert.equal(t.currentBet,count===2?stakes.big:stakes.straddle);
  assert.deepEqual(t.seats.filter(Boolean).map(s=>s!.bet).sort((a,b)=>a-b),[stakes.small,stakes.big,...(count>=3?[stakes.straddle]:[]),...(count===4?[0]:[])].sort((a,b)=>a-b));
  assert.equal(t.minRaise,t.currentBet);assert.equal(t.pokerHandBigBlind,stakes.big);
  for(let n=0;n<12&&t.street==='preflop';n++){const i=t.turn!;act(i,{type:t.seats[i]!.bet<t.currentBet?'call':'check'});t=pokerTableRoom(r,id);}
  assert.equal(t.street,'flop');assert.equal(t.minRaise,stakes.big);assert.equal(totalChips(r),count*100000);
  assert.match(t.log.join(' '),new RegExp('\\$'+stakes.small/100+' / \\$'+stakes.big/100));
  assert.match(pokerStakesRules(id),/live UTG straddle/);
 });
}
test('legacy active hand without a captured blind retains old $2 flop minimum',()=>{
 const r=freshRoom(),now=Date.now();
 for(let i=0;i<2;i++){register(r,who(i),now);applyAction(r,who(i),{type:'join',seat:i,buyIn:90000},now);}
 for(let i=0;i<2;i++)applyAction(r,who(i),{type:'ready'},now);
 delete r.pokerHandBigBlind;
 while(r.street==='preflop'){const i=r.turn!;applyAction(r,who(i),{type:r.seats[i]!.bet<r.currentBet?'call':'check'},now);}
 assert.equal(r.minRaise,200);
});
test('table picker and selected house rules share the same stakes configuration',()=>{
 const ui=readFileSync('app/room-client.tsx','utf8');
 assert.ok(ui.includes('pokerStakesLabel(id)'));assert.ok(ui.includes('pokerStakesRules(viewId)'));
 assert.ok(ui.includes('pokerStakes(id).label'));
});
