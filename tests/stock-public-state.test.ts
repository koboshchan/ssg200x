import {test} from "node:test";
import assert from "node:assert/strict";
import {freshRoom} from "../lib/poker";
import {publicStockState} from "../lib/stock-room-policy";
test("public stock state never executes a mismatched cached mark or leaks raw provider state",()=>{
 const r=freshRoom(),now=Date.parse("2026-10-19T15:00:00Z");
 r.stockExecution={AAPL:{symbol:"AAPL",leaseUntil:now+10000,connected:true,leader:true,authorized:true,halt:"clear",corporateActionsReconciled:true,tick:{symbol:"AAPL",price:200,timestamp:now-100,receivedAt:now,feed:"alpaca-iex"},clock:{timestamp:now,receivedAt:now,isOpen:true,nextOpen:now+86400000,nextClose:Date.parse("2026-10-19T20:00:00Z")},sessions:[{date:"2026-10-19",open:Date.parse("2026-10-19T13:30:00Z"),close:Date.parse("2026-10-19T20:00:00Z")}]}};
 r.quotes={AAPL:{micro:201_000_000,at:now-100}};
 assert.equal(publicStockState(r,now).AAPL.executable,false);
 r.quotes.AAPL!.micro=200_000_000;
 const status=publicStockState(r,now);
 assert.equal(status.AAPL.executable,true);
 assert.equal(Object.keys(status).length,6);
 assert.deepEqual(Object.keys(status.AAPL).sort(),["checkedAt","executable","reason","validUntil"]);
 assert.equal(publicStockState(r,now+10000).AAPL.executable,false);
});
