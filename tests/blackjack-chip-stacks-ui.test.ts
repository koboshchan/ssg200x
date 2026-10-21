import {test} from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"/home/kit/out/cal-browser-evidence/node_modules/playwright");
const {build}=require("esbuild");
test("real blackjack seats render homogeneous physical stacks on desktop/mobile, light/dark",async()=>{
 const out=await build({stdin:{contents:`
 import React from "react";import {createRoot} from "react-dom/client";
 import Blackjack from "./app/blackjack-client";
 const table={id:"lounge",seats:[
 {name:"You",publicId:"me",isYou:true,bet:5700,chips:[...Array(22).fill(100),...Array(7).fill(500)],hands:[]},
 {name:"Alex",publicId:"other",bet:6000,chips:[2000,2000,2000],hands:[]},null,null,null,null],
 dealer:{cards:[]},phase:"betting",round:1,deadline:null,turn:null,minBet:100,maxBet:100000,legal:null};
 const root=createRoot(document.getElementById("root"));
 const render=()=>root.render(<Blackjack room={{serverNow:Date.now(),blackjack:{tables:[table]}}} busy={false} post={async()=>{}}/>);
 window.play=()=>{table.phase="playing";table.seats[0].hands=[{bet:5700,chips:table.seats[0].chips,cards:["8s","2c"]}];table.seats[1].hands=[{bet:6000,chips:table.seats[1].chips,cards:["As","7h"]}];render();};render();
 `,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,outdir:"out",format:"iife",platform:"browser",jsx:"automatic",loader:{".module.css":"local-css"}});
 const js=out.outputFiles.find((f:any)=>f.path.endsWith(".js")).text,css=out.outputFiles.find((f:any)=>f.path.endsWith(".css"))?.text||"";
 const fs=require("node:fs");fs.mkdirSync("/home/kit/out/bj-chip-stacks",{recursive:true});
 const browser=await chromium.launch({headless:true,channel:"chromium"});
 try{
 for(const viewport of [{width:1440,height:1100},{width:375,height:850}]){
 for(const theme of ["light","dark"]){
 const page=await browser.newPage({viewport,colorScheme:theme}),errors:string[]=[];
 page.on("pageerror",(e:Error)=>errors.push(e.message));
 await page.route("https://bj.test/**",async(r:any)=>r.fulfill({contentType:"text/html",body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><div id="root"></div>'}));
 await page.goto("https://bj.test");await page.addStyleTag({content:fs.readFileSync("app/globals.css","utf8")});await page.addStyleTag({content:css});await page.addScriptTag({content:js});
 await page.locator("[data-count]").first().waitFor();
 assert.deepEqual(await page.locator(".bj-seat.you [data-count]").evaluateAll((els:HTMLElement[])=>els.map(e=>[e.dataset.denomination,e.dataset.count])),[["1","20"],["1","2"],["5","7"]]);
 assert.equal(await page.locator(".bj-seat").nth(1).locator('[data-denomination="20"][data-count="3"]').count(),1);
 for(const el of await page.locator("[data-count]").all()){
 const n=Number(await el.getAttribute("data-count"));assert.ok(n<=20);assert.equal(await el.locator('[aria-hidden="true"] > span').count(),n);
 }
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:"/home/kit/out/bj-chip-stacks/"+viewport.width+"-"+theme+"-betting.png",fullPage:true});
 await page.evaluate(()=>(window as any).play());await page.locator(".bj-hand [data-count]").first().waitFor();
 assert.equal(await page.locator(".bj-hand [data-count]").count(),4);
 await page.screenshot({path:"/home/kit/out/bj-chip-stacks/"+viewport.width+"-"+theme+"-playing.png",fullPage:true});
 assert.deepEqual(errors,[]);await page.close();
 }} }finally{await browser.close();}
});
