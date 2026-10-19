import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
test("settings API strict schema accepts the shipped settings client's request metadata",()=>{
 const api=readFileSync(new URL("../app/api/settings/route.ts",import.meta.url),"utf8");
 const client=readFileSync(new URL("../app/settings-client.tsx",import.meta.url),"utf8");
 assert.match(client,/requestId:crypto.randomUUID\(\)/);
 assert.match(api,/requestId:z.string\(\).uuid\(\).optional\(\)/);
 assert.match(api,/requestAt:z.number\(\).int\(\).optional\(\)/);
 assert.ok(api.indexOf("if(receipt)")<api.indexOf("setTradingSettings(r,who,input.triggerInputMode)"));
 assert.match(api,/return publicRoom\(room,who\)/);
});
