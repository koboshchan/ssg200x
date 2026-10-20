import {test,beforeEach,after} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {db,readRoom,closeDatabase} from "../../lib/db";
import {mutate,move} from "../../lib/store";
import {showdown,assertRoom} from "../../lib/poker";
import {publicRoom} from "../../lib/public";
import {pokerShowdown,pokerUser} from "../fixtures/poker-black78";
import type {Room} from "../../lib/types";
if(!process.env.MONGODB_DB?.startsWith("fakebucks_test_"))throw new Error("Refusing non-test database");
process.env.MONGODB_DB+="_poker_black78";
beforeEach(async()=>{await(await db()).dropDatabase();});
after(async()=>{await(await db()).dropDatabase();await closeDatabase();});
// Recovery fixtures retain a pending turn until the showdown mutation runs.
async function seed(room:Room){room.turn??=0;room.pending=[room.turn];await mutate(r=>{const version=r.version;Object.assign(r,room,{version});});}
async function settleAndReload(){
 await Promise.all(Array.from({length:6},()=>mutate(r=>showdown(r,Date.now()))));
 await closeDatabase();const r=await readRoom();assertRoom(r);
 const payouts=structuredClone(r.payouts),stacks=r.seats.map(s=>s?.stack??null);
 await Promise.all(Array.from({length:6},()=>mutate(r=>showdown(r,Date.now()))));
 const again=await readRoom();assert.deepEqual(again.payouts,payouts);
 assert.deepEqual(again.seats.map(s=>s?.stack??null),stacks);assertRoom(again);return again;
}
test("actual all-in call auto-runs board through move/CAS and duplicate receipts settle Black 78 once",async()=>{
 const r=pokerShowdown([100,0],[["7s","8c"],["Th","3h"]]);
 const now=Date.now();r.street="preflop";r.board=[];r.turn=1;r.pending=[1];r.deadline=now+100000;r.currentBet=100;
 r.seats[1]!.stack=100;r.members[1].wallet=99900;
 r.deck=["4c","Ah","Kh","Qh","5c","Jh","6c","2d"].reverse();await seed(r);
 const requestId=randomUUID();
 await Promise.all(Array.from({length:6},()=>move(pokerUser(1),{type:"call"},requestId,r.handNumber,r.deadline,now)));
 await closeDatabase();const result=await readRoom();
 assert.equal(result.street,"showdown");assert.deepEqual(result.board,["Ah","Kh","Qh","Jh","2d"]);
 assert.deepEqual(result.seats.slice(0,2).map(s=>s!.stack),[200,0]);
 assert.deepEqual(result.payouts,[{seat:0,amount:200,description:"Black 78"}]);
 assert.equal(result.receipts.filter(v=>v.id===requestId).length,1);assertRoom(result);
 assert.equal(publicRoom(result,pokerUser(1)).payouts[0].description,"Black 78");
});
test("persistent short all-in cannot win a royal-flush side pot and uncalled refund survives concurrent settlement",async()=>{
 await seed(pokerShowdown([100,200,300],[["7s","8c"],["Th","3h"],["Ac","Ad"]]));
 const r=await settleAndReload();
 assert.deepEqual(r.seats.slice(0,3).map(s=>s!.stack),[300,200,100]);
 assert.equal(r.payouts[0].description,"Black 78");assert.match(r.payouts[1].description,/Royal Flush/);
 assert.equal(r.payouts[2].description,"Uncalled bet returned");
});
test("persistent equal Black 78 split with odd cent, folded royal flush cannot win",async()=>{
 await seed(pokerShowdown([101,101,101],[["7s","8s"],["7c","8c"],["Th","3h"]],[2]));
 const r=await settleAndReload();assert.deepEqual(r.seats.slice(0,3).map(s=>s!.stack),[151,152,0]);
 assert.ok(r.payouts.every(p=>p.description==="Black 78"));
});
test("actual folding Black 78 through move forfeits and never emits the special name",async()=>{
 const r=pokerShowdown([100,100],[["7s","8c"],["Ac","Ad"]]);
 const now=Date.now();r.turn=0;r.pending=[0,1];r.deadline=now+100000;r.currentBet=100;
 await seed(r);const request=randomUUID();
 await Promise.all(Array.from({length:6},()=>move(pokerUser(0),{type:"fold"},request,r.handNumber,r.deadline,now)));
 await closeDatabase();const result=await readRoom();assertRoom(result);
 assert.deepEqual(result.seats.slice(0,2).map(s=>s!.stack),[0,200]);
 assert.equal(result.payouts[0].description,"Everyone else folded");
 assert.deepEqual(publicRoom(result,pokerUser(1)).seats[0]!.hole,["?","?"]);
});
test("persistent board-only Black 78 remains ordinary, folded hole-only Black 78 is excluded",async()=>{
 for(const folded of [false,true]){
  await(await db()).dropDatabase();
  const r=pokerShowdown(folded?[100,100,100]:[100,100],folded?[["As","Ad"],["Ks","Kd"],["7s","8c"]]:[["As","Ad"],["Ks","Kd"]],folded?[2]:[]);
  r.board=["7c","8s","3h","9d","Jc"];await seed(r);
  const result=await settleAndReload();assert.equal(result.seats[0]!.stack,folded?300:200);
  assert.ok(result.payouts.every(p=>p.description!=="Black 78"));
 }
});
