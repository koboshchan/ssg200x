import test from "node:test";import assert from "node:assert/strict";import {fxReasonText} from "../app/fx-status";
test("expired executable forex quote never leaks the success code",()=>{
 const e={executable:true,reason:"fresh_live_USD_conversion",validUntil:10_000};
 assert.match(fxReasonText(e,5_000,10_000),/expired/);
 assert.match(fxReasonText(e,5_000,9_999+1),/expired/);
 assert.match(fxReasonText({...e,validUntil:99_000},0,10_001),/expired/);
 assert.equal(fxReasonText(e,9_000,9_500),"");
 assert.doesNotMatch(fxReasonText(e,0,20_000),/fresh_live/);
 assert.match(fxReasonText({executable:false,reason:"stale_quote_or_conversion",validUntil:0},0,1),/out of date/);
});
