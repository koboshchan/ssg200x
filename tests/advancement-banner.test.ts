import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
test("advancement banner shares original entrance and uses half pink-only confetti",()=>{
 const s=readFileSync("app/advancement-banner.tsx","utf8");
 assert.match(s,/airdrop-announcement play/);assert.match(s,/airdrop-message/);
 assert.match(s,/n=w<540\?35:55/);assert.match(s,/cols=\["#ec4899"\]/);
 assert.match(s,/prefers-reduced-motion/);assert.match(s,/Advancement unlocked/);
});
test("each earned count queues a notice and only the first has cash reward",()=>{
 const s=readFileSync("app/advancement-announcement.tsx","utf8");
 assert.match(s,/earn=previous\+1;earn<=count;earn\+\+/);
 assert.match(s,/earn===1\?ADVANCEMENT_REWARDS_CENTS\[tier\]:0/);
 assert.doesNotMatch(s,/new Set/);
});
