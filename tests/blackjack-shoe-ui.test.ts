import {test} from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"/home/kit/out/cal-browser-evidence/node_modules/playwright");
const {build}=require("esbuild");
test("mounted blackjack shows shoe count on all tables, rerenders, no invented count",async()=>{
 const out=await build({stdin:{contents:`
 import React from "react";import {createRoot} from "react-dom/client";
 import Blackjack from "./app/blackjack-client";
 const mk=(id,n)=>({id,...(n===undefined?{}:{cardsRemaining:n}),seats:[{name:"Me",publicId:"me",isYou:true,bet:0,hands:[]},null,null,null,null,null],dealer:{cards:[]},phase:"betting",round:1,deadline:null,turn:null,minBet:100,maxBet:100000,legal:null});
 const root=createRoot(document.getElementById("root"));
 window.show=(counts)=>root.render(<Blackjack room={{serverNow:Date.now(),blackjack:{tables:["lounge","salon","terrace"].map((id,i)=>mk(id,counts[i]))}}} busy={false} post={async()=>{}}/>);
 `,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,outdir:"out",format:"iife",platform:"browser",jsx:"automatic",loader:{".module.css":"local-css"}});
 const js=out.outputFiles.find((f:any)=>f.path.endsWith(".js")).text,css=out.outputFiles.find((f:any)=>f.path.endsWith(".css"))?.text||"";
 const globalCss=require("node:fs").readFileSync("app/globals.css","utf8");
 const browser=await chromium.launch({headless:true,channel:"chromium"});
 try{
  for(const vp of [{width:1280,height:800,f:"1280"},{width:390,height:800,f:"390"}]){
   const page=await browser.newPage({viewport:vp}),errors:string[]=[];
   page.on("pageerror",(e:Error)=>errors.push(e.message));page.on("console",(m:any)=>{if(m.type()==="error")errors.push(m.text());});
   await page.route("https://bj.test/**",async(r:any)=>r.fulfill({contentType:"text/html",body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><div id="root"></div>'}));await page.goto("https://bj.test");
   await page.addStyleTag({content:globalCss});await page.addStyleTag({content:css});await page.addScriptTag({content:js});
   const el=page.getByTestId("bj-cards-remaining");
   const show=async(c:any[])=>{await page.evaluate((c:any[])=>(window as any).show(c),c);await page.waitForTimeout(100);};
   const noOverflow=async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
   await show([312,250,17]);
   for(const [name,txt] of [["Lounge","312 / 312 cards left"],["Salon","250 / 312 cards left"],["Terrace","17 / 312 cards left"]]){
    await page.getByRole("button",{name,exact:true}).click();assert.equal(await el.textContent(),txt);await noOverflow();}
   await show([312,250,300]); // reshuffle on terrace
   assert.equal(await el.textContent(),"300 / 312 cards left");
   await page.getByRole("button",{name:"Salon",exact:true}).click();assert.equal(await el.textContent(),"250 / 312 cards left");
   await show([312,undefined,300]);
   assert.equal(await el.count(),0);assert.doesNotMatch(await page.locator(".bj-dealer").textContent()||"",/cards left/);
   await page.getByRole("button",{name:"Lounge",exact:true}).click();assert.equal(await el.textContent(),"312 / 312 cards left");
   await show([312,250,17]);await noOverflow();
   await page.screenshot({path:"/home/kit/out/blackjack-shoe-"+vp.f+".png",fullPage:true});
   assert.deepEqual(errors,[]);await page.close();
  }
 }finally{await browser.close();}
});
