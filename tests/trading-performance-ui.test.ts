import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
test("actual leaderboard profile mounts period component only while open and carries publicId",()=>{
 const page=readFileSync("app/leaderboard/page.tsx","utf8"),profile=readFileSync("app/leaderboard/advancement-profile.tsx","utf8"),ui=readFileSync("app/leaderboard/performance.tsx","utf8");
 assert.match(page,/<AdvancementProfile publicId=\{row.publicId\}/);
 assert.ok(profile.includes("{open?<>{publicId?<Performance publicId={publicId}"));
 assert.match(ui,/const periods=\["1h","24h","7d","30d"\]/);
 for(const text of ["aria-pressed","Not available yet","baseline_unavailable","valuation_unavailable","snapshot_gap","AbortController","encodeURIComponent(publicId)","cache:\"no-store\""])assert.ok(ui.includes(text),text);
 assert.ok(!ui.includes("localStorage"));
});
