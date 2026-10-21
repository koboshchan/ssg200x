import {test} from "node:test";
import assert from "node:assert/strict";
import {leverageStops,leveragePosition,leverageAtPosition,stepLeverage} from "../lib/leverage-slider";
test("log scale gives low leverage more room and snaps midpoint near geometric mean",()=>{
 assert.equal(leverageAtPosition(0,200),1);assert.equal(leverageAtPosition(1000,200),200);
 assert.equal(leverageAtPosition(500,200),15);
 assert.ok(leveragePosition(10,200)>400);
 assert.ok(Math.abs(leveragePosition(4,200)-2*leveragePosition(2,200))<1e-8);
});
test("all host caps and sensible stops roundtrip, stay monotone and support keyboard traversal",()=>{
 for(let max=1;max<=200;max++){
  const stops=leverageStops(max);
  assert.equal(stops.at(-1),max);assert.equal(new Set(stops).size,stops.length);
  for(const n of stops)assert.equal(leverageAtPosition(leveragePosition(n,max),max),n);
  let previous=1;
  for(let p=0;p<=1000;p++){const n=leverageAtPosition(p,max);assert.ok(n>=previous&&n<=max);previous=n;}
  for(let i=0;i<stops.length;i++){
   assert.equal(stepLeverage(stops[i],max,1),stops[Math.min(i+1,stops.length-1)]);
   assert.equal(stepLeverage(stops[i],max,-1),stops[Math.max(0,i-1)]);
  }
 }
 assert.equal(stepLeverage(37,200,1),40);assert.equal(stepLeverage(37,200,-1),30);
 assert.equal(leverageAtPosition(-100,200),1);assert.equal(leverageAtPosition(2000,200),200);
});
