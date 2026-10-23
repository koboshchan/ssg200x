import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fxReasonText,fxExecutable} from "../app/fx-status";
test("FX follows the server health deadline, not the age of an unchanged rate",()=>{
 const e={executable:true,reason:"healthy_stream_current_generation_price",validUntil:99_000},q={source:"oanda",at:0};
 assert.equal(fxReasonText(e,q.at,60_000),"");
 assert.equal(fxExecutable(e,q,60_000),true);
 assert.equal(fxExecutable(e,q,99_000),false);
 assert.match(fxReasonText(e,q.at,99_000),/health confirmation expired/);
 assert.equal(fxExecutable({...e,executable:false},q,60_000),false);
 assert.equal(fxExecutable(e,{...q,source:"mock"},60_000),false);
 assert.equal(fxExecutable(e,undefined,60_000),false);
 assert.equal(fxExecutable(e,{...q,at:60_001},60_000),false);
 assert.match(fxReasonText({executable:false,reason:"stream_unhealthy",validUntil:0},0,1),/heartbeat/);
 assert.match(fxReasonText({executable:false,reason:"missing_current_generation_quote_or_conversion",validUntil:0},0,1),/conversion/);
});
test("FX order gate does not fall through to Coinbase health, and real FX renders the shared chart",()=>{
 const ui=readFileSync("app/finance-client.tsx","utf8");
 assert.match(ui,/fresh=!marketClosed&&\(isFx\(symbol\)\?fxTradable:Boolean/);
 assert.match(ui,/fxTradable=isFx\(symbol\)&&fxLive\(symbol\)/);
 assert.doesNotMatch(ui,/clock-fxQ.at<=10_000|No forex chart yet|live quote within 10 seconds/);
 assert.match(ui,/<Chart symbol=\{symbol\} quote=\{isFx\(symbol\)\?fxChartQ:q\}/);
});
