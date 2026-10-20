import {test} from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"/home/kit/out/cal-browser-evidence/node_modules/playwright");
const {build}=require("esbuild");
test("mounted blackjack uses roulette chip buttons on desktop and mobile",async()=>{
 const out=await build({stdin:{contents:`
 import React from "react";import {createRoot} from "react-dom/client";
 import Blackjack from "./app/blackjack-client";
 const table={id:"t1",seats:[{name:"Me",publicId:"me",isYou:true,bet:0,hands:[]},null,null,null,null,null],dealer:{cards:[]},phase:"betting",round:1,deadline:null,turn:null,minBet:100,maxBet:100000,legal:null};
 const room={serverNow:Date.now(),blackjack:{tables:[table]}};
 const post=async(path,body)=>{(window.posts=window.posts||[]).push({path,body});};
 createRoot(document.getElementById("root")).render(<Blackjack room={room} busy={false} post={post}/>);
 `,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,outdir:"out",format:"iife",platform:"browser",jsx:"automatic",loader:{".module.css":"local-css"}});
 const js=out.outputFiles.find((f:any)=>f.path.endsWith(".js")).text,css=out.outputFiles.find((f:any)=>f.path.endsWith(".css"))?.text||"";
 const browser=await chromium.launch({headless:true,channel:"chromium"});
 try{
  for(const vp of [{width:1280,height:800},{width:375,height:700}]){
   const page=await browser.newPage({viewport:vp}),errors:string[]=[];
   page.on("pageerror",(e:Error)=>errors.push(e.message));page.on("console",(m:any)=>{if(m.type()==="error")errors.push(m.text());});
   await page.route("https://bj.test/**",async(r:any)=>r.fulfill({contentType:"text/html",body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><div id="root"></div>'}));await page.goto("https://bj.test");
   await page.addStyleTag({content:css});await page.addScriptTag({content:js});
   assert.equal(await page.locator("input").count(),0);
   assert.equal(await page.getByRole("group",{name:"Chip value"}).getByRole("button").count(),5);
   const posts=()=>page.evaluate(()=>(window as any).posts||[]);
   const chip=(n:number)=>page.getByRole("button",{name:"$"+n+" chip"});
   const total=page.getByTestId("bj-total");
   const place=async(vals:number[])=>{for(const v of vals)await chip(v).click();};
   const send=async(vals:number[],amount:number,n:number)=>{await place(vals);assert.equal(await total.textContent(),"$"+amount/100);
    await page.getByRole("button",{name:"Bet $"+amount/100}).click();await page.waitForFunction((k:number)=>(window as any).posts?.length===k,n);
    const b=(await posts())[n-1];assert.equal(b.path,"/api/blackjack");assert.equal(b.body.type,"bet");assert.equal(b.body.amount,amount);assert.deepEqual(b.body.chips,vals.map(v=>v*100));assert.equal(b.body.tableId,"t1");
    assert.equal(await total.textContent(),"$0");};
   await send([1,1],200,1);await send([1,5],600,2);await send([5,20],2500,3);
   await place([1,5]);assert.equal(await total.textContent(),"$6");
   await page.getByRole("button",{name:"Clear"}).click();assert.equal(await total.textContent(),"$0");
   assert.equal(await page.getByRole("button",{name:/^Bet/}).isDisabled(),true);
   for(let i=0;i<10;i++)await chip(100).click();
   assert.equal(await total.textContent(),"$1,000");assert.equal(await chip(1).isDisabled(),true);
   assert.equal((await posts()).length,3);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
   assert.deepEqual(errors,[]);await page.close();
  }
 }finally{await browser.close();}
});
