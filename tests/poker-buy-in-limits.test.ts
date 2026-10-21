import {test} from "node:test";
import assert from "node:assert/strict";
import {freshRoom,register,applyAction,assertRoom} from "../lib/poker";
import {casinoLimits,CASINO_LIMIT_MAX_CENTS} from "../lib/casino-limits";
import {changeCasinoLimits} from "../lib/admin-casino-limits";
import {publicRoom} from "../lib/public";
import {actionSchema} from "../lib/schemas";
const admin={id:"admin",name:"Admin",email:"a@test",admin:true},user={id:"player",name:"Player",email:"p@test",admin:false};
function setup(){const room=freshRoom();register(room,admin,0);register(room,user,0);return room;}
function cap(room:ReturnType<typeof setup>,pokerMaxBuyIn:number){changeCasinoLimits(room,admin,{...casinoLimits(room),pokerMaxBuyIn,expectedVersion:casinoLimits(room).revision});}
test("legacy casino settings preserve existing caps and default poker to $1,000",()=>{
 const room=setup();room.casinoLimits={rouletteMaxTotal:500,blackjackMaxHand:1000,revision:5} as typeof room.casinoLimits;
 assert.deepEqual(casinoLimits(room),{rouletteMaxTotal:500,blackjackMaxHand:1000,pokerMaxBuyIn:100000,pokerEggPrice:5000,pokerTomatoPrice:5000,revision:5});
 for(const invalid of [0,100,9999,10001,Infinity,NaN,"10000",CASINO_LIMIT_MAX_CENTS+100]){
  room.casinoLimits!.pokerMaxBuyIn=invalid as number;assert.equal(casinoLimits(room).pokerMaxBuyIn,100000);
 }
 cap(room,250000);
 changeCasinoLimits(room,admin,{rouletteMaxTotal:1000,blackjackMaxHand:2000,expectedVersion:6});
 assert.equal(casinoLimits(room).pokerMaxBuyIn,250000);
});
test("poker cap rejects malformed bounds and unauthorized or stale edits without any mutation",()=>{
 const room=setup();
 for(const pokerMaxBuyIn of [0,100,9900,10001,10000.5,NaN,Infinity,"10000",null,CASINO_LIMIT_MAX_CENTS+100]){
  const before=structuredClone(room);
  assert.throws(()=>cap(room,pokerMaxBuyIn as number));assert.deepEqual(room,before);
 }
 assert.throws(()=>changeCasinoLimits(room,user,{rouletteMaxTotal:100,blackjackMaxHand:100,pokerMaxBuyIn:10000,expectedVersion:0}),/Administrator/);
 cap(room,10000);const before=structuredClone(room);
 assert.throws(()=>changeCasinoLimits(room,admin,{rouletteMaxTotal:100,blackjackMaxHand:100,pokerMaxBuyIn:20000,expectedVersion:0}),/changed/);
 assert.deepEqual(room,before);
 assert.equal(room.auditPending!.at(-1)!.what,"casino-limits");
 assert.equal((room.auditPending!.at(-1)!.old as {pokerMaxBuyIn:number}).pokerMaxBuyIn,100000);
 assert.equal((room.auditPending!.at(-1)!.new as {pokerMaxBuyIn:number}).pokerMaxBuyIn,10000);
});
test("raised caps permit larger funded buy-ins; lowering leaves seated chips and cashouts intact; rejoin uses latest cap",()=>{
 const room=setup(),member=room.members[1];member.wallet+=200000;room.issuance=(room.issuance??0)+200000;
 cap(room,250000);
 const input={type:"join",seat:0,buyIn:250000} as const;
 assert.ok(actionSchema.safeParse({...input,requestId:"123e4567-e89b-42d3-a456-426614174000",requestAt:0,handNumber:0,turnDeadline:null}).success);
 applyAction(room,user,input,0);assert.equal(member.wallet,50000);assert.equal(room.seats[0]!.stack,250000);
 cap(room,10000);assert.equal(room.seats[0]!.stack,250000);assert.equal(member.wallet,50000);
 assert.equal(publicRoom(room,user).casinoLimits.pokerMaxBuyIn,10000);
 applyAction(room,user,{type:"leave"},1);assert.equal(member.wallet,300000);
 const before=structuredClone(room);
 assert.throws(()=>applyAction(room,user,{type:"join",seat:0,buyIn:10100},2),/limit/);assert.deepEqual(room,before);
 applyAction(room,user,{type:"join",seat:0,buyIn:10000},2);assert.equal(room.seats[0]!.stack,10000);assertRoom(room);
});
test("wallet, whole-dollar and absolute maximum remain enforced independently of configurable cap",()=>{
 const room=setup();cap(room,CASINO_LIMIT_MAX_CENTS);
 for(const buyIn of [100001,100000100,9999,10000.5,100100]){
  const before=structuredClone(room);assert.throws(()=>applyAction(room,user,{type:"join",seat:0,buyIn},0));assert.deepEqual(room,before);
 }
 applyAction(room,user,{type:"join",seat:0,buyIn:100000},0);assertRoom(room);
});
