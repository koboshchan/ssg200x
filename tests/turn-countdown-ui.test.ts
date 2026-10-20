import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import Blackjack from "../app/blackjack-client";
import {freshRoom,register} from "../lib/poker";
import {blackjackTablesAction} from "../lib/blackjack";
import {publicRoom} from "../lib/public";
const actor={id:"actor",name:"Alice",email:"a@test",admin:false};
const viewer={id:"viewer",name:"Viewer",email:"v@test",admin:false};
function render(now:number,who=viewer){
 const r=freshRoom();register(r,actor,0);register(r,viewer,0);
 blackjackTablesAction(r,actor,{tableId:"lounge",type:"join",seat:0},0);
 const b=r.blackjackTables!.tables.lounge!;
 b.phase="playing";b.round=1;b.turn=0;b.hand=0;b.deadline=100000;
 b.seats[0]!.hands=[{cards:["8s","3h"],bet:100,done:false,split:false,payout:0}];
 const room={...publicRoom(r,who),serverNow:now};
 const html=renderToStaticMarkup(createElement(Blackjack,{room,busy:false,post:async()=>{}}));
 return html.match(/<p class="table-message" role="status">(.*?)<\/p>/)![1].replaceAll("<!-- -->","");
}
test("actual blackjack status renders the same late countdown for actor and spectator",()=>{
 for(const who of [actor,viewer]){
  assert.equal(render(0,who),"Alice to act");
  assert.equal(render(69999,who),"Alice to act");
  assert.equal(render(70000,who),"Alice to act · 30s");
  assert.equal(render(71000,who),"Alice to act · 29s");
  assert.equal(render(100000,who),"Alice to act · 0s");
 }
});
test("poker and blackjack use one shared threshold and server clock rather than recomputed wall offsets",()=>{
 for(const path of ["app/room-client.tsx","app/blackjack-client.tsx"]){
  const source=readFileSync(new URL("../"+path,import.meta.url),"utf8");
  assert.match(source,/import \{turnCountdown\} from "@\/lib\/turn-timer"/);
  assert.match(source,/useServerClock\(room\??\.serverNow/);
  assert.match(source,/===null\?"":" · "\+/);
  assert.doesNotMatch(source,/serverNow-Date\.now\(\)/);
 }
 const hook=readFileSync(new URL("../app/use-server-clock.ts",import.meta.url),"utf8");
 assert.match(hook,/serverClock\(serverNow,received,performance\.now\(\)\)/);
 assert.match(hook,/clearInterval\(timer\)/);
});
