import {test} from "node:test";
import assert from "node:assert/strict";
import {blackjackChips,blackjackChipStacks} from "../lib/blackjack-chips";
import {freshRoom,register} from "../lib/poker";
import {blackjackAction as act,blackjackTick as tick,blackjackPublic as pub,type BlackjackState} from "../lib/blackjack";
import type {Room,Identity} from "../lib/types";
test("one homogeneous stack per denomination; no invented denominations",()=>{
 const chips=[...Array(41).fill(100),500,2000,500];
 assert.deepEqual(blackjackChipStacks(chips).map(s=>[s.value,s.count]),[[1,41],[5,2],[20,1]]);
 assert.deepEqual(blackjackChips(7100,chips),chips);
 assert.deepEqual(blackjackChips(7000,chips),[]);
 assert.deepEqual(blackjackChips(2500),[]);
 assert.deepEqual(blackjackChips(500),[500]);
});
test("actual chip choice survives public snapshots, splitting, doubling and resets",()=>{
 const who:Identity={id:"chips",name:"Chips",email:"chips@test",admin:false};
 const r=freshRoom() as Room&{blackjack:BlackjackState};register(r,who,0);act(r,who,{type:"join",seat:0},0);
 const chips=[100,100,500];
 act(r,who,{type:"bet",amount:700,chips},0);chips.push(100);
 assert.deepEqual(pub(r,who)!.seats[0]!.chips,[100,100,500]);
 r.blackjack.shoe=[...Array(180).fill("2s"),...["8s","Ts","8h","7h","2c","3c","Ts"].reverse()];
 tick(r,10000);act(r,who,{type:"split"},10001);
 assert.deepEqual(pub(r,who)!.seats[0]!.hands.map(h=>h.chips),[[100,100,500],[100,100,500]]);
 act(r,who,{type:"double"},10002);
 assert.deepEqual(pub(r,who)!.seats[0]!.hands[0].chips,[100,100,500,100,100,500]);
 act(r,who,{type:"stand"},10003);tick(r,20000);
 assert.deepEqual(pub(r,who)!.seats[0]!.chips,[]);
});

test("twenty-chip limit rejects before wallet or seat mutation, including double",()=>{
 const who:Identity={id:"limit",name:"Limit",email:"limit@test",admin:false};
 const r=freshRoom() as Room&{blackjack:BlackjackState};register(r,who,0);act(r,who,{type:"join",seat:0},0);
 const before=JSON.stringify(r);
 assert.throws(()=>act(r,who,{type:"bet",amount:2100,chips:Array(21).fill(100)},0),/Maximum 20 chips/);
 assert.equal(JSON.stringify(r),before);
 act(r,who,{type:"bet",amount:2000,chips:Array(20).fill(100)},0);
 assert.equal(pub(r,who)!.seats[0]!.chips.length,20);
 r.blackjack.shoe=[...Array(180).fill("2s"),...["5s","Ts","6h","7h"].reverse()];
 tick(r,10000);const playing=JSON.stringify(r);
 assert.throws(()=>act(r,who,{type:"double"},10001),/Maximum 20 chips/);assert.equal(JSON.stringify(r),playing);
});
