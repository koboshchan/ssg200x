import test from "node:test";
import assert from "node:assert/strict";
import {createPacer} from "../lib/chat-pacer";
test("starts are spaced at least 700ms apart and stay under 85 per minute",async()=>{
 let clock=0;const starts:number[]=[];
 const paced=createPacer(700,()=>clock,async ms=>{clock+=ms;});
 await Promise.all(Array.from({length:200},()=>paced(async()=>{starts.push(clock);})));
 for(let i=1;i<starts.length;i++)assert.ok(starts[i]-starts[i-1]>=700);
 assert.ok(starts.filter(t=>t<60000).length<=86);
});
test("a failed request does not block the queue",async()=>{
 let clock=0;const paced=createPacer(700,()=>clock,async ms=>{clock+=ms;});
 await assert.rejects(paced(async()=>{throw new Error("x");}));
 assert.equal(await paced(async()=>7),7);
});
