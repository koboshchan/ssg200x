import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {plinkoRiskTable,PLINKO_RISK_TABLES,PLINKO_RISKS} from "../lib/plinko-risk";
const src=readFileSync(new URL("../app/games-client.tsx",import.meta.url),"utf8");
test("plinko board uses the configured edge, not the zero-edge constant",()=>{
 const start=src.indexOf("function Plinko("),board=src.slice(start,start+1500);
 assert.match(board,/plinkoRiskTable\(risk,edgeBps\)/);
 assert.doesNotMatch(board,/PLINKO_RISK_TABLES\[risk\]/);
 assert.match(src,/<Plinko edgeBps=\{edgeBpsOf\(snap\)\}/);
});
test("configured tables differ from zero-edge and highlight rule suppresses stale balls",()=>{
 const same=(a:readonly {multiplier:number}[],b:readonly {multiplier:number}[])=>!a.some((x,i)=>x.multiplier!==b[i].multiplier);
 for(const r of PLINKO_RISKS){
  assert.deepEqual(plinkoRiskTable(r,0),PLINKO_RISK_TABLES[r]);
  const bonus=plinkoRiskTable(r,-500),edge=plinkoRiskTable(r,500);
  assert.ok(bonus.some((b,i)=>b.multiplier>PLINKO_RISK_TABLES[r][i].multiplier));
  assert.ok(edge.some((b,i)=>b.multiplier<PLINKO_RISK_TABLES[r][i].multiplier));
  assert.equal(same(plinkoRiskTable(r,500),edge),true);
  assert.equal(same(plinkoRiskTable(r,0),edge),false);
 }
 assert.match(src,/roundTable\(last\)\.some\(\(b,i\)=>b!==table\[i\]\.multiplier\)/);
 assert.match(src,/g\.plinkoTable\|\|/);
});

test("optional casinoLimits and stochastic cash-out range are handled in UI",()=>{
 for(const f of ["blackjack-client","roulette-client"])assert.match(readFileSync(new URL("../app/"+f+".tsx",import.meta.url),"utf8"),/room\.casinoLimits\?\.houseEdgeBps\?\?0/);
 assert.match(src,/payoutRange\?:\[number,number\]/);assert.match(src,/payText\(game\)/);
 assert.doesNotMatch(src,/Cash out<\/span><strong>\{money\(game\.payout\)\}/);assert.doesNotMatch(src,/<small>Cent rounding/);
});
