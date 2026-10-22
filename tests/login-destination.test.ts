import {test} from "node:test";
import assert from "node:assert/strict";
import {safeGameDestination} from "../lib/login-destination";
test("login retains only known local game destinations",()=>{
 for(const path of ["/games","/games/hilo","/games/plinko","/games/mines","/games/dice","/games/chicken","/poker","/blackjack","/roulette","/doudizhu"])assert.equal(safeGameDestination(path),path);
 assert.equal(safeGameDestination("/games?game=hilo"),"/games/hilo");
});
test("login rejects external, ambiguous, encoded and unknown redirect targets",()=>{
 for(const path of ["https://evil.test/games","//evil.test/games","/\\evil.test/games","javascript:alert(1)","/games/../admin","/%2f%2fevil.test","/games/%2e%2e/admin","/admin"," games","/games\n",null,undefined])assert.equal(safeGameDestination(path),null);
 assert.equal(safeGameDestination("/games?next=https://evil.test"),"/games");
});
