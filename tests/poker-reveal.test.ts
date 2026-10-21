import {test} from "node:test";
import assert from "node:assert/strict";
import {freshRoom,register,startHand,showdown,tick,BREAK_MS} from "../lib/poker";
import {publicRoom} from "../lib/public";
test("all cards including folds reveal only in the five-second terminal window; no early blinds",()=>{
 const r=freshRoom(),now=Date.now(),who={id:"a",name:"A",email:"a@test.invalid",admin:false};
 for(let i=0;i<3;i++){const w={...who,id:String(i)};register(r,w);r.members[i].wallet-=20000;r.seats[i]={userId:w.id,stack:20000,hole:[],bet:0,committed:0,folded:false,inHand:true,actedAt:null,sitOut:false,leaveAfter:false,seen:now,ready:true};}
 register(r,who);startHand(r,now);
 const spectator=publicRoom(r,who);assert.ok(spectator.seats.slice(0,3).every(s=>s!.hole.every(c=>c==="?")));
 r.seats[0]!.folded=true;r.seats[1]!.folded=true;showdown(r,now);
 assert.equal(BREAK_MS,5000);assert.equal(r.nextDeal,now+5000);
 const revealed=publicRoom(r,who);for(let i=0;i<3;i++)assert.deepEqual(revealed.seats[i]!.hole,r.seats[i]!.hole);
 const hand=r.handNumber;startHand(r,now+4999);assert.equal(r.handNumber,hand);tick(r,now+4999);assert.equal(r.street,"showdown");
 tick(r,now+5000);assert.equal(r.street,"waiting");assert.ok(r.seats.slice(0,3).every(s=>s!.hole.length===0));
});
