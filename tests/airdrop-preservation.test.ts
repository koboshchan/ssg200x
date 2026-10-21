import {test} from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
test("original airdrop banner, confetti and runtime remain byte-for-byte unchanged",()=>{
 for(const file of ["app/airdrop-announcement.tsx","app/airdrop-announcement.css","runtime/airdrop-events.mjs"]){
  assert.equal(readFileSync(file,"utf8"),execFileSync("git",["show","ac90b95:"+file],{encoding:"utf8"}),file);
 }
});
test("treasure banner is payment-only and has no confetti",()=>{
 const source=readFileSync("app/money-banner.tsx","utf8");
 assert.doesNotMatch(source,/airdrop|canvas|confetti/i);
 assert.match(source,/kind:"payment"/);
});
