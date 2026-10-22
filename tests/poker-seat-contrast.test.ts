import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("empty poker seats use theme colours, not white-on-felt", () => {
  const css = readFileSync("app/globals.css", "utf8");
  const rules = [...css.matchAll(/\.seat>button\{([^}]+)\}/g)].filter(m=>/background:/.test(m[1]));
  const last = rules.at(-1)!.index;
  assert.ok(last > css.lastIndexOf(".seat>button{background:#ffffff26"));
  const rule = css.slice(last, css.indexOf("}", last));
  assert.match(rule, /background:var\(--surface\)/);
  assert.match(rule, /color:var\(--ink\)/);
  assert.doesNotMatch(rule, /#fff/);
});
