import {test} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {once} from "node:events";
import {Server} from "socket.io";
import {io} from "socket.io-client";
import {readFileSync} from "node:fs";
import {createReleaseObserver,releaseId,serveRelease,attachReleaseHandshake,RELEASE_EVENT} from "../runtime/release.mjs";
const A="a".repeat(64),B="b".repeat(64);
test("stale cached bundle compares its baked-in release on FIRST response",()=>{
 const mismatches:string[]=[];const observe=createReleaseObserver(A,id=>mismatches.push(id));
 observe({release:B});assert.deepEqual(mismatches,[B]);
});
test("matching release is quiet, mismatches latch once across repeated/reordered replies",()=>{
 const mismatches:string[]=[];const observe=createReleaseObserver(A,id=>mismatches.push(id));
 for(const release of [A,A,B,B,A,B])observe({release});
 assert.deepEqual(mismatches,[B]);
});
test("invalid and failed release responses never request a refresh",()=>{
 let count=0;const observe=createReleaseObserver(A,()=>count++);
 for(const p of [null,{},A,{release:42},{release:""},{release:"<script>"},{release:"b".repeat(63)}]){
  assert.equal(releaseId(p),null);observe(p);
 }
 assert.equal(count,0);
});
test("public HTTP handshake is no-store, query-safe and read-only",async()=>{
 const http=createServer((req,res)=>{if(!serveRelease(req,res,A))res.writeHead(404).end();});
 http.listen(0,"127.0.0.1");await once(http,"listening");
 try{
  const url="http://127.0.0.1:"+(http.address() as any).port;
  const response=await fetch(url+"/api/release?fresh=1");
  assert.equal(response.status,200);assert.match(response.headers.get("cache-control")!,/no-store/);
  assert.deepEqual(await response.json(),{release:A});
  const head=await fetch(url+"/api/release",{method:"HEAD"});assert.equal(await head.text(),"");
  const post=await fetch(url+"/api/release",{method:"POST"});assert.equal(post.status,405);
  assert.equal((await fetch(url+"/api/release-other")).status,404);
 }finally{await new Promise<void>(r=>http.close(()=>r()));}
});
test("actual websocket connection and deployment reconnect each provide immutable server release",async()=>{
 const http=createServer(),server=new Server(http,{transports:["websocket"]});
 attachReleaseHandshake(server,A);http.listen(0,"127.0.0.1");await once(http,"listening");
 const client=io("http://127.0.0.1:"+(http.address() as any).port,{autoConnect:false,transports:["websocket"]});
 const mismatches:string[]=[];client.on(RELEASE_EVENT,createReleaseObserver(A,id=>mismatches.push(id)));
 try{
  const nextVersion=()=>new Promise<unknown[]>(resolve=>client.once(RELEASE_EVENT,payload=>resolve([payload])));
  let event=nextVersion();client.connect();assert.deepEqual((await event)[0],{release:A});assert.deepEqual(mismatches,[]);
  client.disconnect();server.removeAllListeners("connection");attachReleaseHandshake(server,B);
  event=nextVersion();client.connect();assert.deepEqual((await event)[0],{release:B});assert.deepEqual(mismatches,[B]);
  server.emit(RELEASE_EVENT,{release:B});await new Promise(r=>setTimeout(r,20));assert.equal(mismatches.length,1);
 }finally{client.disconnect();await new Promise<void>(r=>server.close(()=>r()));}
});
test("build embeds one immutable identifier and root checks it independently of sign-in",()=>{
 const config=readFileSync("next.config.ts","utf8"),build=readFileSync("scripts/build.mjs","utf8"),server=readFileSync("server.mjs","utf8"),layout=readFileSync("app/layout.tsx","utf8"),live=readFileSync("app/live-provider.tsx","utf8"),ui=readFileSync("app/release-provider.tsx","utf8");
 assert.match(config,/NEXT_PUBLIC_SSG_RELEASE: process.env.SSG_BUILD_RELEASE/);
 assert.match(config,/return process.env.SSG_BUILD_RELEASE/);
 assert.match(build,/createHash\("sha256"\)/);
 assert.match(server,/\.next\/BUILD_ID/);
 assert.match(server,/serveRelease\(request,response,release\)/);
 assert.match(server,/attachReleaseHandshake\(io,release\)/);
 assert.match(layout,/<ReleaseProvider><RoomClient/);
 assert.match(live,/socket.on\(RELEASE_EVENT,release.observe\)/);
 assert.match(live,/socket.on\("connect",\(\)=>\{receiver.clear\(\);latest.current.clear\(\);void release.check\(\)/);
 assert.match(ui,/window.location.reload\(\)/);
 assert.doesNotMatch(ui,/localStorage|sessionStorage|indexedDB|location.replace|router.refresh/);
});
