import {test} from "node:test";
import assert from "node:assert/strict";
import {blackjackChips,blackjackChipStacks} from "../lib/blackjack-chips";
import {freshRoom,register} from "../lib/poker";
import {blackjackAction as act,blackjackTick as tick,blackjackPublic as pub,type BlackjackState} from "../lib/blackjack";
import type {Room,Identity} from "../lib/types";
test("homogeneous stacks overflow after exactly twenty; no invented denominations",()=>{
 const chips=[...Array(41).fill(100),500,2000,500];
 assert.deepEqual(blackjackChipStacks(chips).map(s=>[s.value,s.count]),[[1,20],[1,20],[1,1],[5,2],[20,1]]);
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
