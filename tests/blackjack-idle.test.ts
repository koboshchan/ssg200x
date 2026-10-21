import test from 'node:test';
import assert from 'node:assert/strict';
import {freshRoom,register} from '../lib/poker';
import {blackjackAction as act,blackjackTick as tick,blackjackPublic as pub,blackjackNeedsTick,BLACKJACK_IDLE_MS,type BlackjackState} from '../lib/blackjack';
import {turnCountdown} from '../lib/turn-timer';
import type {Room,Identity} from '../lib/types';
const a:Identity={id:'idle-a',name:'A',email:'a@test',admin:false};
const b:Identity={...a,id:'idle-b',name:'B'};
function setup(){const r=freshRoom() as Room&{blackjack:BlackjackState};for(const who of [a,b])register(r,who,0);act(r,a,{type:'join',seat:0},0);return r;}
const funds=(r:Room)=>JSON.stringify({wallets:r.members.map(m=>m.wallet),house:r.house,issuance:r.issuance});
test('three minutes exact boundary, no table deadline, no financial effect and idempotent',()=>{
 const r=setup(),before=funds(r);assert.equal(r.blackjack.deadline,null);
 assert.equal(blackjackNeedsTick(r.blackjack,179999),false);tick(r,179999);assert.ok(r.blackjack.seats[0]);
 assert.equal(blackjackNeedsTick(r.blackjack,180000),true);tick(r,180000);assert.equal(r.blackjack.seats[0],null);
 tick(r,600000);assert.equal(funds(r),before);
});
test('JSON restart keeps absolute deadline and countdown hidden until last 90 seconds',()=>{
 const r=JSON.parse(JSON.stringify(setup())) as ReturnType<typeof setup>;
 const deadline=pub(r,a)!.seats[0]!.idleDeadline!;
 assert.equal(deadline,BLACKJACK_IDLE_MS);
 assert.equal(turnCountdown(deadline,89999,300_000),null);
 assert.equal(turnCountdown(deadline,90000,300_000),90);
 assert.equal(turnCountdown(deadline,179999,300_000),1);
 tick(r,180000);assert.equal(r.blackjack.seats[0],null);
});
test('valid bet resets budget; rejected bet does not extend it; late bet cannot dodge expiry',()=>{
 const r=setup();assert.throws(()=>act(r,a,{type:'bet',amount:100.5},100000));
 assert.equal(r.blackjack.seats[0]!.idleDeadline,180000);
 act(r,a,{type:'bet',amount:100},179999);
 assert.equal(r.blackjack.seats[0]!.idleRemaining,180000);
 assert.equal(r.blackjack.seats[0]!.idleDeadline,359999);
 assert.equal(pub(r,a)!.seats[0]!.idleDeadline,null);
 const late=setup(),before=funds(late);assert.throws(()=>act(late,a,{type:'bet',amount:100},180000));assert.equal(funds(late),before);
});
test('mixed seats expire independently; wager never removed or credited to house by idle cleanup',()=>{
 const r=setup();act(r,b,{type:'join',seat:1},179999);act(r,b,{type:'bet',amount:100},179999);
 const before=funds(r);tick(r,180000);
 assert.equal(r.blackjack.seats[0],null);assert.equal(r.blackjack.seats[1]!.bet,100);assert.equal(funds(r),before);
});
test('playing and settlement pause no-bet eligibility; resumed deadline consumes only betting time',()=>{
 const r=setup();act(r,b,{type:'join',seat:1},0);act(r,b,{type:'bet',amount:100},0);
 r.blackjack.shoe=[...Array(180).fill('2s'),...['5s','Ts','6h','7h','Ks'].reverse()];
 tick(r,10000);assert.equal(r.blackjack.phase,'playing');
 assert.equal(r.blackjack.seats[0]!.idleRemaining,170000);assert.equal(r.blackjack.seats[0]!.idleDeadline,null);
 // Multiple legitimate 100-second hand actions can extend a table past 5 min.
 r.blackjack.deadline=600000;tick(r,400000);assert.ok(r.blackjack.seats[0]);assert.ok(r.blackjack.seats[1]);
 const restored=JSON.parse(JSON.stringify(r)) as typeof r;
 act(restored,b,{type:'stand'},400001);assert.equal(restored.blackjack.phase,'settled');
 tick(restored,405001);assert.equal(restored.blackjack.phase,'betting');
 assert.equal(restored.blackjack.seats[0]!.idleDeadline,575001);
 assert.equal(restored.blackjack.seats[1]!.idleDeadline,575001);
 tick(restored,575000);assert.ok(restored.blackjack.seats[0]);
 const before=funds(restored);tick(restored,575001);assert.ok(restored.blackjack.seats.every(s=>s===null));assert.equal(funds(restored),before);
});
test('join during a hand gets a full budget on next betting phase and legacy seats migrate once',()=>{
 const r=setup();delete r.blackjack.seats[0]!.idleRemaining;delete r.blackjack.seats[0]!.idleDeadline;
 assert.ok(blackjackNeedsTick(r.blackjack,123));tick(r,123);assert.equal(r.blackjack.seats[0]!.idleDeadline,180123);
 tick(r,124);assert.equal(r.blackjack.seats[0]!.idleDeadline,180123);
 r.blackjack.phase='playing';r.blackjack.deadline=999999;r.blackjack.turn=0;
 act(r,b,{type:'join',seat:1},400000);assert.equal(r.blackjack.seats[1]!.idleDeadline,null);assert.equal(r.blackjack.seats[1]!.idleRemaining,180000);
});
