import {test} from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"/home/kit/out/cal-browser-evidence/node_modules/playwright");
const {build}=require("esbuild");
const fixture=`{id:"lounge",seats:[{name:"Ann",publicId:"a",isYou:true,bet:0,hands:[]},null,null,null,null,null],dealer:{cards:[]},phase:"betting",round:1,deadline:null,turn:null,minBet:100,maxBet:100000}`;
test("mounted blackjack bet input: typing/pasting cents posts exact cents; invalid text and out-of-range never submit",async()=>{
 const bundle=await build({stdin:{contents:`
 import React from "react";import {createRoot} from "react-dom/client";import Blackjack from "./app/blackjack-client";
 const room={serverNow:Date.now(),blackjack:{tables:[${fixture}]}};
 createRoot(document.getElementById("root")).render(<Blackjack room={room} busy={false} post={async(path,body)=>{(window.posts=window.posts||[]).push({path,body})}}/>);
 `,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",loader:{".module.css":"empty",".css":"empty"}});
 const browser=await chromium.launch({headless:true,channel:"chromium"});
 try{
  const page=await browser.newPage(),errors:string[]=[];page.on("pageerror",(e:Error)=>errors.push(e.message));
  await page.route("https://bjreg.test/**",(r:any)=>r.fulfill({contentType:"text/html",body:'<!doctype html><meta charset="utf-8"><div id="root"></div>'}));
  await page.goto("https://bjreg.test");await page.addScriptTag({content:bundle.outputFiles[0].text});
  const input=page.locator(".raise-input input"),button=page.locator("button.primary");
  const posts=()=>page.evaluate(()=>new Promise<any[]>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r((window as any).posts||[])))));
  const typed=async(s:string)=>{await input.fill("");await input.pressSequentially(s);return input.inputValue();};
  const paste=(s:string)=>input.evaluate((el:HTMLInputElement,t:string)=>{el.value="";const d=new DataTransfer();d.setData("text",t);const e=new ClipboardEvent("paste",{clipboardData:d,bubbles:true,cancelable:true});el.dispatchEvent(e);return e.defaultPrevented;},s);
  // typed 1.01 posts 101
  assert.equal(await typed("1.01"),"1.01");await button.click();
  let p=await posts();assert.equal(p.length,1);assert.equal(p[0].path,"/api/blackjack");assert.equal(p[0].body.amount,101);assert.equal(p[0].body.type,"bet");
  // pasted 1.01 is accepted, then submits 101
  assert.equal(await paste("1.01"),false);await input.fill("1.01");await button.click();
  p=await posts();assert.equal(p.length,2);assert.equal(p[1].body.amount,101);
  // invalid paste is blocked
  for(const bad of ["1.234","1e3","1,5","-1","abc","1.0.1"])assert.equal(await paste(bad),true,"paste "+bad);
  // invalid typing never leaves invalid text and never submits
  assert.equal(await typed("1e3"),"13");assert.equal(await typed("1,5"),"15");assert.equal(await typed("-5"),"5");assert.equal(await typed("1.239"),"1.23");
  await input.fill("");assert.equal(await button.isDisabled(),true);
  await input.pressSequentially("1.");assert.equal(await button.isDisabled(),true);
  const before=(await posts()).length;
  await button.click({force:true}).catch(()=>{});assert.equal((await posts()).length,before);
  // limits 1..1000 intact
  for(const [v,ok] of [["0.99",false],["0",false],["1",true],["1.00",true],["1000",true],["1000.00",true],["1000.01",false],["1001",false]] as const){
   await typed(v);assert.equal(await button.isDisabled(),!ok,v);
  }
  await typed("1000");await button.click();p=await posts();assert.equal(p.at(-1).body.amount,100000);
  await typed("1");await button.click();p=await posts();assert.equal(p.at(-1).body.amount,100);
  assert.equal(p.length,before+2);assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
