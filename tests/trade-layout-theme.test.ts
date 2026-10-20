import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const fin=readFileSync("app/finance-client.tsx","utf8"),css=readFileSync("app/globals.css","utf8");
test("order form and holdings share the right column; open perpetuals sit under the chart",()=>{
 const grid=fin.indexOf('className="market-grid"'),chart=fin.indexOf("<Chart symbol",grid),side=fin.indexOf('className="trade-side"'),tk=fin.indexOf('className="order-ticket"'),sp=fin.indexOf('className="side-positions"'),open=fin.indexOf("<h3>Open perpetuals</h3>"),perps=fin.indexOf('className="open-perps"'),closed=fin.indexOf("<h3>Closed positions</h3>"),pos=fin.indexOf('className="positions"');
 assert.ok(grid>0&&chart>grid&&chart<side&&side<tk&&tk<sp&&sp<perps&&perps<open&&open<pos&&pos<closed);
 assert.match(css,/grid-template-areas:"chart side" "perps side"/);
 assert.match(css,/@media\(min-width:1000px\)\{\.market-grid\{grid-template-columns:minmax\(0,1fr\) 380px/);
 assert.match(css,/@media\(max-width:560px\)\{\.market-grid>\.trade-side\{display:contents\}/);
});
test("trigger helper text is on its own line, not glued to the preview",()=>{
 assert.match(css,/\.order-ticket small\{display:block/);assert.ok(fin.includes('<small className="trigger-note">Triggers close'));
});
test("dark palette is neutral gray and form controls use theme tokens",()=>{
 const dark=css.match(/@media\(prefers-color-scheme:dark\)\{:root\{--surface:#1c1c1c[^}]*\}/);assert.ok(dark);
 for(const m of dark[0].matchAll(/#([0-9a-f]{6})/g)){const [r,g,b]=[0,2,4].map(i=>parseInt(m[1].slice(i,i+2),16));assert.ok(Math.max(r,g,b)-Math.min(r,g,b)<=2,m[0]);}
 assert.doesNotMatch(css.slice(css.indexOf("/* Shared form controls")),/#fffdf7|#fafaf4/);
 assert.match(css,/select option\{background:var\(--surface\)/);
});
