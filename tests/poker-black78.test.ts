import {test} from "node:test";
import assert from "node:assert/strict";
import solver from "pokersolver";
import {isBlack78,showdownWinners} from "../lib/poker-hand";
import {act,assertRoom,showdown} from "../lib/poker";
import {publicRoom} from "../lib/public";
import {pokerShowdown,pokerUser} from "./fixtures/poker-black78";

test("Black 78 requires exactly two distinct ranks, both black, in either order",()=>{
 for(const a of ["7s","7c"])for(const b of ["8s","8c"]) {
  assert.equal(isBlack78([a,b]),true);assert.equal(isBlack78([b,a]),true);
 }
 for(const hole of [[],["7s"],["7s","8c","As"],["7s","7c"],["8s","8c"],["7h","8c"],["7s","8d"],["7h","8d"],["?","?"],["7S","8C"]])
  assert.equal(isBlack78(hole),false,hole.join(" "));
});

test("server showdown Black 78 beats a royal flush and exposes exact result/history label",()=>{
 const r=pokerShowdown([1000,1000],[["7s","8c"],["Th","3h"]]);
 showdown(r,Date.now());assert.equal(r.seats[0]!.stack,2000);assert.equal(r.seats[1]!.stack,0);
 assert.deepEqual(r.payouts,[{seat:0,amount:2000,description:"Black 78"}]);
 const view=publicRoom(r,pokerUser(1));
 assert.equal(view.payouts[0].description,"Black 78");
 assert.ok(view.log.some(line=>line.endsWith(" · Black 78")));
 assert.deepEqual(view.seats[0]!.hole,["7s","8c"]);assertRoom(r);
});

test("two Black 78 hands tie regardless of ordinary rank, with odd cent clockwise after button",()=>{
 for(const button of [0,1,2]) {
  const r=pokerShowdown([101,101,101],[["7s","8s"],["8c","7c"],["Th","3h"]],[2]);
  r.button=button;r.board=["As","Ks","Qs","Js","2d"];showdown(r,1000);
  const first=button===0?1:0;
  assert.equal(r.seats[first]!.stack,152);assert.equal(r.seats[1-first]!.stack,151);
  assert.equal(r.seats[2]!.stack,0);
  assert.ok(r.payouts.every(p=>p.description==="Black 78"));assertRoom(r);
 }
});

test("all-in Black 78 wins only eligible main pot; royal flush wins side pot; excess returned",()=>{
 const r=pokerShowdown([100,200,300],[["7s","8c"],["Th","3h"],["Ac","Ad"]]);
 showdown(r,1000);assert.deepEqual(r.seats.slice(0,3).map(s=>s!.stack),[300,200,100]);
 assert.equal(r.payouts[0].description,"Black 78");
 assert.match(r.payouts[1].description,/Royal Flush/);
 assert.equal(r.payouts[2].description,"Uncalled bet returned");assertRoom(r);
});

test("unequal all-in Black 78 hands split main, only deeper special can win side",()=>{
 const r=pokerShowdown([101,201,201],[["7s","8s"],["7c","8c"],["Th","3h"]]);
 showdown(r,1000);assert.deepEqual(r.seats.slice(0,3).map(s=>s!.stack),[151,352,0]);
 assert.ok(r.payouts.every(p=>p.description==="Black 78"));assertRoom(r);
});

test("folded Black 78 contributes chips but cannot win against royal flush",()=>{
 const r=pokerShowdown([100,100,100],[["7s","8c"],["Th","3h"],["Ac","Ad"]],[0]);
 showdown(r,1000);assert.deepEqual(r.seats.slice(0,3).map(s=>s!.stack),[0,300,0]);
 assert.match(r.payouts[0].description,/Royal Flush/);
 assert.deepEqual(publicRoom(r,pokerUser(1)).seats[0]!.hole,["?","?"]);assertRoom(r);
});

