import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {resolve} from "node:path";
test("production route has no autoplay action, toggle or fixture endpoint",()=>{
 const route=readFileSync(resolve("app/api/doudizhu/route.ts"),"utf8");
 assert(!/z\.literal\("(?:auto|autoplay|bot|simulate)"\)/.test(route));
 assert(!/process\.env|fixture|seedVideoFixture|demo-dd-/.test(route));
 assert(route.includes(".strict()"));
 assert.deepEqual(readdirSync(resolve("app/api/doudizhu")).sort(),["route.ts"]);
});
