import test from "node:test";
import assert from "node:assert/strict";
import {freshRoom,register,applyAction} from "../lib/poker";
import {publicRoom} from "../lib/public";
import {blackjackTablesAction} from "../lib/blackjack";
import {rouletteState,rouletteAction,roulettePublic,rouletteTick} from "../lib/roulette";
import {moneyInPlay} from "../lib/in-play-navigation";

const who={id:"guard-a",name:"A",email:"a@test.invalid",admin:false};
const other={...who,id:"guard-b",name:"B"};
function setup(){const room=freshRoom();register(room,who);register(room,other);return room;}

test("poker seated stack, committed all-in, settled and spectator use real public snapshots",()=>{
 const room=setup();
 assert.equal(moneyInPlay(publicRoom(room,who),"/poker"),0);
 applyAction(room,who,{type:"join",seat:0,buyIn:20000},0);
 assert.equal(moneyInPlay(publicRoom(room,who),"/poker"),20000);
 room.street="flop";room.seats[0]!.stack=0;room.seats[0]!.committed=20000;
 assert.equal(moneyInPlay(publicRoom(room,who),"/poker"),20000);
 assert.equal(moneyInPlay(publicRoom(room,other),"/poker"),0);
 room.street="showdown";
 assert.equal(moneyInPlay(publicRoom(room,who),"/poker"),0);
 room.seats[0]!.stack=30000;
 assert.equal(moneyInPlay(publicRoom(room,who),"/poker"),30000);
});

test("blackjack only counts my live wagers, handles split/double hands without double-counting seat bet",()=>{
 const room=setup();
 blackjackTablesAction(room,who,{type:"join",tableId:"lounge",seat:0},0);
 blackjackTablesAction(room,other,{type:"join",tableId:"lounge",seat:1},0);
 blackjackTablesAction(room,other,{type:"bet",tableId:"lounge",amount:2000},0);
 assert.equal(moneyInPlay(publicRoom(room,who),"/blackjack"),0);
 blackjackTablesAction(room,who,{type:"bet",tableId:"lounge",amount:5000},0);
 const snapshot=publicRoom(room,who);
 assert.equal(moneyInPlay(snapshot,"/blackjack"),5000);
 const table=snapshot.blackjack.tables[0],seat=table.seats[0]!;
 table.phase="playing";
 seat.hands=[{bet:10000,chips:[5000,5000],done:true,split:true,payout:0,cards:["Ks","Qh"],total:20,handName:null},{bet:5000,chips:[5000],done:false,split:true,payout:0,cards:["7s","6h"],total:13,handName:null}];
 assert.equal(moneyInPlay(snapshot,"/blackjack"),15000);
 table.phase="settled";
 assert.equal(moneyInPlay(snapshot,"/blackjack"),0);
});

test("roulette current round only, includes locked and spinning, not results or prior bets",()=>{
 const room=setup();rouletteState(room,1000);
 rouletteAction(room,who,{type:"bet",bet:{kind:"red",amount:500}},1,"mine",1000);
 rouletteAction(room,other,{type:"bet",bet:{kind:"black",amount:2000}},1,"other",1000);
 const snapshot=publicRoom(room,who);
 snapshot.roulette=roulettePublic(room,who,1000);
 assert.equal(moneyInPlay(snapshot,"/roulette"),500);
 snapshot.roulette=roulettePublic(room,who,56000);
 assert.equal(moneyInPlay(snapshot,"/roulette"),500);
 rouletteTick(room,61000,()=>0);
 snapshot.roulette=roulettePublic(room,who,62000);
 assert.equal(moneyInPlay(snapshot,"/roulette"),500);
 snapshot.roulette=roulettePublic(room,who,73000);
 assert.equal(moneyInPlay(snapshot,"/roulette"),0);
 rouletteTick(room,78000,()=>0);
 snapshot.roulette=roulettePublic(room,who,78000);
 assert.ok(snapshot.roulette!.lastBets.length);
 assert.equal(moneyInPlay(snapshot,"/roulette"),0);
});

test("Markets and non-game pages never guard, evaluation has no financial side effects",()=>{
 const room=setup();applyAction(room,who,{type:"join",seat:0,buyIn:20000},0);
 const snapshot=publicRoom(room,who),before=JSON.stringify(snapshot);
 for(const route of ["/markets","/wallet","/players","/leaderboard","/settings","/privacy",null])assert.equal(moneyInPlay(snapshot,route),0);
 assert.equal(moneyInPlay(null,"/poker"),0);
 moneyInPlay(snapshot,"/poker");assert.equal(JSON.stringify(snapshot),before);
});
