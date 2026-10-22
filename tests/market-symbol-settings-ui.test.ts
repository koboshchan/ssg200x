import {test} from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"/home/kit/out/cal-browser-evidence/node_modules/playwright");
const {build}=require("esbuild");
const bundle=async()=>(await build({stdin:{contents:`
 import React from "react";import {createRoot} from "react-dom/client";
 import MarketSymbolPicker from "./app/market-symbol-picker";
 import MarketSymbolSettings from "./app/market-symbol-settings";
 const w:any=window;
 function App(){const [sel,setSel]=React.useState("BTC");return <><main className="game-main"><MarketSymbolPicker symbol={sel} symbols={w.__symbols} quotes={w.__quotes} changes={w.__changes} onSelect={setSel}/></main><button className="chat-toggle" aria-label="Open chat">Chat</button><MarketSymbolSettings/></>;}
 createRoot(document.getElementById("root")!).render(<App/>);
 `,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",outdir:"/tmp/msq-out",loader:{".module.css":"local-css"},alias:{"@":process.cwd()},define:{"process.env.NODE_ENV":'"development"'}}));
const names=(n:number,p:string)=>Array.from({length:n},(_,i)=>p+String.fromCharCode(65+i%26)+String.fromCharCode(65+Math.floor(i/26)%26));
const fixtures=(stocks:string[],crypto:string[])=>({marketSymbols:{crypto,stocks,delisted:["ZEC"]},affected:{AAPL:{holdings:3,positions:2,accounts:4}},version:7});
test("mounted market picker and admin symbol settings across viewport and theme, counts, caps, search, removal and 403",async()=>{
 const out=await bundle(),js=out.outputFiles.find((f:any)=>f.path.endsWith(".js")).text,cssFile=out.outputFiles.find((f:any)=>f.path.endsWith(".css"));
 const browser=await chromium.launch({headless:true,channel:"chromium"});
 try{
  for(const viewport of [{width:1280,height:800},{width:375,height:700}])for(const scheme of ["light","dark"] as const){
   const page=await browser.newPage({viewport,colorScheme:scheme}),errors:string[]=[];
   let snap=fixtures(["AAPL","TSLA","SPY"],["BTC","ETH"]),admin=true,posts:any[]=[];
   page.on("pageerror",(e:Error)=>errors.push(e.message));
   await page.route("https://symbols.test/**",async(route:any)=>{
    if(route.request().url().includes("/api/admin/symbols")){
     if(!admin)return route.fulfill({status:403,json:{error:"Administrator access required."}});
     if(route.request().method()==="POST"){const b=route.request().postDataJSON();posts.push(b);snap={...snap,version:snap.version+1};}
     return route.fulfill({json:snap});
    }
    return route.fulfill({contentType:"text/html",body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><div id="root"></div>'});
   });
   const mount=async(initial?:any)=>{await page.goto("https://symbols.test");
    await page.addStyleTag({content:readFileSync("app/globals.css","utf8")});if(cssFile)await page.addStyleTag({content:cssFile.text});
    await page.evaluate((i:any)=>{const w:any=window;w.__symbols={crypto:["BTC","ETH"],stocks:["AAPL","SPY","NEWCO"],delisted:[],revision:1};
     w.__quotes={BTC:{micro:67000123456,at:1},ETH:{micro:3400000000,at:1},AAPL:{micro:230500000,at:1},SPY:{micro:580000000,at:1}};
     w.__changes={BTC:1.5,ETH:-2.25,AAPL:0,SPY:null};},initial);
    await page.addScriptTag({content:js});};
   await mount();
   // picker
   const trigger=page.getByRole("button",{name:/BTC \/ USD/});await trigger.waitFor({timeout:5000});
   assert.match(await trigger.innerText(),/\$67,000\.12/);
   await trigger.click();
   const dialog=page.getByRole("dialog",{name:"Choose a market"});await dialog.waitFor();
   assert.equal(await dialog.evaluate((el:Element)=>el.parentElement===document.body),true,"picker escapes isolated game-main stacking context");
   const hit=await dialog.boundingBox();assert.ok(hit);
   assert.equal(await page.evaluate(()=>document.elementFromPoint(innerWidth-20,innerHeight-20)?.closest(".chat-toggle")!==null),false,"drawer covers the floating chat control");
   const surface=await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue("--surface").trim());
   const bg=await dialog.evaluate((el:Element)=>getComputedStyle(el).backgroundColor);
   const want=await page.evaluate(()=>{const d=document.createElement("div");d.style.background="var(--surface)";document.body.append(d);const c=getComputedStyle(d).backgroundColor;d.remove();return c;});
   assert.notEqual(want,"rgba(0, 0, 0, 0)");assert.equal(want===(scheme==="dark"?"rgb(255, 255, 255)":"rgb(0, 0, 0)"),false);
   assert.equal(bg,want,"drawer uses --surface ("+surface+") in "+scheme);
   const text=await dialog.innerText();
   assert.match(text,/\+1\.50%/);assert.match(text,/-2\.25%/);assert.match(text,/\+0\.00%/);assert.match(text,/n\/a/);assert.match(text,/S&P 500 \(SPY\)/);
   await dialog.getByRole("searchbox").fill("s&p");assert.equal(await dialog.getByRole("button",{name:/S&P 500/}).count(),1);assert.equal(await dialog.getByRole("button",{name:/BTC/}).count(),0);
   await dialog.getByRole("searchbox").fill("newco");const nr=await dialog.getByRole("button",{name:/NEWCO/}).innerText();assert.match(nr,/Unavailable/);assert.match(nr,/n\/a/);
   await dialog.getByRole("searchbox").fill("zzz");assert.match(await dialog.innerText(),/No matches/);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),"no horizontal overflow");
   if(viewport.width<=700){const r=await dialog.boundingBox();assert.ok(r&&r.width>=viewport.width-1,"mobile drawer full width");}
   await page.keyboard.press("Escape");await dialog.waitFor({state:"detached"});
   // settings counts
   const stocks=page.locator("fieldset",{hasText:"Stocks"}),crypto=page.locator("fieldset",{hasText:"Crypto"});
   await stocks.waitFor();assert.match(await stocks.innerText(),/3 \/ 30 active/);assert.match(await crypto.innerText(),/2 active/);
   assert.equal(await stocks.getByRole("textbox").getAttribute("maxlength"),"15");assert.equal(await stocks.getByRole("textbox").getAttribute("pattern"),"[A-Z][A-Z0-9.\\-]{0,14}");
   // removal impact confirmation, dismiss then accept
   let msg="";page.once("dialog",(d:any)=>{msg=d.message();void d.dismiss();});
   await stocks.getByRole("button",{name:"Remove AAPL"}).click();await page.waitForTimeout(200);
   assert.match(msg,/Remove AAPL/);assert.match(msg,/3 holdings and 2 open positions across 4 accounts/);assert.equal(posts.length,0);
   page.once("dialog",(d:any)=>void d.accept());
   await stocks.getByRole("button",{name:"Remove AAPL"}).click();await page.waitForFunction(()=>true);
   await page.waitForTimeout(300);assert.equal(posts.length,1);assert.deepEqual({a:posts[0].action,k:posts[0].kind,s:posts[0].symbol,c:posts[0].confirmed,v:posts[0].expectedVersion},{a:"remove",k:"stocks",s:"AAPL",c:true,v:7});
   // add uppercases
   await stocks.getByRole("textbox").fill("nvda");assert.equal(await stocks.getByRole("textbox").inputValue(),"NVDA");
   // caps: 30 stocks disabled, 101 crypto still enabled
   snap=fixtures(names(30,"S"),names(101,"C"));await mount();
   await page.locator("fieldset",{hasText:"Stocks"}).waitFor();
   const s2=page.locator("fieldset",{hasText:"Stocks"}),c2=page.locator("fieldset",{hasText:"Crypto"});
   assert.match(await s2.innerText(),/30 \/ 30 active/);assert.match(await s2.innerText(),/Stock limit reached/);
   assert.equal(await s2.getByRole("textbox").isDisabled(),true);assert.equal(await s2.getByRole("button",{name:"Add",exact:true}).isDisabled(),true);
   assert.match(await c2.innerText(),/101 active/);assert.doesNotMatch(await c2.innerText(),/\/ \d+ active/);
   assert.equal(await c2.getByRole("textbox").isDisabled(),false);await c2.getByRole("textbox").fill("DOGE");assert.equal(await c2.getByRole("button",{name:"Add",exact:true}).isDisabled(),false);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),"no overflow settings");
   // 403 hides settings
   admin=false;await mount();await page.waitForTimeout(400);assert.equal(await page.locator("#market-symbols-title").count(),0);
   assert.deepEqual(errors,[]);await page.close();
  }
 }finally{await browser.close();}
});
