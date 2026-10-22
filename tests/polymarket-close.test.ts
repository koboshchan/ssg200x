import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../app/polymarket-client.tsx",import.meta.url),"utf8");
test("position close uses the sell endpoint and exact full share quantity",()=>{
 const positions=source.slice(source.indexOf("function Positions("),source.indexOf("function AdminControls("));
 assert.match(positions,/action:"sell",shares:selected.shares/);
 assert.match(positions,/pending.current\|\|!selected\|\|!fresh\|\|!available/);
 assert.match(positions,/if\(!ambiguous\)envelope.current=null/);
 assert.match(positions,/Estimated proceeds/);
 assert.match(positions,/aria-labelledby="close-position-title"/);
 assert.match(positions,/disabled=\{busy\|\|!fresh\|\|!available\}/);
 assert.doesNotMatch(positions,/window.confirm|window.alert/);
 assert.match(positions,/<th>P&amp;L<\/th><th className=\{styles.closeCell\}/);
});
