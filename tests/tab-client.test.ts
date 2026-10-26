import {test} from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import {getTabHeaders} from "../lib/tab-identity";
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"/home/kit/out/cal-browser-evidence/node_modules/playwright");
const {build}=require("esbuild");

test("header generation is safe during SSR without creating a shared identity",()=>{
 assert.deepEqual(getTabHeaders(),{});
});

test("every client HTTP mutation carries the document identity",()=>{
 for(const file of ["app/room-client.tsx","app/settings-client.tsx","app/maintenance-gate.tsx","app/(room)/wallet/page.tsx"]){
  const source=readFileSync(file,"utf8"),mutations=source.match(/method:"POST"/g)||[],headers=source.match(/\.\.\.getTabHeaders\(\)/g)||[];
  assert.ok(mutations.length>0,file);
  assert.equal(headers.length,mutations.length,file);
 }
 assert.doesNotMatch(readFileSync("lib/tab-identity.ts","utf8"),/localStorage|sessionStorage|document\.cookie/);
});

test("mounted provider reports routes without reconnect, blocks accessibly, and retains only document-local identity",async()=>{
 const bundle=await build({stdin:{contents:`
 import React from "react";import {createRoot} from "react-dom/client";
 import ReleaseProvider from "./app/release-provider";
 import LiveProvider,{ConnectionBadge} from "./app/live-provider";import {getTabIdentity,getTabHeaders} from "./lib/tab-identity";
 const root=createRoot(document.getElementById("root"));
 window.harness={
  mount:()=>root.render(<ReleaseProvider><LiveProvider><ConnectionBadge/><button id="game">Game action</button></LiveProvider></ReleaseProvider>),
  unmount:()=>root.unmount(),identity:getTabIdentity,headers:getTabHeaders,
  navigate:(path)=>{history.pushState(null,"",path);window.dispatchEvent(new Event("popstate"));}
 };window.harness.mount();
 `,resolveDir:process.cwd(),loader:"tsx"},bundle:true,define:{"process.env.NEXT_PUBLIC_SSG_RELEASE":'"development"'},write:false,format:"iife",platform:"browser",jsx:"automatic",loader:{".css":"empty",".module.css":"empty"},plugins:[{name:"tab-client-fixtures",setup(b:any){
  b.onResolve({filter:/^@clerk\/nextjs$/},()=>({path:"auth",namespace:"fixture"}));
  b.onResolve({filter:/^next\/navigation$/},()=>({path:"navigation",namespace:"fixture"}));
  b.onResolve({filter:/^socket.io-client$/},()=>({path:"socket",namespace:"fixture"}));
  b.onLoad({filter:/auth/,namespace:"fixture"},()=>({contents:'export function useAuth(){return {getToken:async()=>"fresh-token"}}',loader:"js"}));
  b.onLoad({filter:/navigation/,namespace:"fixture"},()=>({contents:`
   import {useEffect,useState} from "react";
   export function usePathname(){const [path,setPath]=useState(location.pathname);useEffect(()=>{const update=()=>setPath(location.pathname);addEventListener("popstate",update);return()=>removeEventListener("popstate",update)},[]);return path;}
  `,loader:"js",resolveDir:process.cwd()}));
  b.onLoad({filter:/socket/,namespace:"fixture"},()=>({contents:`
   export function io(options){
    window.socketCount=(window.socketCount||0)+1;
    const handlers=new Map();const reports=[];const auths=[];
    const socket={connected:true,active:true,on(event,handler){handlers.set(event,handler);return socket;},
     off(event,handler){if(handlers.get(event)===handler)handlers.delete(event);return socket;},
     io:{on(){}},emit(event,payload,ack){reports.push({event,payload});if(event==="tab:report"&&typeof ack==="function"&&!window.noLeaseAck)ack({ok:true,leaseTtlMs:16000});return socket;},
     disconnect(){socket.connected=false;},timeout(){return socket;},connect(){}};
    window.testSocket={reports,auths,state:(payload)=>handlers.get("tab:state")(payload),
     refresh:()=>handlers.get("auth:refresh")({expiresAt:Date.now()+20000}),
     auth:()=>new Promise(resolve=>options.auth(payload=>{auths.push(payload);resolve(payload)})),
     disconnect:()=>{socket.connected=false;handlers.get("disconnect")()},
     connect:()=>{socket.connected=true;handlers.get("connect")()}};
    queueMicrotask(()=>{window.testSocket.auth();handlers.get("connect")()});
    return socket;
   }
  `,loader:"js",resolveDir:process.cwd()}));
 }}]});
 const browser=await chromium.launch({headless:true,channel:"chromium"});
 const context=await browser.newContext();
 try{
  const errors:string[]=[];
  const open=async()=>{
   const page=await context.newPage();page.on("pageerror",(e:Error)=>errors.push(e.message));
   await page.clock.install();
   await page.route("https://tab.test/**",(route:any)=>route.fulfill({contentType:"text/html",body:'<!doctype html><meta charset="utf-8"><div id="root"></div>'}));
   await page.goto("https://tab.test/poker");await page.addScriptTag({content:bundle.outputFiles[0].text});
   await page.waitForFunction(()=>Boolean((window as any).testSocket?.auths.length));
   return page;
  };
  const page=await open();
  const identity=await page.evaluate(()=>(window as any).harness.identity());
  assert.match(identity.tabId,/^[0-9a-f-]{36}$/);assert.match(identity.tabProof,/^[0-9a-f-]{36}$/);
  assert.notEqual(identity.tabId,identity.tabProof);
  assert.deepEqual(await page.evaluate(()=>(window as any).testSocket.auths[0]),{token:"fresh-token",...identity,route:"/poker",pokerTableId:"01"});
  assert.deepEqual(await page.evaluate(()=>(window as any).harness.headers()),{"X-Tab-Id":identity.tabId,"X-Tab-Proof":identity.tabProof});
  const reports=()=>page.evaluate(()=>(window as any).testSocket.reports.filter((r:any)=>r.event==="tab:report"));
  assert.equal((await reports()).at(-1).payload.route,"/poker");
  await page.evaluate(()=>(window as any).harness.navigate("/roulette"));
  await page.waitForFunction(()=>(window as any).testSocket.reports.at(-1).payload.route==="/roulette");
  assert.equal(await page.evaluate(()=>(window as any).socketCount),1);
  await page.evaluate(()=>(window as any).testSocket.refresh());
  await page.waitForFunction(()=>(window as any).testSocket.reports.some((r:any)=>r.event==="auth:renew"));
  assert.equal(await page.evaluate(()=>(window as any).socketCount),1,"token renewal never recreates the socket");
  assert.equal(await page.evaluate(()=>(window as any).testSocket.reports.find((r:any)=>r.event==="auth:renew").payload.token),"fresh-token");
  const before=(await reports()).length;await page.clock.runFor(10000);assert.equal((await reports()).length,before+2);
  await page.evaluate(()=>{document.dispatchEvent(new Event("visibilitychange"));window.dispatchEvent(new Event("pageshow"));});
  assert.equal((await reports()).length,before+4);
  assert.deepEqual(await page.evaluate(()=>(window as any).testSocket.auth()),{token:"fresh-token",...identity,route:"/roulette",pokerTableId:"01"});

  await page.locator("#game").focus();
  await page.evaluate(()=>(window as any).testSocket.state({blocked:true,tabs:2}));
  const dialog=page.getByRole("dialog",{name:"Only one tab is allowed."});
  await dialog.waitFor();assert.equal(await dialog.getAttribute("aria-describedby"),"tab-blocked-description");
  assert.equal(await page.evaluate(()=>Boolean(document.querySelector("dialog:modal"))),true);
  await page.keyboard.press("Escape");assert.equal(await dialog.isVisible(),true);
  await page.locator("#game").evaluate((el:HTMLElement)=>el.focus());
  assert.notEqual(await page.evaluate(()=>document.activeElement?.id),"game","background is inert to keyboard focus");
  await page.evaluate(()=>(window as any).testSocket.state({blocked:false,tabs:"bad"}));
  assert.equal(await dialog.isVisible(),true,"malformed state does not unlock");
  await page.evaluate(()=>(window as any).testSocket.disconnect());assert.equal(await dialog.isVisible(),true,"disconnect does not bypass block");
  await page.evaluate(()=>(window as any).testSocket.connect());
  await page.evaluate(()=>(window as any).testSocket.state({blocked:false,tabs:1}));
  await dialog.waitFor({state:"detached"});assert.equal(await page.locator("#game").isEnabled(),true);
  assert.deepEqual(await page.evaluate(()=>(window as any).harness.identity()),identity);
  // Action readiness needs an accepted tab:report ack on the CURRENT connection, not just an open transport.
  const state=()=>page.locator(".connection-status").getAttribute("data-state");
  assert.equal(await state(),"connected","acked connection is ready");
  await page.evaluate(()=>{(window as any).noLeaseAck=true;(window as any).testSocket.disconnect();(window as any).testSocket.connect();});
  assert.equal(await state(),"connecting","transport open without ack is not action-ready");
  await page.clock.runFor(4000);assert.equal(await state(),"connecting","still not ready without an ack");
  await page.evaluate(()=>{(window as any).noLeaseAck=false;document.dispatchEvent(new Event("visibilitychange"));});
  assert.equal(await state(),"connected","first valid ack makes it ready");

  const isolated=await context.newPage();
  await isolated.route("https://identity.test/**",(route:any)=>route.fulfill({contentType:"text/html",body:"<!doctype html><meta charset=utf-8>"}));
  await isolated.goto("https://identity.test");
  const identityBundle=await build({entryPoints:["lib/tab-identity.ts"],bundle:true,define:{"process.env.NEXT_PUBLIC_SSG_RELEASE":'"development"'},write:false,format:"iife",globalName:"tabIdentity",platform:"browser"});
  await isolated.addScriptTag({content:identityBundle.outputFiles[0].text});
  await isolated.evaluate(()=>{Object.defineProperty(window,"crypto",{value:undefined,configurable:true});});
  assert.deepEqual(await isolated.evaluate(()=>(window as any).tabIdentity.getTabHeaders()),{});
  await isolated.reload();await isolated.addScriptTag({content:identityBundle.outputFiles[0].text});
  await isolated.evaluate(()=>{Object.defineProperty(crypto,"randomUUID",{value:undefined,configurable:true});});
  const fallback=await isolated.evaluate(()=>(window as any).tabIdentity.getTabHeaders());
  assert.match(fallback["X-Tab-Id"],/^[0-9a-f-]{14}4[0-9a-f-]{21}$/);
  assert.notEqual(fallback["X-Tab-Id"],fallback["X-Tab-Proof"]);
  await isolated.close();
  const other=await open();
  const otherIdentity=await other.evaluate(()=>(window as any).harness.identity());
  assert.notEqual(otherIdentity.tabId,identity.tabId);assert.notEqual(otherIdentity.tabProof,identity.tabProof);
  await page.reload();await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.waitForFunction(()=>Boolean((window as any).testSocket?.auths.length));
  assert.notEqual((await page.evaluate(()=>(window as any).harness.identity())).tabId,identity.tabId);
  await page.evaluate(()=>(window as any).harness.unmount());
  const stopped=(await reports()).length;
  await page.clock.runFor(10000);
  await page.evaluate(()=>{document.dispatchEvent(new Event("visibilitychange"));window.dispatchEvent(new Event("pageshow"));});
  assert.equal((await reports()).length,stopped,"unmount removes all heartbeat and lifecycle listeners");
  assert.deepEqual(errors,[]);
 }finally{await context.close();await browser.close();}
});
