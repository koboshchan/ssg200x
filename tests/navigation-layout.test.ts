import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(p:string)=>readFileSync(p,"utf8");
test("only root owns the shared room shell across game and public route segments",()=>{
 assert.match(read("app/layout.tsx"),/<body data-qa-chart-fixture=\{fixtureMode\(\)\?"true":undefined\}><QaFixtureProvider enabled=\{fixtureMode\(\)\}><ReleaseProvider><RoomClient configured=\{configured\(\)\}>\{children\}<\/RoomClient><\/ReleaseProvider><\/QaFixtureProvider><\/body>/);
 assert.doesNotMatch(read("app/(room)/layout.tsx"),/RoomClient|LiveProvider|ChatDock/);
 assert.doesNotMatch(read("app/leaderboard/page.tsx"),/RoomClient|LiveProvider|ChatDock/);
});
test("internal navigation uses the Next router while external chart attribution is untouched",()=>{
 const client=read("app/room-client.tsx");
 assert.match(client,/import Link from "next\/link"/);
 assert.match(client,/<Link key=\{r.href\} href=\{r.href\}/);
 assert.match(client,/<Link className="gear" href="\/settings"/);
 assert.doesNotMatch(client,/<a\s/);
 for(const path of ["privacy","terms"])assert.match(read(`app/${path}/page.tsx`),/<Link href="\/">/);
 assert.match(read("app/cached-chart.tsx"),/<a href="https:\/\/klinecharts.com\/" target="_blank" rel="noopener noreferrer"/);
});
test("authenticated account boundary resets socket and chat but is never keyed by pathname",()=>{
 const client=read("app/room-client.tsx");
 assert.match(client,/<LiveProvider key=\{user.id\}><GameChatProvider><SignedInShell>[\s\S]*?<\/SignedInShell><\/GameChatProvider><\/LiveProvider>/);
 assert.match(client,/\{children\}<ChatGate\/>/);
 assert.match(client,/features.chat&&\(features.tableTalk\|\|features.dms\)\?<ChatDock\/>/);
 assert.doesNotMatch(client,/key=\{(?:path|pathname)\}/);
 assert.match(client,/signedOut&&path!=="\/"&&!isPublicPage\(path\)/);
 assert.match(client,/path==="\/leaderboard"\|\|path==="\/privacy"\|\|path==="\/terms"/);
});
