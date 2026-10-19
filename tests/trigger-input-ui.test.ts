import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const fin=readFileSync("app/finance-client.tsx","utf8"),set=readFileSync("app/settings-client.tsx","utf8");
test("open form and editor send the active mode fields with assertion",()=>{
 assert.ok(fin.includes("takeProfitPnl:cents(takeProfit)")&&fin.includes("stopLossPnl:cents(stopLoss)"));
 assert.ok(fin.includes('triggerInputMode:tmode'));assert.ok(fin.includes('takeProfitPnl:tp?cents(tp):null'));
 assert.ok(fin.includes("room.me.triggerInputMode"));
});
test("settings page posts mode with request id and time",()=>{
 assert.ok(set.includes('"/api/settings"')&&set.includes("requestId:crypto.randomUUID()")&&set.includes("requestAt:Date.now()"));
});
