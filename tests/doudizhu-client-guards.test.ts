import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const src=readFileSync("app/doudizhu-client.tsx","utf8");
test("Dou Dizhu reuses shared reaction controls and preserves paid retry identity",()=>{
 assert.match(src,/PokerPlayerMenu/);assert.match(src,/ReactionProvider adapter=\{adapter\}/);
 assert.match(src,/const \{tableId:_t,\.\.\.rest\}=payload/);
 assert.match(src,/requestId:crypto\.randomUUID\(\),requestAt:Date\.now\(\),\.\.\.rest/);
 assert.match(src,/if\(lock\.current\)throw Error\("unavailable"\)/);
 assert.match(src,/connected:fresh&&!busy/);
 assert.match(src,/localStorage\.setItem\(HIDE_KEY/);
 assert.match(src,/network\|fetch\|failed to load\|abort/);
});
test("idle countdown is only displayed near expiry between hands with nobody ready",()=>{
 assert.match(src,/g\.phase==="waiting"\|\|g\.phase==="finished"/);
 assert.match(src,/!g\.players\.some\(p=>p\.ready\)&&idleSeconds!==null&&idleSeconds<=60/);
 assert.match(src,/data-testid="dd-idle-warning"/);
 assert.match(src,/all reserved money returns to your wallets/);
 assert.match(src,/role="timer" aria-live="off"/);
});

test("room creation offers 1:10 by default, 1:50, 1:100 and bounded custom beans",()=>{
 assert.match(src,/const PRESETS=\[10,50,100\]/);
 assert.match(src,/\[rate,setRate\]=useState\("10"\)/);
 assert.match(src,/aria-label=\{`USD to Happy Beans 1:\$\{n\}`\}/);
 assert.match(src,/disabled=\{n>maxBeans\}/);
 assert.match(src,/aria-label="Custom beans per dollar"/);
 assert.match(src,/min=\{1\} max=\{maxBeans\} step=\{1\}/);
});
