import {readFileSync} from "node:fs";import {test} from "node:test";import assert from "node:assert/strict";
test("polymarket ticket calls useFeatures unconditionally",()=>{const s=readFileSync(new URL("../app/polymarket-client.tsx",import.meta.url),"utf8");assert.doesNotMatch(s,/&&\s*useFeatures\(\)/);assert.match(s,/const pmFeatureOff=useFeatures\(\)/);});
