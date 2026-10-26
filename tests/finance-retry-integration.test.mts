import test,{mock,after} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createRequire} from "node:module";
import {mkdirSync,writeFileSync} from "node:fs";
import {AppError} from "../lib/errors";
import {freshRoom,register} from "../lib/poker";
import {db,readRoom,closeDatabase} from "../lib/db";
import {mutate} from "../lib/store";
import {checkFinanceRequest,recordFinanceRequest,reconcileFinanceRequest} from "../lib/finance-requests";
import type {Room} from "../lib/types";
if(!process.env.MONGODB_DB?.startsWith("fakebucks_test_retry"))throw Error("Requires isolated test DB");
const who={id:"owner",name:"Owner",email:"owner@test",admin:false};
mock.module("../lib/api.ts",{namedExports:{
 endpoint:async(_r:Request,handler:Function)=>{try{return Response.json(await handler(who));}catch(e){return Response.json({error:(e as Error).message},{status:e instanceof AppError?e.status:400});}},
 parse:async(r:Request,schema:any)=>schema.parse(await r.json())
}});
mock.module("../lib/public.ts",{namedExports:{freshPublicRoom:async(r:Room)=>structuredClone(r)}});
const {POST}=await import("../app/api/finance/route");
const {POST:STATUS}=await import("../app/api/finance/status/route");
const req=(body:object)=>new Request("https://test.invalid/api/finance",{method:"POST",body:JSON.stringify(body)});
// Match the current default 300/100 fee contract and a healthy generation-bound quote.
const input=()=>({type:"open",symbol:"BTC",side:"long",margin:10000,leverage:5,expectedOpeningFeePpm:300,expectedClosingFeePpm:100,requestAt:Date.now(),requestId:randomUUID()});
async function setup(){const r=freshRoom();register(r,who);r.quotes={BTC:{cryptoGeneration:"retry-fixture",micro:100000000,at:Date.now()}};r.cryptoStatus={connected:true,heartbeatSubscribed:true,generation:"retry-fixture",lastMessage:Date.now(),leaseUntil:Date.now()+10000};await(await db()).collection<Room>("rooms").replaceOne({_id:"main"},r,{upsert:true});}
after(async()=>{await(await db()).dropDatabase();await closeDatabase();});
test("real Mongo CAS concurrent original-key execution charges once and persists fingerprint through DB reconnect",async()=>{
 await setup();const body=input();
 const responses=await Promise.all(Array.from({length:6},()=>POST(req(body))));assert.ok(responses.every(r=>r.status===200));
 await closeDatabase();const room=await readRoom();assert.equal(room.members[0].positions!.length,1);assert.equal(room.members[0].wallet,90000);assert.equal(room.house,15);
 assert.equal((await POST(req({...body,margin:20000}))).status,409);
 assert.equal((await STATUS(req(body))).status,200);assert.equal((await readRoom()).members[0].positions!.length,1);
});
test("real Mongo cancellation fence beats an old CAS snapshot; inverse ordering reports committed",async()=>{
 await setup();const body=input();let release!:()=>void,started!:()=>void;
 const gate=new Promise<void>(r=>release=r),began=new Promise<void>(r=>started=r);let first=true,filled=0;
 const pending=mutate(async r=>{if(checkFinanceRequest(r,who.id,body))return;if(first){first=false;started();await gate;}recordFinanceRequest(r,who.id,body,"committed");filled++;});
 await began;const outcome=await mutate(r=>reconcileFinanceRequest(r,who.id,body));assert.equal(outcome.result,"cancelled");
 release();await assert.rejects(pending,/cancelled/);assert.equal(filled,1); // speculative local mutation loses CAS
 assert.equal((await readRoom()).financeReceipts![0].outcome,"cancelled");
 const committed=input();await mutate(r=>recordFinanceRequest(r,who.id,committed,"committed"));
 assert.equal((await mutate(r=>reconcileFinanceRequest(r,who.id,committed))).result,"committed");
});
test("hydrated actual hook, browser reload and dropped response after real Mongo fill reconcile exactly once on desktop and mobile",async()=>{
 const require=createRequire(import.meta.url),{build}=require("esbuild"),{chromium}=require(process.env.PLAYWRIGHT_MODULE||"/opt/hako/lib/node_modules/playwright");
 const bundle=await build({entryPoints:["tests/finance-retry-browser.fixture.tsx"],bundle:true,write:false,jsx:"automatic",platform:"browser",format:"iife"});
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||"/opt/hako/bin/google-chrome",args:["--no-sandbox"]});
 const evidence=process.env.RETRY_EVIDENCE||"/tmp/finance-retry-evidence";mkdirSync(evidence,{recursive:true});
 try{for(const width of [1280,390]){
  await setup();let financePosts=0,statusCalls=0,allowStatus=false;const submitted:any[]=[];
  const context=await browser.newContext({viewport:{width,height:900},recordVideo:{dir:evidence,size:{width,height:900}}});const page=await context.newPage();
  await page.route("https://retry.test/**",async(route:any)=>{
   const request=route.request(),path=new URL(request.url()).pathname;
   if(path==="/api/room")return route.fulfill({json:await readRoom()});
   if(path==="/api/finance/status"){
    statusCalls++;if(!allowStatus)return route.abort("failed");
    const response=await STATUS(req(request.postDataJSON()));return route.fulfill({status:response.status,json:await response.json()});
   }
   if(path==="/api/finance"){
    financePosts++;submitted.push(request.postDataJSON());
    const response=await POST(req(request.postDataJSON()));
    if(financePosts===1)return route.abort("failed");
    return route.fulfill({status:response.status,json:await response.json()});
   }
   return route.fulfill({contentType:"text/html",body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><div id="root"></div><script>'+bundle.outputFiles[0].text+'</script>'});
  });
  await page.goto("https://retry.test");await page.waitForFunction(()=>document.getElementById("state")?.textContent==="Ready");
  await page.locator("#open").evaluate((button:any)=>{button.click();button.click();button.click();});
  await page.waitForFunction(()=>document.getElementById("message")?.textContent?.includes("Failed")||document.getElementById("state")?.textContent==="Paused");
  await page.waitForTimeout(100);assert.equal(financePosts,1);assert.equal((await readRoom()).members[0].positions!.length,1);
  assert.equal(await page.locator("#open").isDisabled(),true);
  assert.ok(await page.evaluate(()=>sessionStorage.getItem("ssg-finance-v1:browser-test")));
  await page.screenshot({path:evidence+"/uncertain-"+width+".png",fullPage:true});
  await page.locator("#mount").click();await page.locator("#mount").click();
  assert.equal(financePosts,1);assert.equal(await page.locator("#open").isDisabled(),true);
  await page.reload();assert.equal(await page.locator("#open").isDisabled(),true);
  await page.locator("#connection").click();assert.equal(await page.locator("#open").isDisabled(),true);
  allowStatus=true;await page.locator("#connection").click();
  await page.waitForFunction(()=>document.getElementById("state")?.textContent==="Ready");
  assert.match(await page.locator("#message").innerText(),/completed/);assert.equal(await page.locator("#positions").innerText(),"1");
  assert.equal(await page.evaluate(()=>sessionStorage.getItem("ssg-finance-v1:browser-test")),null);
  assert.equal(financePosts,1);assert.ok(statusCalls>=1);
  assert.equal((await POST(req(submitted[0]))).status,200);assert.equal((await readRoom()).members[0].positions!.length,1);
  await page.screenshot({path:evidence+"/recovered-"+width+".png",fullPage:true});
  await page.locator("#open").click();await page.waitForFunction(()=>document.getElementById("positions")?.textContent==="2");
  assert.equal(financePosts,2);assert.notEqual(submitted[0].requestId,submitted[1].requestId);
  await context.close();
  writeFileSync(evidence+"/result-"+width+".json",JSON.stringify({width,financePosts,statusCalls,positions:(await readRoom()).members[0].positions!.length,originalKey:submitted[0].requestId,secondKey:submitted[1].requestId},null,2));
 }}finally{await browser.close();}
});
