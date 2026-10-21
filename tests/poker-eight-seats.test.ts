import {test} from "node:test";
import assert from "node:assert/strict";
import {freshRoom,register,applyAction,act,tick,legal,totalChips,assertRoom,TURN_MS,BREAK_MS,READY_MS} from "../lib/poker";
import {publicRoom} from "../lib/public";
import {actionSchema} from "../lib/schemas";
import {POKER_SEAT_ORDER} from "../lib/poker-seats";
const user=(i:number)=>({id:"eight"+i,name:"Player "+i,email:i+"@test.invalid",admin:false});
function table(){
 const r=freshRoom();
 for(let i=0;i<8;i++){register(r,user(i),1000);applyAction(r,user(i),{type:"join",seat:i,buyIn:20000},1000);}
 return r;
}
test("eight unique seats accept joins, schema and engine reject the ninth",()=>{
 const r=table();assert.equal(r.seats.length,8);assert.equal(r.seats.filter(Boolean).length,8);
 const base={requestId:"b66d4984-f360-4673-8ef9-cd448a9cad93",handNumber:0,turnDeadline:null,requestAt:1000,type:"join",buyIn:20000};
 for(const seat of [6,7])assert.equal(actionSchema.safeParse({...base,seat}).success,true);
 for(const seat of [-1,8,1.5])assert.equal(actionSchema.safeParse({...base,seat}).success,false);
 register(r,user(8));assert.throws(()=>applyAction(r,user(8),{type:"join",seat:8,buyIn:20000},1000));
 assert.throws(()=>applyAction(r,user(8),{type:"join",seat:7,buyIn:20000},1000));
 assert.equal(r.members[8].wallet,100000);assertRoom(r);
});
test("all eight ready, clockwise blinds and actions include both centre seats, all reveal and reset",()=>{
 const r=table(),now=Date.now();
 for(let i=0;i<7;i++)applyAction(r,user(i),{type:"ready"},now);
 assert.equal(r.street,"waiting");
 applyAction(r,user(7),{type:"ready"},now);
 assert.equal(r.button,0);assert.equal(r.seats[6]!.bet,100);assert.equal(r.seats[1]!.bet,200);assert.equal(r.seats[2]!.bet,500);assert.equal(r.turn,3);
 assert.equal(r.deadline,now+TURN_MS);
 const holes=r.seats.flatMap(s=>s!.hole);assert.equal(holes.length,16);assert.equal(new Set(holes).size,16);
 const spectator={...user(99)};register(r,spectator,now);for(const s of publicRoom(r,spectator).seats)assert.deepEqual(s!.hole,["?","?"]);
 const turns:number[]=[];let steps=0;
 while(String(r.street)!=="showdown"&&steps++<100){turns.push(r.turn!);const i=r.turn!;act(r,user(i).id,{type:legal(r,i)!.check?"check":"call"},now+steps);assertRoom(r);}
 assert.equal(r.street,"showdown");assert.equal(r.board.length,5);assert.ok(turns.includes(6));assert.ok(turns.includes(7));
 assert.deepEqual(turns.slice(0,8),[3,7,4,5,0,6,1,2]);
 for(let i=0;i<8;i++)assert.deepEqual(publicRoom(r,spectator).seats[i]!.hole,r.seats[i]!.hole);
 assert.equal(totalChips(r),900000);
 tick(r,r.nextDeal!-1);assert.equal(r.street,"showdown");
 tick(r,r.nextDeal!);assert.equal(r.street,"waiting");assert.ok(r.seats.every(s=>s!.hole.length===0&&!s!.ready));
 for(let i=0;i<8;i++)applyAction(r,user(i),{type:"ready"},now+10000);
 assert.equal(r.button,POKER_SEAT_ORDER[1]);assertRoom(r);
});
test("new centre seats obey ready expiry, cashout, turn timeout and chip conservation",()=>{
 const r=table();
 for(let i=0;i<7;i++)applyAction(r,user(i),{type:"ready"},2000);
 tick(r,2000+READY_MS);
 assert.equal(r.seats[7],null);assert.equal(r.members[7].wallet,100000);assert.equal(r.street,"preflop");
 while(r.turn!==6){act(r,user(r.turn!).id,{type:legal(r,r.turn!)!.check?"check":"call"},2000+READY_MS);}
 const stack=r.seats[6]!.stack,wallet=r.members[6].wallet;
 tick(r,r.deadline!);assert.equal(r.seats[6]!.folded,true);assert.equal(r.seats[6]!.stack,stack);assert.equal(r.members[6].wallet,wallet);
 assert.equal(totalChips(r),800000);assertRoom(r);
});
