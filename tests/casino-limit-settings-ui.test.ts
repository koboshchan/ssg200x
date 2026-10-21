import {test} from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"/home/kit/out/cal-browser-evidence/node_modules/playwright");
const {build}=require("esbuild");
test("real admin casino controls load/save cents, reject decimal dollars, reload persisted limits and stay hidden from ordinary users",async()=>{
 const out=await build({stdin:{contents:`
 import React from "react";import {createRoot} from "react-dom/client";
 import CasinoLimitSettings from "./app/casino-limit-settings";
 createRoot(document.getElementById("root")).render(<CasinoLimitSettings/>);
 `,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic"});
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||"/opt/hako/bin/chrome",args:["--no-sandbox"]});
 try{
  for(const viewport of [{width:1280,height:800},{width:375,height:700}]){
   const page=await browser.newPage({viewport}),errors:string[]=[];
   let state={rouletteMaxTotal:100000,blackjackMaxHand:100000,pokerMaxBuyIn:100000,revision:0},admin=true,posts=0;
   page.on("pageerror",(e:Error)=>errors.push(e.message));
   await page.route("https://casino.test/**",async(route:any)=>{
    if(route.request().url().includes("/api/admin/casino-limits")){
     if(!admin)return route.fulfill({status:403,json:{error:"Administrator access required."}});
     if(route.request().method()==="POST"){const body=route.request().postDataJSON();posts++;assert.equal(body.expectedVersion,state.revision);state={rouletteMaxTotal:body.rouletteMaxTotal,blackjackMaxHand:body.blackjackMaxHand,pokerMaxBuyIn:body.pokerMaxBuyIn,revision:state.revision+1};}
     return route.fulfill({json:{casinoLimits:state}});
    }
    return route.fulfill({contentType:"text/html",body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><div id="root"></div>'});
   });
   const mount=async()=>{await page.goto("https://casino.test");await page.addStyleTag({content:require("node:fs").readFileSync("app/globals.css","utf8")});await page.addScriptTag({content:out.outputFiles[0].text});};
   await mount();
   const poker=page.getByLabel("Poker max buy-in per seat ($)");
   const roulette=page.getByLabel("Roulette max total bet per player per round ($)"),blackjack=page.getByLabel("Blackjack max hand bet ($)");
   await roulette.waitFor({timeout:5000}).catch(async(e:Error)=>{console.error(errors,await page.locator("body").innerText());throw e;});assert.equal(await roulette.inputValue(),"1000");assert.equal(await blackjack.inputValue(),"1000");
   assert.equal(await poker.inputValue(),"1000");await poker.fill("2500");await roulette.fill("250");await blackjack.fill("50");await page.getByRole("button",{name:"Save limits"}).click();
   await page.waitForFunction(()=>{const button=[...document.querySelectorAll("button")].find(b=>b.textContent==="Save limits");return button&&!button.disabled;});
   assert.deepEqual(state,{rouletteMaxTotal:25000,blackjackMaxHand:5000,pokerMaxBuyIn:250000,revision:1});assert.equal(posts,1);
   await roulette.fill("1.5");await page.getByRole("button",{name:"Save limits"}).click();assert.equal(posts,1);
   await mount();await roulette.waitFor({timeout:5000}).catch(async(e:Error)=>{console.error(errors,await page.locator("body").innerText());throw e;});assert.equal(await roulette.inputValue(),"250");assert.equal(await blackjack.inputValue(),"50");assert.equal(await poker.inputValue(),"2500");
   await poker.fill("99");await page.getByRole("button",{name:"Save limits"}).click();assert.equal(posts,1);
   await poker.fill("100.5");await page.getByRole("button",{name:"Save limits"}).click();assert.equal(posts,1);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
   admin=false;await mount();await page.waitForFunction(()=>!document.querySelector("form"));assert.equal(await page.getByRole("button").count(),0);
   assert.deepEqual(errors,[]);await page.close();
  }
 }finally{await browser.close();}
});
