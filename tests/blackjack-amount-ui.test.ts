import {test} from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"/home/kit/out/cal-browser-evidence/node_modules/playwright");
const {build}=require("esbuild");
test("mounted blackjack input sends 1.01 as 101 cents; shared poker input still rejects decimals",async()=>{
 const bundle=await build({stdin:{contents:`
 import React,{useState} from "react";import {createRoot} from "react-dom/client";
 import Blackjack from "./app/blackjack-client";import CasinoAmountInput from "./app/casino-amount-input";
 const table={id:"t1",seats:[{name:"Me",publicId:"me",isYou:true,bet:0,hands:[]},null,null,null,null,null],dealer:{cards:[]},phase:"betting",round:1,deadline:null,turn:null,minBet:100,maxBet:100000,legal:null};
 const room={serverNow:Date.now(),blackjack:{tables:[table]}};
 const post=async(path,body)=>{(window.posts=window.posts||[]).push({path,body});};
 function Poker(){const [v,setV]=useState("");return <label>Poker<CasinoAmountInput aria-label="Poker amount" value={v} onChange={setV}/></label>;}
 createRoot(document.getElementById("root")).render(<><Blackjack room={room} busy={false} post={post}/><Poker/></>);
 `,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",loader:{".module.css":"empty",".css":"empty"}});
 const browser=await chromium.launch({headless:true,channel:"chromium"});
 try{
  const page=await browser.newPage(),errors:string[]=[];
  page.on("pageerror",(e:Error)=>errors.push(e.message));
  await page.route("https://bj.test/**",async(r:any)=>r.fulfill({contentType:"text/html",body:'<!doctype html><meta charset="utf-8"><div id="root"></div>'}));await page.goto("https://bj.test");
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const input=page.locator(".raise-input input");
  assert.equal(await input.getAttribute("inputmode"),"decimal");
  await input.fill("");await input.pressSequentially("1.01");
  assert.equal(await input.inputValue(),"1.01");
  await page.getByRole("button",{name:"Bet $1.01"}).click();await page.waitForFunction(()=>(window as any).posts?.length===1);
  const posts=await page.evaluate(()=>(window as any).posts);
  assert.equal(posts.length,1);assert.equal(posts[0].path,"/api/blackjack");
  assert.deepEqual(Object.keys(posts[0].body).sort(),["amount","requestAt","requestId","tableId","type"]);
  assert.equal(posts[0].body.amount,101);assert.equal(posts[0].body.type,"bet");assert.equal(posts[0].body.tableId,"t1");
  await input.fill("");await input.pressSequentially("1.234e5,-");
  assert.equal(await input.inputValue(),"1.23");
  const poker=page.getByLabel("Poker amount");
  await poker.pressSequentially("1.01");
  assert.equal(await poker.inputValue(),"101");
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
