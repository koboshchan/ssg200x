import {test} from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import {buildSync} from "esbuild";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import type {PublicRoom} from "../lib/public";

// Compile the actual client module with CSS omitted, without starting a test server.
const result=buildSync({entryPoints:[new URL("../app/players-list.tsx",import.meta.url).pathname],bundle:true,platform:"node",format:"cjs",packages:"external",loader:{".module.css":"empty"},write:false});
const compiled={exports:{} as any};
new Function("require","module","exports",result.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports);
const {visiblePlayers,groupPlayerReports,default:PlayersList}=compiled.exports;
type User=PublicRoom["adminUsers"][number];
const user=(publicId:string,name:string,wallet:number,netWorth=wallet):User=>({publicId,name,wallet,netWorth,approved:true,holdings:[],positions:[]});
const users=[user("a","Alpha",100,900),user("b","beta",300,300),user("c","Charlie",200,500)];
test("searches usernames, trims whitespace, supports all four sorts without mutating live data",()=>{
 assert.deepEqual(visiblePlayers(users," ALP ","wallet-desc").map((u:User)=>u.publicId),["a"]);
 for(const [sort,ids] of [["wallet-desc",["b","c","a"]],["wallet-asc",["a","c","b"]],["worth-desc",["a","c","b"]],["worth-asc",["b","c","a"]]] as const){
  assert.deepEqual(visiblePlayers(users,"",sort).map((u:User)=>u.publicId),ids);
 }
 assert.deepEqual(users.map(u=>u.publicId),["a","b","c"]);
 assert.deepEqual(visiblePlayers(users,"nobody","wallet-desc"),[]);
});
test("equal balances sort deterministically by username and public id",()=>{
 const values=[user("b","Same",100),user("a","Same",100),user("z","Alpha",100)];
 assert.deepEqual(visiblePlayers(values,"","wallet-desc").map((u:User)=>u.publicId),["z","a","b"]);
});
test("reports use real public-id audit ownership, deduplicate and omit unknown accounts",()=>{
 const records=[{id:"1",publicId:"a",at:1,draw:{action:"bet"}},{id:"2",publicId:"b",at:2,draw:{action:"deal"}},{id:"1",publicId:"a",at:1,draw:{}},{id:"3",publicId:null,at:3,draw:{}}];
 const grouped=groupPlayerReports(records);
 assert.equal(grouped.size,2);assert.equal(grouped.get("a").length,1);assert.equal(grouped.get("b")[0].id,"2");assert.equal(grouped.has(null),false);
 assert.equal(groupPlayerReports([]).size,0);
});
test("renders compact player rows with escaped names, details, search and sort, without invented badges",()=>{
 const html=renderToStaticMarkup(createElement(PlayersList,{users:[user("safe","<script>bad</script>",100)],busy:false,post:async()=>{},onRefresh:async()=>{}}));
 assert.ok(html.includes("&lt;script&gt;bad&lt;/script&gt;"));assert.ok(!html.includes("<script>bad"));
 assert.ok(html.includes('type="search"'));assert.ok(html.includes("Net worth"));assert.ok(html.includes("Holdings &amp; position details"));
 assert.ok(html.includes("No spot holdings."));assert.ok(html.includes("No open positions."));
 assert.ok(!html.includes('aria-haspopup="dialog"'));assert.ok(html.includes("Reports not loaded")===false);assert.ok(html.includes("Updating reports"));
});
test("report requests are existing authenticated admin reads; refresh includes balances and cleanup aborts",()=>{
 const source=readFileSync(new URL("../app/players-list.tsx",import.meta.url),"utf8");
 assert.match(source,/\/api\/admin\/possible-alts/);assert.match(source,/\/api\/admin\/blackjack-audit/);
 assert.match(source,/Promise\.all/);assert.match(source,/controller\.abort\(\)/);assert.match(source,/refreshRoom.current\(controller.signal\)/);
 assert.match(source,/latest 100 audit records/);assert.match(source,/Tab and off-page rejections are not recorded/);
 const room=readFileSync(new URL("../app/room-client.tsx",import.meta.url),"utf8");
 assert.match(room,/<LimitsControls/);assert.match(room,/<RiskControls/);assert.ok(!room.includes("<PossibleAlts"));
 const audit=readFileSync(new URL("../lib/blackjack-audit.ts",import.meta.url),"utf8");
 assert.match(audit,/ensure\(who.admin/);assert.match(audit,/\.limit\(100\)/);
});
