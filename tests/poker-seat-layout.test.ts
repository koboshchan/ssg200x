import test from "node:test";import assert from "node:assert/strict";
import {visibleSeatIds,visibleSeatCount,isLegacyLayout,denseSeatSlots,slotsOverlap} from "../lib/poker-table-selection";
const mk=(ids:number[])=>{const a:unknown[]=Array(12).fill(null);ids.forEach(i=>a[i]={});return a;};
test("empty or <=5 players shows six seats, ids 0-5 legacy layout",()=>{
 assert.deepEqual(visibleSeatIds(mk([])),[0,1,2,3,4,5]);assert.equal(isLegacyLayout(visibleSeatIds(mk([1,3]))),true);
});
test("six full exposes one next join seat; grows with joins to 12",()=>{
 assert.deepEqual(visibleSeatIds(mk([0,1,2,3,4,5])),[0,6,1,2,3,4,5]);
 assert.equal(visibleSeatCount(mk([0,1,2,3,4,5,6])),8);assert.equal(visibleSeatCount(mk([0,1,2,3,4,5,6,7,8,9,10])),12);assert.equal(visibleSeatCount(mk([0,1,2,3,4,5,6,7,8,9,10,11])),12);
});
test("occupied high id included without showing everything below it",()=>{
 assert.deepEqual(visibleSeatIds(mk([9])),[0,1,2,3,4,9]);
 assert.equal(visibleSeatCount(mk([9])),6);
});
test("legacy occupied seats 4,5 are never hidden at <=6 players",()=>{
 const ids=visibleSeatIds(mk([4,5,6]));for(const i of [4,5,6])assert.ok(ids.includes(i));assert.equal(ids.length,6);
});
test("canonical order keeps relative existing order",()=>{
 assert.deepEqual(visibleSeatIds(mk([0,1,2,3,4,5,6,7,8,9,10,11])),[0,6,1,2,3,7,4,5,8,9,10,11]);
});
test("slots do not overlap for 6..12",()=>{
 for(let n=6;n<=12;n++){assert.equal(denseSeatSlots(n).length,n);assert.equal(slotsOverlap(n,900,120,60),false,"n="+n);}
});
test("lone occupied seat 11 shows six slots including 11, not twelve",()=>{
 const ids=visibleSeatIds(mk([11]));assert.equal(ids.length,6);assert.ok(ids.includes(11));assert.deepEqual(ids,[0,1,2,3,4,11]);
});
test("legacy players on 0-5 show actual ids 0-5 plus one join seat, not canonical prefix",()=>{
 assert.deepEqual(visibleSeatIds(mk([0,1,2,3,4])),[0,1,2,3,4,5]);
 const ids=visibleSeatIds(mk([0,1,2,3,4,5]));assert.equal(ids.length,7);for(let i=0;i<6;i++)assert.ok(ids.includes(i));assert.ok(ids.includes(6));
 assert.equal(isLegacyLayout(visibleSeatIds(mk([0,1,2,3,4]))),true);
});
