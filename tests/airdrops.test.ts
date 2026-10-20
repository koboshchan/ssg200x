import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {previewAirdrop,confirmAirdrop,AIRDROP_PREVIEW_TTL_MS} from "../lib/airdrops";
const who={id:"visitor",name:"Visitor",email:"v@example.test",admin:false};
test("public service entry points reject non-admin before any database access",async()=>{await assert.rejects(()=>previewAirdrop(who,{amount:"1"}),/Administrator/);await assert.rejects(()=>confirmAirdrop(who,{previewId:"bad",requestId:"bad"}),/Administrator/);});
test("preview time bound and endpoint retain server-owned identity and strict schemas",()=>{assert.equal(AIRDROP_PREVIEW_TTL_MS,300000);const route=readFileSync("app/api/airdrops/route.ts","utf8"),api=readFileSync("lib/api.ts","utf8");assert.match(route,/endpoint\(request/);assert.match(route,/who\.admin===true/);assert.equal((route.match(/\.strict\(\)/g)||[]).length,2);assert.match(api,/admin:user\.privateMetadata\?\.admin===true/);assert.match(api,/request\.headers\.get\("origin"\)/);});
