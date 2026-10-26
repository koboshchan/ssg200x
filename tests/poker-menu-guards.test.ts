import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const menu=readFileSync("app/poker-player-menu.tsx","utf8"),mod=readFileSync("app/use-poker-moderation.ts","utf8"),room=readFileSync("app/room-client.tsx","utf8");
test("admin kick confirms in-app before dispatching the event",()=>{
 assert.match(menu,/ConfirmDialog/);assert.doesNotMatch(menu,/window\.confirm/);
});
test("menu is fenced to its table and seat identity",()=>{assert.match(menu,/menu\.tableId===tableId&&room\.seats\[menu\.seat\]\?\.publicId===menu\.id/);});
test("one listener, per-table pending ids, stale response guard",()=>{
 assert.equal(room.split('addEventListener("poker-kick-request"').length-1,1);
 assert.match(room,/pendingKicks=useRef\(new Map/);
 assert.match(room,/table===currentTableRef\.current&&\(data\.pokerTableId\?\?table\)===table/);
 assert.doesNotMatch(mod,/fetch\(/);
});
test("vote gating matches backend",()=>{assert.match(mod,/!s\.ready&&!s\.sitOut/);assert.match(mod,/length<3/);assert.doesNotMatch(mod,/own\.ready/);});

test("shared post keeps blackjack table ids and scopes other paths to the poker table",async()=>{
  const src=readFileSync("app/room-client.tsx","utf8");
  assert.match(src,/buildPostBody\(path,body,tableRef\.current,Date\.now\(\)\)/);
  const {buildPostBody}=await import("../lib/post-body");
  assert.deepEqual(buildPostBody("/api/blackjack",{tableId:"b"},"02",1),{tableId:"b",requestAt:1});
  assert.deepEqual(buildPostBody("/api/action",{a:1},"02",1),{a:1,tableId:"02",requestAt:1});
  assert.deepEqual(buildPostBody("/api/admin",{a:1},"02",1),{a:1,requestAt:1});
});
