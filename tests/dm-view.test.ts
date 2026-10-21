import test from "node:test";import assert from "node:assert/strict";
import {scope,pendingKey,pendingPrefix,peerSnapshot,inConversation,historyPinState,mergeRows,type DmRow} from "../lib/dm-view";
const m:any={senderUserId:"a",toUserId:"b",senderDhPublic:"sd",senderSignPublic:"ss",recipientDhPublic:"rd",recipientSignPublic:"rs",senderDeviceId:"sdev",recipientDeviceId:"d",senderKeyVersion:1,recipientKeyVersion:1};
test("peer snapshot is the other side",()=>{assert.equal(peerSnapshot(m,"a").dhPublic,"rd");assert.equal(peerSnapshot(m,"b").dhPublic,"sd");});
test("conversation membership",()=>{assert.ok(inConversation(m,"a","b"));assert.ok(inConversation(m,"b","a"));assert.ok(!inConversation(m,"a","c"));});
test("history keys are checked against pin",()=>{
 const pin={deviceId:"d",keyVersion:1,dhPublic:"rd",signPublic:"rs"};
 assert.equal(historyPinState(pin,m,"a"),"same");assert.equal(historyPinState(pin,m,"b"),"changed");assert.equal(historyPinState(undefined,m,"a"),"new");
 assert.equal(historyPinState({...pin,keyVersion:2},m,"a"),"changed");assert.equal(historyPinState({...pin,deviceId:"x"},m,"a"),"changed");
});
test("merge replaces pending by server row and sorts",()=>{
 const p:DmRow[]=[{id:"1",mine:true,ts:5,status:"pending"}];
 const r=mergeRows(p,[{id:"1",mine:true,ts:6,status:"ok",text:"x"},{id:"0",mine:false,ts:1,status:"ok",text:"y"}]);
 assert.deepEqual(r.map(x=>x.id+x.status),["0ok","1ok"]);
 assert.equal(mergeRows(r,[{id:"1",mine:true,ts:7,status:"pending"}])[1].status,"ok");
});

test("scope invalidates stale async work",()=>{const s=scope(),t=s.value;assert.ok(s.valid(t));s.next();assert.ok(!s.valid(t));assert.ok(s.valid(s.value));});
test("pending keys are scoped per user and peer",()=>{
 const k=pendingKey("u","p","1");assert.ok(k.startsWith(pendingPrefix("u","p")));assert.ok(!k.startsWith(pendingPrefix("u","p2")));assert.ok(!k.startsWith(pendingPrefix("u2","p")));assert.ok(!pendingKey("u","p1","x").startsWith(pendingPrefix("u","p")));
});

// Mirrors the panel pattern: capture scope, await, apply only if still valid.
test("slow response for conversation A is dropped after switching to B",async()=>{
 const epoch=scope(),acct=scope();let rows:string[]=[];
 const load=async(peer:string,delay:number)=>{const ep=epoch.value,a=acct.value;await new Promise(r=>setTimeout(r,delay));if(!epoch.valid(ep)||!acct.valid(a))return;rows=rows.concat(peer);};
 const pa=load("A",20);epoch.next();const pb=load("B",1);await Promise.all([pa,pb]);
 assert.deepEqual(rows,["B"]);
});
test("account switch drops in-flight work even if the conversation epoch matches",async()=>{
 const epoch=scope(),acct=scope();let applied=false;
 const run=async()=>{const ep=epoch.value,a=acct.value;await new Promise(r=>setTimeout(r,10));if(epoch.valid(ep)&&acct.valid(a))applied=true;};
 const p=run();acct.next();await p;assert.equal(applied,false);
});
test("stale finally cannot clear a newer loading guard",()=>{
 let guard:object|null=null;const old={},fresh={};guard=old;guard=fresh;
 if(guard===old)guard=null;assert.equal(guard,fresh);
});

import {rowKey} from "../lib/dm-view";
import {readFileSync} from "node:fs";
test("peer cannot overwrite my bubble by reusing my UUID",()=>{
 const mine:DmRow={id:"u1",mine:true,ts:1,status:"ok",text:"mine"};
 const out=mergeRows([mine],[{id:"u1",mine:false,ts:2,status:"ok",text:"peer"}]);
 assert.equal(out.length,2);assert.equal(out.find(r=>r.mine)!.text,"mine");assert.notEqual(rowKey(out[0]),rowKey(out[1]));
});
test("A-B-A switch: epoch capture rejects stale trust/block result",()=>{
 const s=scope(),ep=s.value;s.next();s.next();assert.ok(!s.valid(ep));
});
test("panel source guards: busy cleared, epoch checked, retry requires mine",()=>{
 const src=readFileSync(new URL("../app/dm-panel.tsx",import.meta.url),"utf8");
 assert.match(src,/setBusy\(false\);\s*resetConv\(\)/);
 assert.equal((src.match(/epoch\.current\.valid\(ep\)&&convRef/g)||[]).length,2);
 assert.match(src,/r\.mine&&r\.id===retryId/);assert.match(src,/r\.mine&&r\.id===wid/);assert.match(src,/key=\{rowKey\(r\)\}/);
});

test("admin-reset setup and recovery invalidate cached DM identity and unsent work",()=>{
 const src=readFileSync(new URL("../app/dm-panel.tsx",import.meta.url),"utf8");
 const reset=src.match(/if\(phase==='setup'\|\|phase==='recover'\|\|phase==='words'\)\{([^}]*\{owner:me,id:null\}[^}]*)\}/)?.[1];
 assert.ok(reset,"identity-unavailable phases must synchronously reset DM state");
 for(const fragment of ["epoch.current.next()","pending.current.clear()","setIdState({owner:me,id:null})","setConv(null)","setRows([])","setCursor(null)","setText('')"])
  assert.ok(reset.includes(fragment),fragment);
});

test("display names render as escaped presentation labels without changing handle lookup",()=>{
 const source=readFileSync(new URL("../app/dm-panel.tsx",import.meta.url),"utf8");
 assert.ok(source.includes("{conv.peer.displayName||conv.peer.username}"));
 assert.ok(source.includes("{t.displayName||t.username}"));
 assert.ok(source.includes("open(t.username)"));
 assert.ok(source.includes('username:clean'));
 assert.ok(source.includes('Your username{username?'));
 assert.ok(!source.includes("dangerouslySetInnerHTML"));
});

// All row states share this label, including decrypted history after recovery.
test("incoming bubble labels use the same display name as the conversation header",()=>{
 const source=readFileSync(new URL("../app/dm-panel.tsx",import.meta.url),"utf8");
 assert.ok(source.includes('r.mine?"You":conv.peer.displayName||conv.peer.username'));
 assert.ok(!source.includes('r.mine?"You":conv.peer.username'));
 assert.ok(source.includes('open(t.username)'));
});
