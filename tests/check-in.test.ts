import {test} from "node:test";
import assert from "node:assert/strict";
import {freshRoom,register,assertRoom} from "../lib/poker";
import {claimCheckIn,checkInView,checkInDay,markCheckInBanner,CHECK_IN_REWARDS} from "../lib/check-in";
function setup(){const r=freshRoom();register(r,{id:"a",name:"A",email:"a@test.invalid",admin:false});return {r,m:r.members[0]};}
test("approved seven-day payouts, day8+, duplicate claims and missing-day reset",()=>{
 const {r,m}=setup();let expected=100000;
 assert.deepEqual([...CHECK_IN_REWARDS],[5000,5000,10000,5000,10000,20000,20000]);
 for(let i=0;i<10;i++){const now=Date.UTC(2026,9,1+i,19);const view=claimCheckIn(r,m,now);expected+=CHECK_IN_REWARDS[Math.min(i,6)];assert.equal(view.streak,i+1);assert.equal(m.wallet,expected);claimCheckIn(r,m,now+1000);assert.equal(m.wallet,expected);assertRoom(r);}
 assert.equal(r.auditPending!.length,10);
 assert.equal(claimCheckIn(r,m,Date.UTC(2026,9,12,19)).streak,1);assertRoom(r);
});
test("Vancouver midnight defines days, not UTC midnight, with DST transitions",()=>{
 assert.equal(checkInDay(Date.parse("2026-10-21T06:59:59Z")),"2026-10-20");
 assert.equal(checkInDay(Date.parse("2026-10-21T07:00:00Z")),"2026-10-21");
 const {r,m}=setup();claimCheckIn(r,m,Date.parse("2026-11-01T06:59:00Z"));
 assert.equal(claimCheckIn(r,m,Date.parse("2026-11-01T07:01:00Z")).streak,2);
 assert.equal(claimCheckIn(r,m,Date.parse("2026-11-02T08:01:00Z")).streak,3);
 const s=setup();claimCheckIn(s.r,s.m,Date.parse("2026-03-08T07:59:00Z"));assert.equal(claimCheckIn(s.r,s.m,Date.parse("2026-03-08T08:01:00Z")).streak,2);assert.equal(claimCheckIn(s.r,s.m,Date.parse("2026-03-09T07:01:00Z")).streak,3);
});
test("banner shown once daily is persisted independent of claiming",()=>{
 const {r,m}=setup(),now=Date.parse("2026-10-20T20:00:00Z");
 assert.equal(markCheckInBanner(m,now),true);assert.equal(markCheckInBanner(m,now),false);assert.equal(m.wallet,100000);
 assert.equal(checkInView(m,now).claimed,false);claimCheckIn(r,m,now);assert.equal(markCheckInBanner(m,now),false);
 assert.equal(markCheckInBanner(m,now+86400000),true);assert.equal(checkInView(m,now+86400000).streak,2);
});
