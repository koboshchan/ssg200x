import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const chart=readFileSync("app/cached-chart.tsx","utf8");
const css=readFileSync("app/globals.css","utf8").replace(/\/\*[\s\S]*?\*\//g,"");
function declarations(selector:string){
 const rule=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([,selectors])=>selectors.trim()===selector);
 assert.ok(rule,selector+" must have a scoped rule");
 return Object.fromEntries(rule[2].split(";").filter(Boolean).map(value=>value.split(":").map(part=>part.trim())));
}

test("chart grid item can shrink below a previously rendered desktop canvas width",()=>{
 assert.ok(chart.includes('return <div className="cached-chart">'));
 const root=declarations(".cached-chart");
 assert.equal(root["min-width"],"0");
 assert.equal(root["max-width"],"100%");
 // A fixed-size canvas must not supply the intrinsic minimum of a 1fr track.
 const shell=declarations(".cached-chart .chart-shell");
 assert.equal(shell["contain"],"inline-size");
 assert.equal(shell["width"],"100%");
 assert.equal(shell["min-width"],"0");
 assert.equal(root["overflow"],undefined,"do not mask page overflow instead of fixing sizing");
});

test("chart keeps native resize observation and wraps controls on narrow viewports",()=>{
 assert.match(chart,/createChart\(node\.current,\{autoSize:true/);
 assert.equal(declarations(".cached-chart .symbol-tabs")["flex-wrap"],"wrap");
 assert.match(chart,/chart\?\.remove\(\)/,"remove also disconnects the chart's ResizeObserver");
});

test("global table margin does not leak into the chart library's internal table",()=>{
 assert.equal(declarations(".cached-chart .chart-shell table")["margin"],"0");
});
