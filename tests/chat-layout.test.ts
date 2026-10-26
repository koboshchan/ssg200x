import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const ui=readFileSync("app/chat-dock.tsx","utf8");
const css=readFileSync("app/globals.css","utf8");
test("chat mobile layout follows visual viewport and cleans listeners",()=>{
 assert.match(ui,/window.visualViewport/);
 assert.match(ui,/removeEventListener\("resize",resize\)/);
 assert.match(ui,/removeEventListener\("scroll",resize\)/);
 assert.match(css,/height:var\(--chat-viewport-height,100dvh\)/);
 assert.match(css,/min-height:44px;min-width:44px/);
 assert.match(css,/safe-area-inset-bottom/);
 assert.match(css,/\.chat-list\{min-height:0\}/);
});
test("chat preferences are scoped by account and initial history is not unread",()=>{
 assert.match(ui,/"tabletalk:"\+userId/);
 assert.match(ui,/seen!==null&&m.serverTs>seen/);
 assert.match(ui,/if\(open\|\|seen===null\)/);
});
test("progress paint is contained below the sticky navigation",()=>{
 assert.match(css,/\.game-main\{position:relative;isolation:isolate;z-index:0\}/);
 assert.match(css,/\.history-progress\{position:relative;isolation:isolate;z-index:0\}/);
 assert.match(css,/\.mast\{position:sticky;top:0;z-index:20/);
});
test("signed-in leaderboard uses shared authenticated shell including chat",()=>{
 const page=readFileSync("app/leaderboard/page.tsx","utf8");
 assert.doesNotMatch(page,/RoomClient|LiveProvider|ChatDock/);
 const root=readFileSync("app/layout.tsx","utf8");
 assert.match(root,/<RoomClient configured=\{configured\(\)\}>\{children\}<\/RoomClient>/);
});

test("chat omits the Security keys disclosure without removing changed-key approval warnings",()=>{
 assert.doesNotMatch(ui,/<details[^>]*className="chat-safety"|<summary>Security keys<\/summary>/);
 assert.match(ui,/changed=snap.members.filter\(m=>m.changed\)/);
 assert.match(ui,/client.trust\(m.userId,m.fingerprint\)/);
 assert.match(ui,/Hidden: sent with an untrusted key/);
});
test("failed own messages offer plain Remove and Retry, never a posted-message delete control",()=>{
 assert.match(ui,/m.mine&&m.status==="failed"&&<small className="chat-error">Not sent\./);
 assert.match(ui,/<button type="button" onClick=\{\(\)=>client.retry\(m\)\}>Retry<\/button>/);
 assert.match(ui,/<button type="button" onClick=\{\(\)=>client.dismiss\(m\)\}>Remove<\/button>/);
 assert.doesNotMatch(ui,/>Discard<\/button>/);
});
test("phone chat button is a bottom bar and the page scrolls above it",()=>{
 const m=css.match(/@media\(max-width:760px\)\{[\s\S]*?\n\}/);
 assert.ok(m,"phone block");
 assert.match(m[0],/html:has\(\.chat-toggle\) body\{height:calc\(100dvh - 46px - env\(safe-area-inset-bottom\)\);min-height:0;overflow-y:auto/);
 assert.match(m[0],/\.chat-toggle\{left:0;right:0;bottom:0;width:auto;height:calc\(46px \+ env\(safe-area-inset-bottom\)\)/);
});
test("game chat follows the active context over one transport with scoped hints and paced requests",()=>{
 assert.match(ui,/\},\[isLoaded,userId,live.request\]\)/);
 assert.match(ui,/game-chat:subscribe/);
 assert.match(ui,/game-chat:leave/);
 assert.match(ui,/createPacer\(\)/);
 assert.match(ui,/chatRoomOf\.current\.get\(gameKey\)===room\)gameClient\?\.hint\(\)/);
 assert.doesNotMatch(ui,/client\?\.hint\(\);gameClient\?\.hint\(\)/);
 assert.match(ui,/drafts\.get\(draftKey\)/);
 assert.match(ui,/room_closed/);
});
test("dense poker tables keep the stadium felt and ring seats, centred board, no grid on any width",()=>{
 assert.match(css,/\.felt-wrapper\.dense \.board\{inset:auto 0;top:50%;transform:translateY\(-50%\)\}/);
 assert.match(css,/@media\(max-width:760px\)\{\.felt-wrapper\.dense\{height:var\(--mh\)\}/);
 assert.doesNotMatch(css,/felt-wrapper\.dense\{[^}]*display:grid/);
 assert.doesNotMatch(css,/flow-grid|Keep complete player units in flow/);
});
