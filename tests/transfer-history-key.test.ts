import {test} from "node:test";
import assert from "node:assert/strict";
import {transferHistoryKey} from "../lib/transfer-history-key";
import {retryAfterMs} from "../lib/transfer-history-refresh";
test("transfer signals ignore trading activity but preserve repeated payments and admin all-user changes",()=>{
 const m={publicId:"a",adjustments:0,activity:["Sent $1.00 to B"]};
 assert.equal(transferHistoryKey([m]),transferHistoryKey([{...m,activity:["Bought BTC",...m.activity]}]));
 assert.notEqual(transferHistoryKey([m]),transferHistoryKey([{...m,adjustments:-100}]));
 assert.notEqual(transferHistoryKey([{...m,name:"Before"}]),transferHistoryKey([{...m,name:"After"}]));
 const b={publicId:"b",adjustments:0,activity:[]};
 assert.notEqual(transferHistoryKey([m,b]),transferHistoryKey([m,{...b,adjustments:100,activity:["Airdrop +$1.00"]}]));
 assert.equal(transferHistoryKey([m,b]),transferHistoryKey([b,m]));
});
test("Retry-After supports seconds, HTTP dates and conservative invalid fallback",()=>{
 const now=Date.parse("2026-10-20T16:00:00Z");
 assert.equal(retryAfterMs("2",now),2000);
 assert.equal(retryAfterMs("Tue, 20 Oct 2026 16:01:00 GMT",now),60000);
 assert.equal(retryAfterMs("invalid",now),60000);
 assert.equal(retryAfterMs(null,now),60000);
 assert.equal(retryAfterMs("-1",now),1000);
});
