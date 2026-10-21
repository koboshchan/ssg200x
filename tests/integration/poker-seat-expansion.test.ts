import {test,after} from "node:test";
import assert from "node:assert/strict";
import {db,closeDatabase,readRoom,rooms} from "../../lib/db";
import {freshRoom,register,applyAction,assertRoom,totalChips} from "../../lib/poker";
import {marketSymbols} from "../../lib/symbol-registry";
if(!process.env.MONGODB_DB?.startsWith("fakebucks_test_"))throw Error("Requires isolated test DB");
process.env.MONGODB_DB+="_poker_eight";
after(async()=>{await(await db()).dropDatabase();await closeDatabase();});
test("concurrent reads append exactly two seats once, preserve live six-seat hand and fence stale CAS",async()=>{
 const now=Date.now(),r=freshRoom();r.seats=r.seats.slice(0,6);
 for(let i=0;i<6;i++){const who={id:"migration"+i,name:"Player "+i,email:"test@invalid",admin:false};register(r,who,now);applyAction(r,who,{type:"join",seat:i,buyIn:20000},now);}
 for(let i=0;i<6;i++)applyAction(r,{id:"migration"+i,name:"Player "+i,email:"test@invalid",admin:false},{type:"ready"},now);
 r.marketSymbols=marketSymbols();r.version=42;const before=structuredClone(r);
 const collection=await rooms();await collection.deleteMany({});await collection.insertOne(r);
 const reads=await Promise.all(Array.from({length:12},()=>readRoom()));
 for(const actual of reads){
  assert.equal(actual.seats.length,8);assert.deepEqual(actual.seats.slice(0,6),before.seats);assert.deepEqual(actual.seats.slice(6),[null,null]);
  assert.equal(actual.version,43);
  const {seats,version,marketSymbols,...rest}=actual;
  const {seats:oldSeats,version:oldVersion,marketSymbols:oldSymbols,...oldRest}=before;
  assert.deepEqual(rest,oldRest);assert.equal(totalChips(actual),totalChips(before));assertRoom(actual);
 }
 const stale=await collection.replaceOne({_id:"main",version:42},before);assert.equal(stale.matchedCount,0);
 await closeDatabase();const reopened=await readRoom();assert.equal(reopened.seats.length,8);assert.equal(reopened.version,43);
 for(let i=6;i<8;i++)register(reopened,{id:"migration"+i,name:"New",email:"test@invalid",admin:false},now);
 applyAction(reopened,{id:"migration6",name:"New top",email:"test@invalid",admin:false},{type:"join",seat:6,buyIn:20000},now);
 applyAction(reopened,{id:"migration7",name:"New bottom",email:"test@invalid",admin:false},{type:"join",seat:7,buyIn:20000},now);
 assert.deepEqual(reopened.pending,before.pending);assert.equal(reopened.turn,before.turn);assert.equal(reopened.deadline,before.deadline);
 assert.equal(reopened.seats[6]!.inHand,false);assert.equal(reopened.seats[7]!.inHand,false);assertRoom(reopened);
});
