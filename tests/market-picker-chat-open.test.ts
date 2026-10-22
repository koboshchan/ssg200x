import {test} from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"/home/kit/out/cal-browser-evidence/node_modules/playwright");
const {build}=require("esbuild");
const FX=["EUR/USD","USD/JPY","GBP/USD","USD/CNH","USD/CAD","AUD/USD","USD/CHF","AUD/JPY"];
test("market picker stays clickable for every forex pair with chat open or closed",async()=>{
 const out=await build({stdin:{contents:`
  import React from "react";import {createRoot} from "react-dom/client";
  import MarketSymbolPicker from "./app/market-symbol-picker";
  const w:any=window;
  function App(){const [sel,setSel]=React.useState("BTC");return <><main className="game-main"><MarketSymbolPicker symbol={sel} symbols={w.__s} quotes={w.__q} onSelect={setSel}/></main>{w.__chat&&<aside className="chat-dock"><header>Chat</header></aside>}</>;}
  createRoot(document.getElementById("root")!).render(<App/>);`,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",outdir:"/tmp/mpc-out",loader:{".module.css":"local-css"},alias:{"@":process.cwd()},define:{"process.env.NODE_ENV":'"development"'}});
 const js=out.outputFiles.find((f:any)=>f.path.endsWith(".js")).text,css=out.outputFiles.find((f:any)=>f.path.endsWith(".css"));
 const browser=await chromium.launch({headless:true,channel:"chromium"});
 try{for(const vp of [{width:375,height:700},{width:1280,height:800}])for(const chat of [true,false]){
  const page=await browser.newPage({viewport:vp});
  await page.route("https://fx.test/**",(r:any)=>r.fulfill({contentType:"text/html",body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><div id="root"></div>'}));
  await page.goto("https://fx.test");
  await page.addStyleTag({content:readFileSync("app/globals.css","utf8")});if(css)await page.addStyleTag({content:css.text});
  await page.evaluate((c:boolean)=>{const w:any=window;w.__s={crypto:["BTC"],stocks:[],forex:["EUR/USD","USD/JPY","GBP/USD","USD/CNH","USD/CAD","AUD/USD","USD/CHF","AUD/JPY"],delisted:[],revision:1};w.__q={BTC:{micro:1e6,at:1}};w.__chat=c;document.documentElement.classList.toggle("chat-open",c);},chat);
  await page.addScriptTag({content:js});
  for(const pair of FX){
  await page.locator("[data-market-picker]").click();
  const dlg=page.getByRole("dialog",{name:"Choose a market"});await dlg.waitFor();
  await dlg.getByRole("button",{name:new RegExp(pair.replace("/","\\/"))}).click();
  await page.locator("[data-market-picker]").filter({hasText:pair}).waitFor();
  }
  assert.equal(await page.locator(".chat-dock").count(),chat?1:0,"closed fixture has no chat dock");
  await page.close();
 }}finally{await browser.close();}
});
