import test from "node:test";
import assert from "node:assert/strict";
import {freshRoom,register,applyAction,act,tick,startHand,showdown,forfeitSeat,assertRoom,pot,TURN_MS} from "../lib/poker";
import {blackjackAction,blackjackTick,blackjackAssets,type BlackjackState} from "../lib/blackjack";
import {ACTION_TURN_MS,POKER_TURN_MS,POKER_WARNING_MS,turnCountdown,serverClock} from "../lib/turn-timer";
import type {Room,Identity} from "../lib/types";
const user=(n:number):Identity=>({id:"t"+n,name:"Player "+n,email:n+"@test",admin:false});
function seated(n=3){
 const r=freshRoom();
 for(let i=0;i<n;i++){register(r,user(i),0);applyAction(r,user(i),{type:"join",seat:i,buyIn:20000},0);}
 return r;
}
function playing(n=3){const r=seated(n);for(let i=0;i<n;i++)applyAction(r,user(i),{type:"ready"},1000);return r;}
test("60s poker deadlines accept just-before but reject at and after expiry",()=>{
 const r=playing(),deadline=r.deadline!,i=r.turn!;
 assert.equal(deadline,1000+TURN_MS);assert.equal(TURN_MS,60_000);assert.equal(ACTION_TURN_MS,100_000);
 act(r,user(i).id,{type:"call"},deadline-1);
 assert.ok(r.seats[i]);assert.equal(r.deadline,deadline-1+TURN_MS);assertRoom(r);
 const q=playing(),j=q.turn!,d=q.deadline!;
 assert.throws(()=>act(q,user(j).id,{type:"call"},d),/expired/);
 tick(q,d);assert.equal(q.seats[j]!.folded,true);assertRoom(q);
});
test("timeout midhand folds, preserves remaining stack and existing pot for winner",()=>{
 const r=playing(),i=r.turn!,wallet=r.members[i].wallet,oldPot=pot(r),stack=r.seats[i]!.stack;
 tick(r,r.deadline!);assert.equal(r.seats[i]!.folded,true);assert.equal(r.seats[i]!.stack,stack);assert.equal(r.members[i].wallet,wallet);
 assert.equal(pot(r),oldPot);assertRoom(r);
 const remaining=r.seats.flatMap((s,j)=>s&&!s.folded?[j]:[]);
 const loser=r.turn!,winner=remaining.find(j=>j!==loser)!;
 const before=r.seats[winner]!.stack,amount=pot(r);
 act(r,user(loser).id,{type:"fold"},r.deadline!-1);
 assert.equal(r.seats[winner]!.stack,before+amount);
 assert.equal(r.pokerBonus,0);assert.deepEqual(r.pokerDead,[]);assertRoom(r);
});
test("dead contribution levels preserve side pots; detached sole upper layer never refunds",()=>{
 const r=seated();r.street="river";r.handNumber=1;r.board=["2c","3d","7h","9s","Jc"];r.button=0;
 const contributions=[1000,2000,3000],stacks=[0,0,5000],holes=[["As","Ad"],["Ks","Kd"],["Qs","Qd"]];
 r.seats.forEach((s,i)=>{if(!s)return;Object.assign(s!,{stack:stacks[i],committed:contributions[i],bet:contributions[i],hole:holes[i],inHand:true,folded:false});r.members[i].wallet=100000-stacks[i]-contributions[i];});
 forfeitSeat(r,2);showdown(r,1000);
 // Main pot 3000 + orphan top layer 1000 + dead stack 5000 goes to best hand.
 // Ordinary 2000 middle side-pot still requires its original 2000 contribution.
 assert.equal(r.seats[0]!.stack,9000);assert.equal(r.seats[1]!.stack,2000);assert.equal(r.members[2].wallet,92000);assertRoom(r);
 const before=structuredClone(r);showdown(r,2000);assert.deepEqual(r,before);
});
test("no-hand forfeiture carries across restart and pays the next winner",()=>{
 let r=seated(),wallet=r.members[2].wallet;forfeitSeat(r,2);
 assert.equal(r.pokerCarry,20000);assert.equal(r.members[2].wallet,wallet);assertRoom(r);
 r=JSON.parse(JSON.stringify(r));
 applyAction(r,user(0),{type:"ready"},1000);applyAction(r,user(1),{type:"ready"},1000);
 assert.equal(r.pokerCarry,0);assert.equal(pot(r),20300);assertRoom(r);
 const i=r.turn!,winner=1-i;act(r,user(i).id,{type:"fold"},2000);
 assert.equal(r.payouts[0].amount,20300);assert.equal(r.seats[winner]!.stack,40100);
 assertRoom(r);
});
test("five consecutive inactive hands remove once with no refund; playing resets counter",()=>{
 let r=seated();r.seats[2]!.sitOut=true;
 for(let round=1;round<=5;round++){
  // Returning from storage between every round must preserve the inactivity count.
  r=JSON.parse(JSON.stringify(r));
  startHandReady(r,round*20000);
  const i=r.turn!;act(r,user(i).id,{type:"fold"},round*20000+1);
  assert.equal(r.idleCountedHand,round);
  if(round<5)assert.equal(r.seats[2]!.idleHands,round);else assert.equal(r.seats[2],null);
  const snapshot=structuredClone(r);showdown(r,round*20000+2);assert.deepEqual(r,snapshot);
  assert.equal(r.members[2].wallet,80000);assertRoom(r);
  tick(r,round*20000+9000);
 }
 assert.ok(r.payouts.some(p=>p.amount>=20300));
 const q=playing();q.seats[0]!.idleHands=4;
 act(q,user(q.turn!).id,{type:"fold"},2000);
 // End the remaining hand by folding again.
 if(q.street!=="showdown")act(q,user(q.turn!).id,{type:"fold"},2001);
 assert.equal(q.seats[0]!.idleHands,0);assertRoom(q);
});
function startHandReady(r:Room,now:number){
 for(const s of r.seats)if(s&&!s.sitOut)s.ready=true;
 startHand(r,now);
}
test("spectators joining mid-hand count once as not dealt in",()=>{
 const r=playing(2);register(r,user(2),0);applyAction(r,user(2),{type:"join",seat:2,buyIn:20000},1001);
 act(r,user(r.turn!).id,{type:"fold"},1002);assert.equal(r.seats[2]!.idleHands,1);
 for(let i=0;i<5;i++)tick(r,1003+i);assert.equal(r.seats[2]!.idleHands,1);assertRoom(r);
});
function bj(){
 const r=freshRoom() as Room&{blackjack:BlackjackState};
 for(let i=0;i<2;i++){register(r,user(i),0);blackjackAction(r,user(i),{type:"join",seat:i},0);blackjackAction(r,user(i),{type:"bet",amount:100},0);}
 r.blackjack.shoe=[...Array(180).fill("2s"),...["8s","Ts","Ts","8h","9h","7h","2s","3s","Ts"].reverse()];
 blackjackTick(r,10000);return r;
}
const bjTotal=(r:Room)=>r.members.reduce((n,m)=>n+m.wallet,0)+blackjackAssets(r)+(r.house??0);
test("blackjack timeout takes all split and doubled bets, preserving other player's payout",()=>{
 let r=bj();blackjackAction(r,user(0),{type:"split"},10001);
 blackjackAction(r,user(0),{type:"double"},10002);
 assert.equal(r.blackjack.hand,1);assert.equal(blackjackAssets(r),400);
 const wallet=r.members[0].wallet;
 r=JSON.parse(JSON.stringify(r));const d=r.blackjack.deadline!;
 assert.throws(()=>blackjackAction(r,user(0),{type:"stand"},d),/expired/);
 blackjackTick(r,d);assert.equal(r.blackjack.seats[0],null);assert.equal(r.members[0].wallet,wallet);assert.equal(r.house,300);
 assert.equal(r.blackjack.turn,1);
 blackjackAction(r,user(1),{type:"stand"},d+1);
 assert.equal(r.members[1].wallet,100100);assert.equal(r.house,200);assert.equal(bjTotal(r),200000);
 const before=structuredClone(r);blackjackTick(r,d+2);assert.deepEqual(r,before);
});
test("blackjack action before expiry wins and refreshes the persisted deadline",()=>{
 let r=bj(),d=r.blackjack.deadline!;blackjackAction(r,user(0),{type:"hit"},d-1);
 assert.equal(r.blackjack.deadline,d-1+ACTION_TURN_MS);
 r=JSON.parse(JSON.stringify(r));blackjackTick(r,d);assert.ok(r.blackjack.seats[0]);assert.equal(bjTotal(r),200000);
});
test("shared public countdown hides above 30%, appears exactly at 30s, and handles skew/reconnect",()=>{
 assert.equal(turnCountdown(100000,69999),null);assert.equal(turnCountdown(100000,70000),30);
 assert.equal(turnCountdown(100000,70001),30);assert.equal(turnCountdown(100000,99999),1);
 assert.equal(turnCountdown(100000,100000),0);assert.equal(turnCountdown(null,100000),null);
 assert.equal(serverClock(70000,1000000000,1000005000),75000);
 assert.equal(turnCountdown(100000,serverClock(70000,1000000000,1000005000)),25);
 assert.equal(turnCountdown(100000,serverClock(85000,2000,3000)),14);
});

test("poker warning starts at 30 seconds left, not 30 percent of sixty",()=>{
 const countdown=(deadline:number|null,now:number)=>turnCountdown(deadline,now,POKER_TURN_MS,POKER_WARNING_MS);
 assert.equal(countdown(61000,1000),null);
 assert.equal(countdown(61000,30999),null);
 assert.equal(countdown(61000,31000),30);
 assert.equal(countdown(61000,31001),30);
 assert.equal(countdown(61000,60999),1);
 assert.equal(countdown(61000,61000),0);
 assert.equal(countdown(null,1000),null);
 assert.equal(countdown(61000,serverClock(31000,1000000000,1000005000)),25);
 const r=playing(),i=r.turn!,stack=r.seats[i]!.stack;
 const restored:Room=JSON.parse(JSON.stringify(r));
 assert.equal(restored.deadline,61000);
 tick(restored,60999);assert.equal(restored.seats[i]!.folded,false);
 tick(restored,61000);assert.equal(restored.seats[i]!.folded,true);
 assert.equal(restored.seats[i]!.stack,stack);assertRoom(restored);
});
