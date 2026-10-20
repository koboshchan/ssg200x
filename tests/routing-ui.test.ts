import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
const room=readFileSync("app/room-client.tsx","utf8");
test("every section has a route page under one shared layout",()=>{
 for(const r of ["poker","blackjack","roulette","markets","standings","players","settings"])assert.ok(existsSync("app/(room)/"+r+"/page.tsx"),r);
 assert.ok(existsSync("app/(room)/layout.tsx"));assert.ok(!existsSync("app/page.tsx"));
});
test("navbar links replace segmented tabs, players admin-only, gear to settings",()=>{
 assert.ok(!room.includes('role="tablist"'));
 assert.match(room,/href:"\/players"[^}]*admin:true/);assert.ok(room.includes('href="/settings"'));assert.ok(room.includes('aria-current={on?"page":undefined}'));
 assert.equal((room.match(/<LiveProvider key=\{user\.id\}>/g)||[]).length,1);
});
