import {test} from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import {build} from "esbuild";
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"/home/kit/out/cal-browser-evidence/node_modules/playwright");

test("airdrop lives only in the feature-gated Admin branch and keeps server authorization",()=>{
 const wallet=readFileSync("app/(room)/wallet/page.tsx","utf8"),room=readFileSync("app/room-client.tsx","utf8");
 assert.doesNotMatch(wallet,/\/api\/airdrops|airdrop-title|airRetry|airAmount/);
 assert.match(wallet,/t\.kind==="airdrop"/); // History remains visible.
 assert.match(room,/const AdminAirdrop=dynamic\(\(\)=>import\("\.\/admin-airdrop"\)\)/);
 assert.match(room,/<section className="access"><FeatureSettings\/>\{me\.admin===true&&gameFlags\.airdrops\?<AdminAirdrop ready=\{connection==="connected"\} disabled=\{busy\}\/>:null\}/);
 const route=readFileSync("app/api/airdrops/route.ts","utf8");
 assert.match(route,/ensure\(who\.admin===true/);
 assert.match(route,/rateLimit\("airdrops:"\+who\.id,20\)/);
 assert.equal((route.match(/\.strict\(\)/g)||[]).length,2);
});

test("moved airdrop previews first, retries safely, resets edits/conflicts, expires and respects connection",async()=>{
 const out=await build({stdin:{contents:`
 import React from "react";import {createRoot} from "react-dom/client";
 import AdminAirdrop from "./app/admin-airdrop";
 const root=createRoot(document.getElementById("root"));
 window.mount=(ready=true,disabled=false)=>root.render(<main className="access"><AdminAirdrop ready={ready} disabled={disabled}/></main>);
 window.mount();
 `,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic"});
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||"/opt/hako/bin/chrome",args:["--no-sandbox"]});
 try{
  for(const width of [1280,375]){
   const page=await browser.newPage({viewport:{width,height:800}}),errors:string[]=[],requests:any[]=[];
   let confirmStatus=500,expiresAt=Date.now()+300000,previewNumber=0;
   page.on("pageerror",(e:Error)=>errors.push(e.message));
   await page.route("https://airdrop.test/**",async(route:any)=>{
    if(route.request().url().endsWith("/api/airdrops")){
     assert.equal(route.request().method(),"POST");
     assert.ok(route.request().headers()["x-tab-id"]);
     assert.ok(route.request().headers()["x-tab-proof"]);
     const body=route.request().postDataJSON();requests.push(body);
     if(body.action==="preview")return route.fulfill({json:{previewId:`00000000-0000-4000-8000-${String(++previewNumber).padStart(12,"0")}`,count:3,total:3750,amount:1250,note:body.note,expiresAt}});
     return confirmStatus===200?route.fulfill({json:{ok:true}}):route.fulfill({status:confirmStatus,json:{error:confirmStatus===409?"Players changed.":"Temporary failure."}});
    }
    return route.fulfill({contentType:"text/html",body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><div id="root"></div>'});
   });
   await page.goto("https://airdrop.test");
   await page.addStyleTag({content:readFileSync("app/globals.css","utf8")});
   await page.addScriptTag({content:out.outputFiles[0].text});
   const amount=page.getByLabel("Amount per player in dollars"),note=page.getByLabel("Note (optional)");
   const preview=()=>page.getByRole("button",{name:"Preview airdrop",exact:true});
   const confirm=()=>page.getByRole("button",{name:"Confirm airdrop of $37.50",exact:true});
   await amount.fill("12.50");await note.fill("hello <script>");
   assert.equal(requests.length,0);
   await preview().click();await confirm().waitFor();
   assert.deepEqual(requests[0],{action:"preview",amount:"12.50",note:"hello <script>"});
   assert.ok((await page.getByRole("status").innerText()).includes("$12.50"));
   assert.ok((await page.getByRole("status").innerText()).includes("3 players"));
   assert.equal(await page.locator("script").count(),1); // Only the test bundle.
   await confirm().click();await page.getByRole("alert").waitFor();
   const failed=requests.at(-1);assert.equal(failed.action,"confirm");assert.ok(failed.requestId);
   confirmStatus=200;await confirm().click();await page.getByText("Airdrop sent to 3 players.",{exact:true}).waitFor();
   assert.deepEqual(requests.at(-1),failed);
   assert.equal(await amount.inputValue(),"");assert.equal(await note.inputValue(),"");

   await amount.fill("12.50");await preview().click();await confirm().waitFor();
   const beforeEdit=requests.length;
   await amount.fill("13");await preview().waitFor();assert.equal(requests.length,beforeEdit);
   await preview().click();await confirm().waitFor();await page.getByRole("button",{name:"Cancel",exact:true}).click();await preview().waitFor();
   assert.equal(requests.at(-1).action,"preview");
   await preview().click();await confirm().waitFor();
   confirmStatus=409;await confirm().click();await page.getByText("Players changed since the preview. Preview the airdrop again.",{exact:true}).waitFor();await preview().waitFor();
   expiresAt=Date.now()-1;
   await preview().click();await page.getByText("Preview expired. Preview again.",{exact:true}).waitFor();
   assert.equal(await confirm().count(),0);
   await page.evaluate(()=>(window as any).mount(false));
   await page.getByText("Reconnect to send an airdrop.",{exact:true}).waitFor();assert.equal(await preview().isDisabled(),true);
   await page.evaluate(()=>(window as any).mount(true,true));assert.equal(await amount.isDisabled(),true);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
   assert.deepEqual(errors,[]);
   await page.close();
  }
 }finally{await browser.close();}
});
