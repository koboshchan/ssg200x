import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const css=readFileSync("app/globals.css","utf8");
test("admin Add/Save and Remove use scoped contrast-safe colors",()=>{
 assert.doesNotMatch(css,/\\n\.admin-block/);
 assert.match(css,/(?:^|\n)\.admin-block \.primary:not\(:disabled\)\{background:color-mix\(in srgb,var\(--blue\) 75%,#000\)/);
 assert.match(css,/\.admin-remove\{color:color-mix\(in srgb,var\(--red\) 70%,var\(--ink\)\)\}/);
});
