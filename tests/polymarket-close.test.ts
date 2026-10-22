import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../app/polymarket-client.tsx",import.meta.url),"utf8");
test("position close uses the sell endpoint and exact full share quantity",()=>{
 const positions=source.slice(source.indexOf("function Positions("),source.indexOf("function AdminControls("));
 assert.match(positions,/action:"sell",shares:selected.shares/);
 assert.match(positions,/pending.current\|\|!selected\|\|!fresh\|\|!available/);
 assert.match(positions,/if\(!ambiguous\)envelope.current=null/);
 assert.match(positions,/Estimated proceeds/);
 assert.match(positions,/aria-labelledby="close-position-title"/);
 assert.match(positions,/disabled=\{busy\|\|!fresh\|\|!available\}/);
 assert.doesNotMatch(positions,/window.confirm|window.alert/);
 assert.match(positions,/<th>P&amp;L<\/th><th className=\{styles.closeCell\}/);
});
import {matchingPositions,closeIndependently} from "../lib/polymarket-close";
test("bulk filters exclude settled and closed; zero P&L only matches all",()=>{
 const rows=[{status:"open",pnlCents:10},{status:"open",pnlCents:-10},{status:"open",pnlCents:0},{status:"won",pnlCents:10},{status:"open",pnlCents:10,marketClosed:true}];
 assert.equal(matchingPositions(rows,"all").length,3);
 assert.deepEqual(matchingPositions(rows,"profitable"),[rows[0]]);
 assert.deepEqual(matchingPositions(rows,"losing"),[rows[1]]);
 assert.deepEqual(matchingPositions([],"all"),[]);
});
test("bulk close continues after individual failure and totals only successful fills",async()=>{
 const calls:number[]=[];
 const result=await closeIndependently([1,2,3],async n=>{calls.push(n);if(n===2)throw Error("Market closed");return n*100;});
 assert.deepEqual(calls,[1,2,3]);
 assert.equal(result[1].error,"Market closed");
 assert.equal(result.reduce((n,r)=>n+(r.cents||0),0),400);
});
