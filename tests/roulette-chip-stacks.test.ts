import {test} from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {build}=require("esbuild");
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"/home/kit/out/cal-browser-evidence/node_modules/playwright");
test("roulette own placements form one mixed-color pile; remote piles keep count, total and assigned color",async()=>{
 const output=await build({stdin:{contents:`
 import React from "react";import {createRoot} from "react-dom/client";
 import {RouletteBetChips} from "./app/roulette-bet-chips";
 const bets=[20,50,100].map((n,i)=>({id:String(i),publicId:"other",name:"Other player",isYou:false,color:"#b7474b",bet:{amount:n*100}}));
 createRoot(document.getElementById("root")).render(<div style={{width:42}}><RouletteBetChips bets={[...bets,...bets.map(b=>({...b,id:"own"+b.id,publicId:"me",isYou:true,name:"kobosh"}))]}/></div>);
 `,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,outdir:"out",platform:"browser",format:"iife",jsx:"automatic",loader:{".module.css":"local-css"}});
 const browser=await chromium.launch({headless:true,channel:"chromium"});
 try{for(const width of [390,1440])for(const theme of ["light","dark"]){
 const page=await browser.newPage({viewport:{width,height:900},colorScheme:theme});
 await page.setContent('<!doctype html><meta charset="utf-8"><div id="root"></div>');
 await page.addStyleTag({content:output.outputFiles.find((f:any)=>f.path.endsWith(".css")).text});
 await page.addScriptTag({content:output.outputFiles.find((f:any)=>f.path.endsWith(".js")).text});
 await page.locator('[data-owner="me"]').waitFor();
 assert.equal(await page.locator('[data-owner="me"]').count(),1);
 assert.equal(await page.locator('[data-owner="me"]').getAttribute("data-count"),"3");
 assert.deepEqual(await page.locator('[data-owner="me"] > span').evaluateAll((els:HTMLElement[])=>els.map(el=>getComputedStyle(el).getPropertyValue("--chip-color"))),["#4284ad","#c59b48","#38454e"]);
 assert.equal(await page.locator('[data-owner="other"] > span').count(),3);
 assert.equal(await page.locator('[data-owner="other"] b').textContent(),"$170");
 assert.equal(await page.locator('[data-owner="other"] > span').first().evaluate((el:HTMLElement)=>getComputedStyle(el).getPropertyValue("--chip-color")),"#b7474b");
 assert.equal(await page.evaluate(()=>[...document.querySelectorAll('[class*="name"]')].every(el=>el.getBoundingClientRect().width<=42)),true);
 await page.close();
 }}finally{await browser.close();}
});
