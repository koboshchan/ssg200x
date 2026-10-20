import {test} from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {resolve} from "node:path";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
const require=createRequire(import.meta.url);
// Reuse the installed browser QA tools; never install dependencies for this test.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"/home/kit/out/cal-browser-evidence/node_modules/playwright");
const {build}=require("esbuild");
test("real Wallet and LiveProvider coalesce events, preserve balance, and cancel bounded 429 recovery",async()=>{
 const temp=await mkdtemp(resolve(tmpdir(),"wallet-component-"));
 const bundle=await build({entryPoints:["tests/fixtures/wallet-live.tsx"],bundle:true,outdir:temp,write:false,format:"iife",platform:"browser",jsx:"automatic",loader:{".module.css":"empty"},plugins:[{name:"wallet-auth-socket",setup(b:any){
  b.onResolve({filter:/^@clerk\/nextjs$/},()=>({path:"auth",namespace:"mock"}));
  b.onLoad({filter:/.*/,namespace:"mock"},()=>({contents:"export function useAuth(){return {getToken:async()=> 'test'}}",loader:"js"}));
  b.onResolve({filter:/^socket.io-client$/},()=>({path:resolve("tests/fixtures/wallet-socket.ts")}));
 }}]});
 const browser=await chromium.launch({headless:true,channel:"chromium"});
 try{
  const page=await browser.newPage();await page.clock.install({time:new Date("2026-10-20T16:00:00Z")});
  let requests=0,mode="ok",release:(()=>void)|undefined;
  await page.route("http://wallet.test/**",async(route:any)=>{
   if(route.request().url().includes("/api/transfers")){requests++;if(mode==="slow")await new Promise<void>(resolve=>{release=resolve;});await route.fulfill({status:mode==="429"?429:200,headers:{"content-type":"application/json",...(mode==="429"?{"Retry-After":"2"}:{})},body:mode==="429"?'{"error":"Slow down"}':'{"transfers":[]}'});}
   else await route.fulfill({contentType:"text/html",body:'<div id="root"></div>'});
  });
  await page.goto("http://wallet.test");await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.waitForFunction(()=>Boolean((window as any).walletSocket));
  const room=(key:string,balance=10000)=>page.evaluate(({key,balance}:any)=>(window as any).walletSocket("room:state",{me:{wallet:balance,admin:false},transferHistoryKeys:{mine:key,all:key}}),{key,balance});
  await room("a");await page.clock.runFor(200);await page.waitForFunction(()=>document.body.textContent?.includes("No transfers yet"));
  assert.equal(requests,1);
  await page.evaluate(()=>{for(let i=0;i<80;i++){(window as any).walletSocket("market:update",{price:i});(window as any).walletSocket("room:state",{me:{wallet:10000+i,admin:false},transferHistoryKeys:{mine:"a",all:"a"}});}(window as any).walletHarness.mount();});
  await page.clock.runFor(1100);assert.equal(requests,1);
  assert.match(await page.locator("header").innerText(),/100.79/);
  for(let i=0;i<20;i++)await room("b"+i);
  await page.clock.runFor(200);await page.waitForTimeout(30);assert.equal(requests,2);
  mode="slow";await room("slow");await page.clock.runFor(200);await page.waitForTimeout(30);
  const inFlight=requests;assert.ok(release);
  for(let i=0;i<20;i++)await room("flight"+i);
  await page.clock.runFor(1000);assert.equal(requests,inFlight,"in-flight requests are deduplicated");
  mode="ok";release!();await page.waitForTimeout(30);await page.clock.runFor(200);await page.waitForTimeout(30);
  assert.equal(requests,inFlight+1,"one trailing refresh for a burst during loading");
  mode="429";await room("limited");await page.clock.runFor(200);await page.waitForFunction(()=>document.body.textContent?.includes("Slow down"));
  const before=requests;for(let i=0;i<20;i++)await room("cool"+i);
  await page.clock.runFor(1700);assert.equal(requests,before);
  mode="ok";await page.clock.runFor(500);await page.waitForFunction(()=>!document.body.textContent?.includes("Slow down"));assert.equal(requests,before+1);
  mode="429";await room("stop");await page.clock.runFor(200);await page.waitForFunction(()=>document.body.textContent?.includes("Slow down"));
  await page.clock.runFor(2100);await page.waitForTimeout(30);await page.clock.runFor(2100);await page.waitForTimeout(30);
  const stopped=requests;await page.clock.runFor(10000);assert.equal(requests,stopped,"no endless retries");
  await room("unmount");await page.evaluate(()=>(window as any).walletHarness.unmount());await page.clock.runFor(10000);assert.equal(requests,stopped);
 }finally{await browser.close();await rm(temp,{recursive:true,force:true});}
});
