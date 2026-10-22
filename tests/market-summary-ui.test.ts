import {test} from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"/home/kit/out/cal-browser-evidence/node_modules/playwright");
const {build}=require("esbuild");
test("picker reads authoritative lightweight summaries for unselected stocks and crypto without selecting their streams",async()=>{
 const out=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import Picker from './app/market-symbol-picker';const w:any=window;w.render=()=>createRoot(document.getElementById('root')!).render(<Picker symbol='ETH' symbols={{crypto:['BTC','ETH','NEW'],stocks:['AAPL','SPY'],delisted:[],revision:1}} quotes={{ETH:{micro:1000000,at:1},BTC:{micro:1,at:1}}} changes={{ETH:2.31}} summary={w.summary} onSelect={s=>w.selected=s}/>);w.render();`,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",outdir:"/tmp/summary-ui",loader:{".module.css":"local-css"},alias:{"@":process.cwd()},define:{"process.env.NODE_ENV":'"development"'}});
 const js=out.outputFiles.find((f:any)=>f.path.endsWith('.js')).text,css=out.outputFiles.find((f:any)=>f.path.endsWith('.css')).text;
 const browser=await chromium.launch({headless:true,channel:'chromium'});
 try{for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:844}}),errors:string[]=[];page.on('pageerror',(e:Error)=>errors.push(e.message));
  await page.setContent('<!doctype html><meta charset="utf-8"><div id="root"></div>');await page.addStyleTag({content:readFileSync('app/globals.css','utf8')});await page.addStyleTag({content:css});
  await page.evaluate(()=>{(window as any).summary={BTC:{micro:67000000000,change:1.5},ETH:{micro:2500000000,change:2.31},AAPL:{micro:250000000,change:0},SPY:{micro:660000000,change:-2.25},NEW:{micro:null,change:null}};});
  await page.addScriptTag({content:js});await page.getByRole('button',{name:/ETH \/ USD/}).click();const dialog=page.getByRole('dialog');
  for(const [name,amount,change] of [['BTC','$67,000.00','+1.50%'],['ETH','$2,500.00','+2.31%'],['AAPL','$250.00','+0.00%'],['SPY','$660.00','-2.25%'],['NEW','Unavailable','n/a']]){
   const text=await dialog.getByRole('button',{name:new RegExp(name)}).innerText();assert.ok(text.includes(amount),text);assert.ok(text.includes(change),text);
  }
  assert.equal(await page.evaluate(()=>(window as any).selected),undefined,'opening picker never selects other symbols');
  await dialog.getByRole('button',{name:/SPY/}).click();assert.equal(await page.evaluate(()=>(window as any).selected),'SPY');assert.equal(await dialog.count(),0);assert.deepEqual(errors,[]);await page.close();
 }}finally{await browser.close();}
});