test("actual fold action forfeits Black 78 immediately without claiming special or revealing board",()=>{
 const r=pokerShowdown([100,100],[["7s","8c"],["Ac","Ad"]]);
 r.street="preflop";r.board=[];r.turn=0;r.pending=[0,1];r.deadline=2000;r.currentBet=100;
 act(r,pokerUser(0).id,{type:"fold"},1001);
 assert.equal(r.street,"showdown");assert.equal(r.board.length,0);
 assert.deepEqual(r.payouts,[{seat:1,amount:200,description:"Everyone else folded"}]);assertRoom(r);
});

test("special never wins an uncontested fold as Black 78 or prematurely reveals cards",()=>{
 const r=pokerShowdown([100,100],[["7s","8c"],["Ac","Ad"]],[1]);r.board=[];r.street="preflop";
 showdown(r,1000);assert.equal(r.board.length,0);assert.equal(r.payouts[0].description,"Everyone else folded");
 assert.deepEqual(publicRoom(r,pokerUser(1)).seats[0]!.hole,["?","?"]);assertRoom(r);
});

test("board Black 78 and one-hole/one-board Black 78 are ordinary poker only",()=>{
 for(const holes of [
  [["As","Ad"],["Ks","Kd"]],
  [["7s","2d"],["As","Ad"]],
 ]) {
  const r=pokerShowdown([100,100],holes);r.board=["7c","8s","3h","9d","Jc"];
  showdown(r,1000);assert.equal(r.seats[holes[0][0]==="As"?0:1]!.stack,200);
  assert.ok(r.payouts.every(p=>p.description!=="Black 78"));assertRoom(r);
 }
});

test("nonblack 78 has no special priority against a royal flush",()=>{
 for(const hole of [["7h","8d"],["7s","8d"],["7h","8c"]]) {
  const r=pokerShowdown([100,100],[hole,["Th","3h"]]);showdown(r,1000);
  assert.equal(r.seats[1]!.stack,200);assert.match(r.payouts[0].description,/Royal Flush/);assertRoom(r);
 }
});

test("Black 78 can win detached dead chips and bonus but never refunds someone else's upper layer",()=>{
 const r=pokerShowdown([100,200],[["7s","8c"],["Th","3h"]]);
 // Third registered member's detached all-in contribution and remaining stack.
 const m={...r.members[1],id:"dead",publicId:"dead",name:"Dead",wallet:99750};
 r.members.push(m);r.pokerDead=[200];r.pokerBonus=50;
 showdown(r,1000);assert.deepEqual(r.seats.slice(0,2).map(s=>s!.stack),[350,200]);assertRoom(r);
});

test("normal ranking/categories/kickers/ties match unmodified pokersolver exactly",()=>{
 const cases=[
  {board:["Ah","Kh","Qh","Jh","2d"],holes:[["Th","3h"],["Ac","Ad"]]},
  {board:["2s","2c","2h","9d","Jc"],holes:[["2d","Ac"],["Js","Jh"]]},
  {board:["As","Ad","Kh","2c","3d"],holes:[["Ac","Ks"],["Kd","Kc"]]},
  {board:["2s","5s","9s","Jh","Kd"],holes:[["As","3s"],["Qs","Ts"]]},
  {board:["2c","3d","4h","5s","9c"],holes:[["As","Kd"],["6d","Qc"]]},
  {board:["2c","3d","9h","Js","Qc"],holes:[["9s","9d"],["Qh","Jd"]]},
  {board:["2c","3d","9h","Js","Qc"],holes:[["Qh","Jd"],["Qs","Ad"]]},
  {board:["2c","3d","9h","Js","Qc"],holes:[["Qh","Ad"],["Qs","Kd"]]},
  {board:["2c","3d","9h","Js","Qc"],holes:[["Ah","Td"],["Ks","8d"]]},
  {board:["Ah","Kh","Qh","Jh","Th"],holes:[["2s","3c"],["4s","5c"]]},
 ];
 for(const {board,holes} of cases) {
  const hands=holes.map(hole=>solver.Hand.solve([...hole,...board])),winners=solver.Hand.winners(hands);
  assert.deepEqual(showdownWinners(holes,board),hands.flatMap((h,index)=>winners.includes(h)?[{index,description:h.descr}]:[]));
  assert.deepEqual(showdownWinners([["7s","8c"],...holes],board),[{index:0,description:"Black 78"}]);
 }
});
